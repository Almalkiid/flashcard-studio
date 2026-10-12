/**
 * Anki writes clozes as `{{c1::answer::hint}}`. The `::` collides with the single-line card separator, so the
 * flashcard parser reads such a line as a `front::back` card and never as a cloze. Imported clozes are therefore
 * written in the plugin's own curly-bracket cloze syntax, `{{1;;answer;;hint}}`, which never collides.
 */

/** The cloze pattern that reads the curly-bracket syntax. It is one of the plugin's cloze presets. */
export const CURLY_CLOZE_PATTERN = "{{[123;;]answer[;;hint]}}";

interface ClozeSpan {
    text: string;
    /** The cloze numbers this text is hidden on. Text inside nested clozes is hidden on the numbers of all of them. */
    ids: number[];
    hint: string;
}

type Piece = string | ClozeSpan;

const CLOZE_START = /^\{\{c(\d+(?:,\d+)*)::/;

/** True when the text has an Anki cloze deletion. */
export function hasAnkiCloze(text: string): boolean {
    return /\{\{c\d+(?:,\d+)*::/.test(text);
}

/** Splits text into plain text and cloze spans, flattening nested clozes. Null when the braces do not balance. */
function splitClozes(text: string): Piece[] | null {
    const pieces: Piece[] = [];
    const open: { ids: number[]; firstSpan: number; hint: string | null }[] = [];
    let buffer = "";

    const activeIds = (): number[] => [...new Set(open.flatMap((frame) => frame.ids))];
    const flush = (): void => {
        if (buffer === "") return;
        const top = open[open.length - 1];
        if (top !== undefined && top.hint !== null) {
            top.hint += buffer;
        } else if (open.length === 0) {
            pieces.push(buffer);
        } else {
            if (top.firstSpan < 0) top.firstSpan = pieces.length;
            pieces.push({ text: buffer, ids: activeIds(), hint: "" });
        }
        buffer = "";
    };

    let i = 0;
    while (i < text.length) {
        const start = CLOZE_START.exec(text.slice(i));
        if (start !== null) {
            flush();
            open.push({ ids: start[1].split(",").map(Number), firstSpan: -1, hint: null });
            i += start[0].length;
        } else if (open.length > 0 && text.startsWith("}}", i)) {
            flush();
            const closed = open.pop();
            if (closed.hint !== null && closed.firstSpan >= 0) {
                (pieces[closed.firstSpan] as ClozeSpan).hint = closed.hint;
            }
            i += 2;
        } else if (
            open.length > 0 &&
            open[open.length - 1].hint === null &&
            text.startsWith("::", i)
        ) {
            flush();
            open[open.length - 1].hint = "";
            i += 2;
        } else {
            buffer += text[i];
            i++;
        }
    }
    flush();
    return open.length === 0 ? pieces : null;
}

/**
 * Rewrites the Anki clozes of a text as curly-bracket clozes.
 *
 * Clozes with one number each become `{{1;;answer;;hint}}`. Nested clozes and clozes with several numbers
 * (`{{c1,2::x}}`) have no such form, so every cloze of the text becomes an overlapping cloze whose letters tell, card
 * by card, whether it is asked (`a`) or shown (`s`): `{{as;;answer}}`. Text inside a nested cloze is split into
 * separate clozes, so a card can show several blanks where Anki shows one.
 *
 * @returns The converted text, or null when the text has no cloze or its braces do not balance, so that it is left as
 * it is.
 */
export function convertAnkiClozes(text: string): string | null {
    if (!hasAnkiCloze(text)) return null;
    const pieces = splitClozes(text);
    if (pieces === null) return null;

    const spans = pieces.filter((piece): piece is ClozeSpan => typeof piece !== "string");
    const simple = spans.every((span) => span.ids.length === 1);
    const cards = Math.max(...spans.flatMap((span) => span.ids));

    return pieces
        .map((piece) => {
            if (typeof piece === "string") return piece;
            if (piece.text === "") return "";
            const hint = piece.hint === "" ? "" : `;;${piece.hint}`;
            const label = simple
                ? String(piece.ids[0])
                : Array.from({ length: cards }, (_, index) =>
                      piece.ids.includes(index + 1) ? "a" : "s",
                  )
                      .join("")
                      .replace(/s+$/, "");
            return `{{${label};;${piece.text}${hint}}}`;
        })
        .join("");
}

/**
 * Makes sure the settings can read imported clozes, mirroring the "curly brackets to clozes" toggle of the settings
 * page. Returns true when the settings changed, so the caller can save them and tell the user.
 */
export function ensureCurlyClozePattern(settings: {
    clozePatterns: string[];
    convertCurlyBracketsToClozes: boolean;
}): boolean {
    if (settings.clozePatterns.includes(CURLY_CLOZE_PATTERN)) return false;
    settings.clozePatterns = [...settings.clozePatterns, CURLY_CLOZE_PATTERN];
    settings.convertCurlyBracketsToClozes = true;
    return true;
}
