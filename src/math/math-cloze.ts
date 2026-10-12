/**
 * Clozes inside math. With the "Clozes in math" setting on, `\cloze[seq]{answer}{hint}` is a deletion.
 * Each macro is swapped for a private-use token that clozecraft's pattern machinery can see, while all
 * other math is masked so the user's own patterns never match LaTeX braces. Cards come back through
 * `render`, which restores the masked math and turns leftover tokens into their plain answers.
 */
import { ClozeCrafter, IClozeFormatter } from "clozecraft";

import { findMathSpans, maskMath, MathSpan } from "src/math/math-spans";

type ClozeNote = NonNullable<ReturnType<ClozeCrafter["createClozeNote"]>>;

const OPEN = "";
const CLOSE = "";
const SEP = "";
const KEY = "";

/** clozecraft pattern for a token: `[seq SEP] answer [SEP hint]` between OPEN and CLOSE. */
export const MATH_CLOZE_PATTERN = `${OPEN}[123${SEP}]answer[${SEP}hint]${CLOSE}`;
/** A whole token; stays visible when math is masked. */
export const MATH_CLOZE_TOKEN = new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, "g");

export interface MathCloze {
    /** Index of the backslash. */
    start: number;
    /** Index just past the last consumed brace. */
    end: number;
    seq: string | null;
    answer: string;
    hint: string;
    inMath: boolean;
}

const KEYED = new RegExp(`${KEY}(\\d+)${KEY}`, "g");
const KEYED_EXACT = new RegExp(`^${KEY}(\\d+)${KEY}$`);
const TOKEN_WITH_KEY = new RegExp(
    `${OPEN}[^${CLOSE}]*?${KEY}(\\d+)${KEY}[^${CLOSE}]*${CLOSE}`,
    "g",
);

/** True when the text holds an unescaped `\cloze` followed by `[` or `{`; arguments are not checked. */
export function containsMathCloze(text: string): boolean {
    for (const hit of text.matchAll(/(\\*)\\cloze\s*[[{]/g)) {
        if (hit[1].length % 2 === 0) return true;
    }
    return false;
}

/** The brace group opening at `at`: its inside and the index past its closing brace; null if never closed. */
function braceGroup(text: string, at: number): { inside: string; end: number } | null {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
        const char = text[i];
        if (char === "\\") i++;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0)
            return { inside: text.slice(at + 1, i), end: i + 1 };
    }
    return null;
}

const skipSpace = (text: string, at: number): number => {
    while (at < text.length && /\s/.test(text[at])) at++;
    return at;
};

/** The macro whose `\cloze` starts at `start`, or null when it is malformed (the text then stays as it is). */
function readMacro(text: string, start: number): Omit<MathCloze, "inMath"> | null {
    let at = start + "\\cloze".length;
    if (/[A-Za-z]/.test(text[at] ?? "")) return null;

    let seq: string | null = null;
    at = skipSpace(text, at);
    if (text[at] === "[") {
        const close = text.indexOf("]", at);
        if (close < 0) return null;
        const inside = text.slice(at + 1, close).trim();
        if (!/^(\d+|[ahs]+)$/.test(inside)) return null;
        seq = inside;
        at = close + 1;
    }

    at = skipSpace(text, at);
    if (text[at] !== "{") return null;
    const answer = braceGroup(text, at);
    if (!answer) return null;

    const next = skipSpace(text, answer.end);
    if (text[next] !== "{") return { start, end: answer.end, seq, answer: answer.inside, hint: "" };
    const hint = braceGroup(text, next);
    if (!hint) return null;
    return { start, end: hint.end, seq, answer: answer.inside, hint: hint.inside };
}

/** Swaps every valid macro for a token, in order; `clozes[k]` belongs to the token with key k. */
export function tokenizeMathClozes(text: string): { text: string; clozes: MathCloze[] } {
    const clozes: MathCloze[] = [];
    let spans: MathSpan[] | null = null;
    let tokenized = "";
    let copied = 0;

    for (let at = text.indexOf("\\cloze"); at >= 0; at = text.indexOf("\\cloze", at + 1)) {
        if (at < copied) continue;
        const macro = readMacro(text, at);
        if (!macro) continue;
        spans ??= findMathSpans(text);
        const inMath = spans.some((span) => at >= span.start && at < span.end);
        tokenized += text.slice(copied, at);
        tokenized += `${OPEN}${macro.seq === null ? "" : macro.seq + SEP}${KEY}${clozes.length}${KEY}${CLOSE}`;
        clozes.push({ ...macro, inMath });
        copied = macro.end;
    }
    return { text: clozes.length === 0 ? text : tokenized + text.slice(copied), clozes };
}

/**
 * Puts the plain answer back for every token or bare key. A space goes in only where TeX would
 * otherwise read a command name and the next letter as one word. A key with no cloze stays as it is.
 */
export function restoreMathClozes(text: string, clozes: MathCloze[]): string {
    const put = (source: string, pattern: RegExp): string => {
        let out = "";
        let done = 0;
        for (const hit of source.matchAll(pattern)) {
            const cloze = clozes[Number(hit[1])];
            out += source.slice(done, hit.index);
            done = hit.index + hit[0].length;
            if (!cloze) {
                out += hit[0];
                continue;
            }
            const answer = cloze.answer;
            const after = source.slice(done);
            if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(answer)) out += " ";
            out += answer;
            if (/\\[A-Za-z]+$/.test(answer) && new RegExp(`^[A-Za-z${OPEN}${KEY}]`).test(after))
                out += " ";
        }
        return out + source.slice(done);
    };
    return put(put(text, TOKEN_WITH_KEY), KEYED);
}

