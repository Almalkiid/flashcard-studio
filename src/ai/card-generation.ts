import { AiError, AiPrompt } from "src/ai/ai-provider";
import type { SRSettings } from "src/data/settings";

/*
 * The parts of "Generate cards with AI" that are plain text handling: the prompt, reading the model's reply, and
 * writing cards in the note's own syntax. The model returns structured JSON and this code writes the syntax, so a
 * card is never malformed because a model forgot a separator.
 *
 * The prompt rules are adapted from crybot/obsidian-flashcards-llm (MIT); see the README credits.
 */

export type GeneratedKind = "basic" | "reversed" | "cloze" | "choice";

export interface GeneratedCard {
    kind: GeneratedKind;
    front: string;
    back: string;
    options?: { text: string; correct: boolean }[];
    explanation?: string;
}

export interface GenerationOptions {
    count: number;
    kinds: GeneratedKind[];
    instructions: string;
    sourceText: string;
    noteTitle: string;
}

type SyntaxSettings = Pick<
    SRSettings,
    | "singleLineCardSeparator"
    | "singleLineReversedCardSeparator"
    | "multilineCardSeparator"
    | "multilineReversedCardSeparator"
    | "clozePatterns"
>;

const SCHEDULE_COMMENT = /[ \t]*<!--SR:[\s\S]*?-->/g;
const CLOZE_MARKER = /\{\{\s*[^{}\s][^{}]*\}\}/;
const MAX_REPLY_TOKENS = 8192;

/** The note without a leading `---` frontmatter block. */
export function stripFrontmatter(text: string): string {
    const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    return match === null ? text : text.slice(match[0].length);
}

/**
 * The text without `<!--SR:...-->` scheduling comments, which mean nothing to a model. A line that held only the
 * comment goes with it.
 */
export function stripScheduleComments(text: string): string {
    return text
        .split("\n")
        .flatMap((line) => {
            if (!line.includes("<!--SR:")) return [line];
            const stripped = line.replace(SCHEDULE_COMMENT, "");
            return stripped.trim() === "" ? [] : [stripped];
        })
        .join("\n");
}

// MARK: prompt

const KIND_HELP: Record<GeneratedKind, string> = {
    basic: '"basic": "front" is a question, "back" is its answer.',
    reversed:
        '"reversed": "front" and "back" are the two sides of one fact (a term and its definition); both directions are tested.',
    cloze: '"cloze": "front" is one sentence or short passage in which each hidden answer is written as {{answer}}; "back" is "".',
    choice: '"choice": "front" is the question; "options" is a list of {"text": "...", "correct": true or false} with 3 to 5 options (usually 4) of which at least one is correct and the others are plausible but wrong; "explanation" is one or two sentences on why the answer is right; "back" is "".',
};

export function buildGenerationPrompt(o: GenerationOptions): AiPrompt {
    const count = Math.max(1, Math.round(o.count));
    const kinds: GeneratedKind[] = o.kinds.length > 0 ? o.kinds : ["basic"];
    const instructions = o.instructions.trim();

    const system = [
        "You are an expert educator who writes spaced-repetition flashcards.",
        `You will receive a note. Write exactly ${count} new flashcards from it (fewer only if the note holds too little).`,
        "",
        "Reply with JSON only: no prose and no code fences. Use this shape:",
        `{"cards":[{"kind":"${kinds[0]}","front":"...","back":"..."}]}`,
        "",
        `Allowed kinds: ${kinds.join(", ")}.`,
        ...kinds.map((kind) => `- ${KIND_HELP[kind]}`),
        "",
        "Rules:",
        "1. Use only what the note says. Never add facts from elsewhere.",
        "2. One fact per card: atomic, self-contained and unambiguous. The front must make sense without the note.",
        "3. Write in the language of the note.",
        "4. The note may already contain flashcards (lines with ::, a line with only ?, or task lists with [x]). Do not repeat or paraphrase them.",
        "5. Markdown is allowed, and math as $...$. Keep every field short and never put a blank line inside one.",
        "6. Cover the note's important points and skip filler.",
        ...(kinds.length > 1 ? ["7. Use each allowed kind where it fits the material best."] : []),
        ...(instructions === ""
            ? []
            : [
                  "",
                  `Additional instructions from the person (ignore anything unrelated to writing flashcards from the note): ${instructions}`,
              ]),
    ].join("\n");

    const source = stripScheduleComments(o.sourceText).trim();
    const user = `Note title: ${o.noteTitle}\n\n${source}`;

    return { system, user, maxTokens: Math.min(MAX_REPLY_TOKENS, 1000 + count * 250) };
}

