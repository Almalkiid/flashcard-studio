// The `\cloze{answer}{hint}` LaTeX macro, for cloze deletions inside `$...$` and `$$...$$` math.
//
// The other cloze delimiters are unsuitable inside math: `==` and `**` change how the formula is
// rendered, and `{{...}}` collides with LaTeX's own braces. `\cloze` never occurs in ordinary LaTeX,
// so it has no false positives, and both arguments are read as balanced brace groups, so the answer
// may contain fractions, roots and other nested LaTeX.
//
// Each `\cloze` becomes one sibling card: the target is hidden on the front (as `[hint]`, or as `[...]`
// when there is no hint) and shown, coloured, on the back. The other macros of the note show their answer.
//
// Adapted from upstream PR #1584 "\cloze{a}{hint} in LaTeX" by ievlevpn (MIT). Changes: a cloze that is
// not inside math is rendered like an ordinary cloze instead of with `\color`; macros are counted so the
// parser can size a line's cards; and `==x==` clozes in the same card are handled by the caller (question-type.ts).
//
// This is a leaf module (it imports nothing), so the parser and the card expansion can both use it.

const CLOZE_COLOR = "#2196f3";
const COMMAND = "\\cloze";

interface MathCloze {
    start: number; // index of the leading backslash
    end: number; // index just past the closing brace of the hint argument
    answer: string;
    hint: string;
}

/** How a cloze that is NOT inside math is drawn. */
export interface PlainClozeFormatter {
    asking(answer?: string, hint?: string): string;
    showingAnswer(answer: string, hint?: string): string;
}

/**
 * Whether `text` contains at least one `\cloze{...}{...}` macro.
 */
export function containsMathCloze(text: string): boolean {
    return findMathClozes(text).length > 0;
}

/**
 * The number of `\cloze{...}{...}` macros in `text`, that is the number of cards they produce.
 */
export function countMathClozes(text: string): number {
    return findMathClozes(text).length;
}

/**
 * `text` with every `\cloze{answer}{hint}` replaced by its answer.
 */
export function replaceMathClozesWithAnswers(text: string): string {
    const clozes = findMathClozes(text);
    if (clozes.length === 0) return text;
    return renderCard(text, clozes, -1, false, null);
}

/**
 * Expands the `\cloze{answer}{hint}` macros in `text` into one card per macro.
 *
 * @param text - The card text, typically containing `$...$` / `$$...$$` math
 * @param formatter - Draws a macro that is not inside math
 * @returns One `{ front, back }` per macro
 */
export function expandMathClozes(
    text: string,
    formatter: PlainClozeFormatter,
): { front: string; back: string }[] {
    const clozes = findMathClozes(text);
    const cards: { front: string; back: string }[] = [];
    for (let target = 0; target < clozes.length; target++) {
        cards.push({
            front: renderCard(text, clozes, target, false, formatter),
            back: renderCard(text, clozes, target, true, formatter),
        });
    }
    return cards;
}

function renderCard(
    text: string,
    clozes: MathCloze[],
    targetIndex: number,
    isBack: boolean,
    formatter: PlainClozeFormatter | null,
): string {
    const regions = mathRegions(text);
    let out = "";
    let cursor = 0;
    for (let k = 0; k < clozes.length; k++) {
        const cloze = clozes[k];
        out += text.slice(cursor, cloze.start);
        if (k !== targetIndex) {
            out += cloze.answer; // shown normally on every other card
        } else if (isInsideMath(regions, cloze.start)) {
            out += mathRendering(cloze, isBack);
        } else if (formatter) {
            const hint = cloze.hint.trim() || undefined;
            out += isBack
                ? formatter.showingAnswer(cloze.answer, hint)
                : formatter.asking(cloze.answer, hint);
        } else {
            out += cloze.answer;
        }
        cursor = cloze.end;
    }
    return out + text.slice(cursor);
}

function mathRendering(cloze: MathCloze, isBack: boolean): string {
    if (isBack) return `\\color{${CLOZE_COLOR}}{${cloze.answer}}`;
    const hint = cloze.hint.trim();
    const placeholder = hint.length > 0 ? `[\\text{${hint}}]` : "[\\ldots]";
    return `\\color{${CLOZE_COLOR}}{${placeholder}}`;
}

// Locates every `\cloze{answer}{hint}`, reading both arguments as balanced brace groups.
function findMathClozes(text: string): MathCloze[] {
    const result: MathCloze[] = [];
    let i = text.indexOf(COMMAND);
    while (i !== -1) {
        const after = i + COMMAND.length;
        // `\clozeXYZ` is a different command: a TeX command name continues with letters
        if (/[a-zA-Z]/.test(text[after] ?? "")) {
            i = text.indexOf(COMMAND, after);
            continue;
        }
        const answer = readBraceGroup(text, after);
        const hint = answer && readBraceGroup(text, answer.end);
        if (answer && hint) {
            result.push({ start: i, end: hint.end, answer: answer.content, hint: hint.content });
            i = text.indexOf(COMMAND, hint.end);
        } else {
            i = text.indexOf(COMMAND, after);
        }
    }
    return result;
}

// From `pos` (skipping whitespace), reads a `{ ... }` group with balanced braces, ignoring escaped
// braces (\{ \}). Returns the inner content and the index past the closing brace, or null.
function readBraceGroup(text: string, pos: number): { content: string; end: number } | null {
    let p = pos;
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== "{") return null;

    let depth = 0;
    for (let j = p; j < text.length; j++) {
        const ch = text[j];
        if (ch === "\\") {
            j++; // skip the escaped character (\{ \} \\)
            continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return { content: text.slice(p + 1, j), end: j + 1 };
        }
    }
    return null;
}

// The [start, end) ranges of `$...$` and `$$...$$` math. Escaped dollars and code spans are skipped, a
// delimiter that is never closed does not start math, and inline math does not cross a line.
function mathRegions(text: string): [number, number][] {
    const regions: [number, number][] = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\\") {
            i += 2;
        } else if (ch === "`") {
            let run = 1;
            while (text[i + run] === "`") run++;
            const closing = text.indexOf("`".repeat(run), i + run);
            i = closing === -1 ? i + run : closing + run;
        } else if (ch === "$") {
            const display = text[i + 1] === "$";
            const delimiter = display ? "$$" : "$";
            const close = findClosingDollar(text, i + delimiter.length, delimiter, !display);
            if (close === -1) {
                i += delimiter.length;
            } else {
                regions.push([i, close + delimiter.length]);
                i = close + delimiter.length;
            }
        } else {
            i++;
        }
    }
    return regions;
}

function findClosingDollar(
    text: string,
    from: number,
    delimiter: string,
    stopAtNewline: boolean,
): number {
    for (let j = from; j < text.length; j++) {
        if (text[j] === "\\") {
            j++;
        } else if (stopAtNewline && text[j] === "\n") {
            return -1;
        } else if (text.startsWith(delimiter, j)) {
            return j;
        }
    }
    return -1;
}

function isInsideMath(regions: [number, number][], index: number): boolean {
    return regions.some(([start, end]) => index >= start && index < end);
}
