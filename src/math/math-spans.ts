/** Finding the `$...$` and `$$...$$` formulas in note text, skipping code. */

export interface MathSpan {
    /** Index of the opening delimiter. */
    start: number;
    /** Index just past the closing delimiter. */
    end: number;
}

const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";
const PLACEHOLDER = new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, "g");

const FENCE_OPENER = /^ *(`{3,}|~{3,})/;

/** Length of the run of `char` that starts at `at`. */
function runLength(line: string, at: number, char: string): number {
    let end = at;
    while (line[end] === char) end++;
    return end - at;
}

/** Where the code span opened by the backtick run at `at` ends, or -1 when the line never closes it. */
function codeSpanEnd(line: string, at: number, ticks: number): number {
    for (let from = at + ticks; from < line.length;) {
        if (line[from] !== "`") {
            from++;
            continue;
        }
        const run = runLength(line, from, "`");
        if (run === ticks) return from + run;
        from += run;
    }
    return -1;
}

/** Where the inline formula opened at `at` ends (exclusive), or -1 when this `$` opens nothing. */
function inlineEnd(line: string, at: number): number {
    const first = line[at + 1];
    if (first === undefined || /\s/.test(first)) return -1;
    for (let at2 = at + 1; at2 < line.length; at2++) {
        const char = line[at2];
        if (char === "\\") {
            at2++;
        } else if (char === "$") {
            if (line[at2 + 1] === "$") return -1;
            if (!/\s/.test(line[at2 - 1]) && !/\d/.test(line[at2 + 1] ?? "")) return at2 + 1;
        }
    }
    return -1;
}

/** Every formula in `text`, in order. Offsets count UTF-16 units of the original string. */
export function findMathSpans(text: string): MathSpan[] {
    const spans: MathSpan[] = [];
    let displayStart = -1;
    let fence: { char: string; length: number } | null = null;
    let offset = 0;

    for (const line of text.split("\n")) {
        const lineStart = offset;
        offset += line.length + 1;

        if (fence) {
            if (runLength(line.replace(/^ */, ""), 0, fence.char) >= fence.length) fence = null;
            continue;
        }
        if (displayStart < 0) {
            const opener = FENCE_OPENER.exec(line);
            if (opener) {
                fence = { char: opener[1][0], length: opener[1].length };
                continue;
            }
        }

        for (let at = 0; at < line.length;) {
            const char = line[at];
            if (char === "\\") {
                at += 2;
            } else if (displayStart >= 0) {
                if (line.startsWith("$$", at)) {
                    spans.push({ start: displayStart, end: lineStart + at + 2 });
                    displayStart = -1;
                    at += 2;
                } else {
                    at++;
                }
            } else if (char === "`") {
                const ticks = runLength(line, at, "`");
                const closed = codeSpanEnd(line, at, ticks);
                at = closed < 0 ? at + ticks : closed;
            } else if (line.startsWith("$$", at)) {
                displayStart = lineStart + at;
                at += 2;
            } else if (char === "$") {
                const end = inlineEnd(line, at);
                if (end < 0) {
                    at++;
                } else {
                    spans.push({ start: lineStart + at, end: lineStart + end });
                    at = end;
                }
            } else {
                at++;
            }
        }
    }
    return spans;
}

/** `text` with every character blanked whose membership in a span differs from `keepInside`; newlines stay. */
function blank(text: string, spans: MathSpan[], keepInside: boolean): string {
    const inside = new Uint8Array(text.length);
    for (const { start, end } of spans) inside.fill(1, start, end);
    return text
        .split("")
        .map((char, at) => (char === "\n" || Boolean(inside[at]) === keepInside ? char : " "))
        .join("");
}

/** The text with every formula blanked out, and the formulas with all the text blanked out. */
export function splitMath(
    text: string,
    spans: MathSpan[] = findMathSpans(text),
): { textOnly: string; mathOnly: string } {
    return { textOnly: blank(text, spans, false), mathOnly: blank(text, spans, true) };
}

/**
 * Swaps each formula for an opaque placeholder so text patterns cannot match its braces.
 * Matches of `keep` (a global regexp) stay visible inside formulas; the pieces between them are masked.
 * `restore` puts the originals back; a placeholder it does not know is left as it is.
 */
export function maskMath(
    text: string,
    keep?: RegExp,
): { masked: string; restore: (s: string) => string } {
    const spans = findMathSpans(text);
    if (spans.length === 0) return { masked: text, restore: (s) => s };

    const originals: string[] = [];
    const hide = (piece: string): string => {
        if (piece === "") return "";
        originals.push(piece);
        return `${PLACEHOLDER_OPEN}${originals.length - 1}${PLACEHOLDER_CLOSE}`;
    };

    let masked = "";
    let done = 0;
    for (const { start, end } of spans) {
        masked += text.slice(done, start);
        const formula = text.slice(start, end);
        if (!keep) {
            masked += hide(formula);
        } else {
            const finder = new RegExp(
                keep.source,
                keep.flags.includes("g") ? keep.flags : keep.flags + "g",
            );
            let from = 0;
            for (let hit = finder.exec(formula); hit; hit = finder.exec(formula)) {
                if (hit[0] === "") {
                    finder.lastIndex++;
                    continue;
                }
                masked += hide(formula.slice(from, hit.index)) + hit[0];
                from = hit.index + hit[0].length;
            }
            masked += hide(formula.slice(from));
        }
        done = end;
    }
    masked += text.slice(done);

    return {
        masked,
        restore: (s) =>
            s.replace(PLACEHOLDER, (whole, index: string) => originals[Number(index)] ?? whole),
    };
}