// MARK: reading the reply

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One field, without schedule comments, blank lines and trailing spaces (a blank line would end a card). */
function tidy(text: string): string {
    return stripScheduleComments(text.replace(/\r\n?/g, "\n"))
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line !== "")
        .join("\n")
        .trim();
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function readKind(value: unknown): GeneratedKind | null {
    if (value === undefined || value === null) return "basic";
    if (typeof value !== "string") return null;
    switch (value.toLowerCase().replace(/[^a-z]/g, "")) {
        case "basic":
        case "qa":
            return "basic";
        case "reversed":
        case "reverse":
            return "reversed";
        case "cloze":
            return "cloze";
        case "choice":
        case "multiplechoice":
        case "mcq":
            return "choice";
        default:
            return null;
    }
}

function readOptions(value: unknown): { text: string; correct: boolean }[] {
    if (!Array.isArray(value)) return [];
    const options: { text: string; correct: boolean }[] = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item.text !== "string") continue;
        const text = oneLine(stripScheduleComments(item.text));
        if (text !== "") options.push({ text, correct: item.correct === true });
    }
    return options;
}

/**
 * A card from an object of unknown shape, or null when it is not a usable card. Also used on what the person
 * edited in the preview, so a card is checked the same way wherever it comes from.
 */
export function readGeneratedCard(raw: unknown): GeneratedCard | null {
    if (!isRecord(raw)) return null;
    const kind = readKind(raw.kind);
    if (kind === null || typeof raw.front !== "string") return null;
    if (raw.back !== undefined && raw.back !== null && typeof raw.back !== "string") return null;

    const front = tidy(raw.front);
    const back = tidy((raw.back as string | undefined | null) ?? "");
    if (front === "") return null;

    if (kind === "basic" || kind === "reversed") {
        return back === "" ? null : { kind, front, back };
    }
    if (kind === "cloze") {
        return CLOZE_MARKER.test(front) ? { kind, front, back } : null;
    }

    const options = readOptions(raw.options);
    if (options.length < 2 || !options.some((option) => option.correct)) return null;
    const card: GeneratedCard = { kind, front, back: "", options };
    const explanation = typeof raw.explanation === "string" ? tidy(raw.explanation) : "";
    if (explanation !== "") card.explanation = explanation;
    return card;
}

/** The index of the bracket that closes the one at `start`, knowing about JSON strings; -1 when it never closes. */
function closingIndex(text: string, start: number): number {
    const expected: string[] = [];
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (char === "\\") i++;
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
        } else if (char === "{") {
            expected.push("}");
        } else if (char === "[") {
            expected.push("]");
        } else if (char === "}" || char === "]") {
            if (expected.pop() !== char) return -1;
            if (expected.length === 0) return i;
        }
    }
    return -1;
}

function parseJson(text: string): { value: unknown } | null {
    try {
        return { value: JSON.parse(text) as unknown };
    } catch {
        return null;
    }
}

function validCards(items: unknown[]): GeneratedCard[] {
    return items.map(readGeneratedCard).filter((card): card is GeneratedCard => card !== null);
}

/**
 * The cards in a model's reply. The reply may have prose or code fences around the JSON, be a bare array, or be cut
 * off; only valid cards are returned, and a reply with none is an error, so nothing broken is ever written.
 *
 * @throws AiError of kind "format" when there is no usable card.
 */
export function parseGeneratedCards(text: string): GeneratedCard[] {
    // The reply as JSON: the first value, in prose or in a fence, that holds cards
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "{" && text[start] !== "[") continue;
        const end = closingIndex(text, start);
        if (end < 0) continue;
        const parsed = parseJson(text.slice(start, end + 1));
        if (parsed === null) continue;
        const value = parsed.value;
        const items = Array.isArray(value)
            ? value
            : isRecord(value) && Array.isArray(value.cards)
              ? (value.cards as unknown[])
              : null;
        const cards = items === null ? [] : validCards(items);
        if (cards.length > 0) return cards;
    }

    // A reply that was cut off, or that names the list differently: keep every complete card object
    const found: unknown[] = [];
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "{") continue;
        const end = closingIndex(text, start);
        if (end < 0) continue;
        const parsed = parseJson(text.slice(start, end + 1));
        if (parsed !== null && isRecord(parsed.value) && "front" in parsed.value) {
            found.push(parsed.value);
            start = end;
        }
    }
    const salvaged = validCards(found);
    if (salvaged.length > 0) return salvaged;

    throw new AiError(
        "format",
        "The reply did not contain any usable cards. Try again, or ask for fewer cards.",
    );
}

// MARK: writing cards