const clozeOf = (clozes: MathCloze[], answer: string | undefined): MathCloze | undefined => {
    const index = answer === undefined || answer === null ? null : KEYED_EXACT.exec(answer)?.[1];
    return index === null || index === undefined ? undefined : clozes[Number(index)];
};

const placeholder = (hint: string): string => {
    const shown = hint.trim();
    return shown === "" ? "[\\ldots]" : `[\\text{${shown}}]`;
};

const colored = (colour: string, body: string): string => `{\\color{${colour}}{${body}}}`;

/** Draws macro deletions as LaTeX colour markup inside math, and with the inner formatter outside it. */
export class MathClozeFormatter implements IClozeFormatter {
    constructor(
        private readonly inner: IClozeFormatter,
        private readonly clozes: MathCloze[],
    ) {}

    asking(answer: string, hint: string): string {
        return this.draw("asking", answer, hint, (c) => colored("#2196f3", placeholder(c.hint)));
    }

    showingAnswer(answer: string, hint: string): string {
        return this.draw("showingAnswer", answer, hint, (c) => colored("#2196f3", c.answer));
    }

    hiding(answer: string, hint: string): string {
        return this.draw("hiding", answer, hint, (c) => colored("gray", placeholder(c.hint)));
    }

    private draw(
        how: "asking" | "showingAnswer" | "hiding",
        answer: string,
        hint: string,
        inMath: (cloze: MathCloze) => string,
    ): string {
        const cloze = clozeOf(this.clozes, answer);
        if (!cloze) return this.inner[how](answer, hint);
        if (cloze.inMath) return inMath(cloze);
        return this.inner[how](cloze.answer, cloze.hint.trim() || undefined);
    }
}

export interface MadeClozeNote {
    note: ClozeNote | null;
    formatter: IClozeFormatter;
    /** Turns a side of a card back into the user's text. */
    render: (side: string) => string;
}

/** Tokenised text with its macros, math masked or not, and the patterns that read it. */
function prepare(
    text: string,
    patterns: string[],
    maskTheMath: boolean,
): { crafter: ClozeCrafter; text: string; clozes: MathCloze[]; restore: (s: string) => string } {
    const { text: tokenized, clozes } = tokenizeMathClozes(text);
    const { masked, restore } = maskTheMath
        ? maskMath(tokenized, MATH_CLOZE_TOKEN)
        : { masked: tokenized, restore: (s: string) => s };
    const all = clozes.length > 0 ? [...patterns, MATH_CLOZE_PATTERN] : patterns;
    return { crafter: new ClozeCrafter(all), text: masked, clozes, restore };
}

export function createClozeNote(
    text: string,
    patterns: string[],
    latexClozes: boolean,
    formatter: IClozeFormatter,
): MadeClozeNote {
    if (!latexClozes) {
        return {
            note: new ClozeCrafter(patterns).createClozeNote(text),
            formatter,
            render: (s) => s,
        };
    }
    const made = prepare(text, patterns, true);
    return {
        note: made.crafter.createClozeNote(made.text),
        formatter: new MathClozeFormatter(formatter, made.clozes),
        render: (side) => restoreMathClozes(made.restore(side), made.clozes),
    };
}

interface Mark {
    how: string;
    answer: string;
    hint: string;
}

/** Cards of the note as they were read before math was masked: one list of marks per card front. */
function signatures(
    text: string,
    patterns: string[],
    maskTheMath: boolean,
    marks: Mark[],
): string[] | null {
    const made = prepare(text, patterns, maskTheMath);
    const note = made.crafter.createClozeNote(made.text);
    if (!note) return null;
    const mark =
        (how: string) =>
        (answer: string, hint: string): string => {
            marks.push({ how, answer, hint });
            return `${marks.length - 1}`;
        };
    const recorder: IClozeFormatter = {
        asking: mark("ask"),
        showingAnswer: mark("show"),
        hiding: mark("hide"),
    };
    return Array.from({ length: note.numCards }, (_unused, card) => {
        const front = note.getCardFront(card, recorder);
        const spans = findMathSpans(front);
        const kept: Mark[] = [];
        for (const hit of front.matchAll(/(\d+)/g)) {
            const found = marks[Number(hit[1])];
            const insideMath = spans.some((s) => hit.index >= s.start && hit.index < s.end);
            if (!insideMath || found.answer.startsWith(KEY)) kept.push(found);
        }
        return JSON.stringify(kept);
    });
}

/**
 * Before masking existed, the user's patterns also applied inside formulas. For a note scheduled back
 * then, says which old card each new card is: the index of the first unused old card that asks the
 * same things outside math. Null when the two readings agree, so nothing needs re-attaching.
 */
export function legacyClozeCardIndices(text: string, patterns: string[]): number[] | null {
    const fresh = signatures(text, patterns, true, []) ?? [];
    const old = signatures(text, patterns, false, []) ?? [];
    if (fresh.length === old.length && fresh.every((sign, card) => sign === old[card])) return null;

    const used = new Set<number>();
    return fresh.map((sign) => {
        const match = old.findIndex((other, card) => !used.has(card) && other === sign);
        if (match >= 0) used.add(match);
        return match;
    });
}