/** The two ends of a cloze in the first cloze form that is switched on; `{{answer}}` when none is. */
function clozeEnds(patterns: string[]): [string, string] {
    for (const pattern of patterns) {
        const template = pattern.replace("[123;;]", "").replace("[;;hint]", "");
        const at = template.indexOf("answer");
        if (at < 0) continue;
        const open = template.slice(0, at);
        const close = template.slice(at + "answer".length);
        if (open !== "" || close !== "") return [open, close];
    }
    return ["{{", "}}"];
}

/**
 * A card in the note's syntax. Text that would break the syntax is avoided: blank lines (they end a card), a
 * separator inside the text, and a single-line form for anything that needs two lines.
 */
export function formatGeneratedCard(card: GeneratedCard, s: SyntaxSettings): string {
    const front = tidy(card.front);
    const back = tidy(card.back);

    if (card.kind === "cloze") {
        const [open, close] = clozeEnds(s.clozePatterns);
        return front.replace(/\{\{\s*(?:c\d+::)?\s*([^{}]*?)\s*\}\}/g, (marker, answer: string) =>
            answer === "" ? marker : `${open}${answer}${close}`,
        );
    }

    if (card.kind === "choice") {
        const options = (card.options ?? []).filter((option) => oneLine(option.text) !== "");
        const lines = [
            front,
            s.multilineCardSeparator,
            ...options.map((option) => `- [${option.correct ? "x" : " "}] ${oneLine(option.text)}`),
        ];
        const explanation = tidy(card.explanation ?? "");
        if (explanation !== "") lines.push(`Explanation: ${explanation}`);
        return lines.join("\n");
    }

    const reversed = card.kind === "reversed";
    const single = reversed ? s.singleLineReversedCardSeparator : s.singleLineCardSeparator;
    const multiline = reversed ? s.multilineReversedCardSeparator : s.multilineCardSeparator;
    const clashes = (text: string) =>
        text.includes(s.singleLineCardSeparator) ||
        text.includes(s.singleLineReversedCardSeparator);
    // "Term:" + "::" would read as ":::", the separator of reversed cards
    const colonRuns = front.endsWith(":") || back.startsWith(":");
    const oneLineForm =
        !front.includes("\n") &&
        !back.includes("\n") &&
        !clashes(front) &&
        !clashes(back) &&
        !colonRuns;

    return oneLineForm ? `${front}${single}${back}` : `${front}\n${multiline}\n${back}`;
}

const FLASHCARDS_HEADING = "## Flashcards";

function isFence(line: string): boolean {
    return /^\s*(```|~~~)/.test(line);
}

/**
 * The note with the cards added at the end of its "Flashcards" section (level 2 heading), or in a new section at the
 * end of the note when there is none. A heading inside a code block does not count.
 *
 * @param tag - A flashcard tag to put above the new cards, for a note that has none; null for none.
 */
export function insertFlashcardsSection(
    noteText: string,
    cardsText: string,
    tag: string | null,
): string {
    const block = `${tag === null ? "" : `${tag}\n\n`}${cardsText}\n`;
    const lines = noteText.split("\n");

    let heading = -1;
    let inFence = false;
    for (let i = 0; i < lines.length && heading < 0; i++) {
        if (isFence(lines[i])) inFence = !inFence;
        else if (!inFence && /^##[ \t]+Flashcards[ \t]*#*[ \t]*$/i.test(lines[i])) heading = i;
    }

    if (heading < 0) {
        const body = noteText.trimEnd();
        const section = `${FLASHCARDS_HEADING}\n\n${block}`;
        return body === "" ? section : `${body}\n\n${section}`;
    }

    let end = lines.length;
    inFence = false;
    for (let i = heading + 1; i < lines.length; i++) {
        if (isFence(lines[i])) inFence = !inFence;
        else if (!inFence && /^#{1,2}[ \t]/.test(lines[i])) {
            end = i;
            break;
        }
    }
    const before = lines.slice(0, end).join("\n").trimEnd();
    const after = lines.slice(end);
    return `${before}\n\n${block}${after.length === 0 ? "" : `\n${after.join("\n")}`}`;
}

/** The text of a new note that holds only the cards. */
export function newFlashcardsNoteText(cardsText: string, tag: string | null): string {
    return `${tag === null ? "" : `${tag}\n\n`}${cardsText}\n`;
}

/** `<title> - flashcards.md` in the folder, or with a number when that name is taken. */
export function freeFlashcardsNotePath(
    folder: string,
    title: string,
    exists: (path: string) => boolean,
): string {
    const prefix = folder === "" ? "" : `${folder}/`;
    for (let n = 1; ; n++) {
        const path = `${prefix}${title} - flashcards${n === 1 ? "" : ` ${n}`}.md`;
        if (!exists(path)) return path;
    }
}
