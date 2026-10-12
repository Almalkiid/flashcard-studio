/**
 * Finding the lines of a card in a note again. The parser reports a card as a run of lines; a write goes to that run,
 * after checking the lines still hold the card, so a card that appears twice (or is the start of another card) is
 * never mistaken for its look-alike.
 */

/** A run of lines, 0-based, both ends included; `offset` is where the first line starts in the text, once known. */
export interface LineSpan {
    first: number;
    last: number;
    offset?: number;
}

/** A run of lines found in a note: where it starts and ends in the text and the blank padding around the card text. */
export interface Region {
    span: LineSpan;
    /** Offset of the first character of the first line. */
    start: number;
    /** Offset after the last character of the last line, before its line ending. */
    end: number;
    /** Whitespace in front of and behind the card text inside the run; kept when the run is rewritten. */
    pre: string;
    post: string;
    /** The line ending of the note around the run, for the lines a rewrite adds. */
    ending: string;
}

/** The offset where each line starts. "\n", "\r\n" and a lone "\r" all end a line, as the note parser counts them. */
export function lineStarts(text: string): number[] {
    const starts = [0];
    if (!text.includes("\r")) {
        for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
            starts.push(at + 1);
        }
        return starts;
    }
    for (let at = 0; at < text.length; at++) {
        const code = text.charCodeAt(at);
        if (code === 13 && text.charCodeAt(at + 1) === 10) at++;
        if (code === 10 || code === 13) starts.push(at + 1);
    }
    return starts;
}

/** The offset where line `index` ends, before its line ending. */
function lineEnd(text: string, starts: number[], index: number): number {
    if (index + 1 >= starts.length) return text.length;
    let end = starts[index + 1];
    if (text.charCodeAt(end - 1) === 10) end--;
    if (text.charCodeAt(end - 1) === 13) end--;
    return end;
}

/** The line ending after line `index`, or the one of the nearest line before it; "\n" when the note has none. */
function lineEndingNear(text: string, starts: number[], index: number): string {
    for (let at = Math.min(index, starts.length - 2); at >= 0; at--) {
        const raw = text.slice(lineEnd(text, starts, at), starts[at + 1]);
        if (raw !== "") return raw;
    }
    return "\n";
}

const hasSameTrimmedLines = (a: string, b: string): boolean => {
    const left = a.split("\n");
    const right = b.split("\n");
    return left.length === right.length && left.every((line, i) => line.trim() === right[i].trim());
};

/** How the text of a run of lines holds the card text, or null when it does not. */
function fit(run: string, card: string): [pre: string, post: string] | null {
    if (run === card) return ["", ""];
    const at = run.indexOf(card);
    if (at !== -1 && run.slice(0, at).trim() === "" && run.slice(at + card.length).trim() === "") {
        return [run.slice(0, at), run.slice(at + card.length)];
    }
    // The padding of some lines differs: the run is replaced as a whole
    return hasSameTrimmedLines(run, card) ? ["", ""] : null;
}

/** The number of line breaks before an offset: the 0-based line the offset is on. */
function lineAt(text: string, offset: number): number {
    let line = 0;
    if (!text.includes("\r")) {
        for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1))
            line++;
        return line;
    }
    for (let at = 0; at < offset; at++) {
        const code = text.charCodeAt(at);
        if (code === 13 && text.charCodeAt(at + 1) === 10) at++;
        if (code === 10 || code === 13) line++;
    }
    return line;
}

const isLineBreak = (code: number): boolean => code === 10 || code === 13;

/** The line ending that starts at `offset`; "" at the end of the text. */
const endingFrom = (text: string, offset: number): string =>
    text.startsWith("\r\n", offset)
        ? "\r\n"
        : isLineBreak(text.charCodeAt(offset))
          ? text[offset]
          : "";

/** The line ending that ends right before `offset`; "" at the start of the text. */
const endingBefore = (text: string, offset: number): string =>
    offset >= 2 && text.startsWith("\r\n", offset - 2)
        ? "\r\n"
        : offset >= 1 && isLineBreak(text.charCodeAt(offset - 1))
          ? text[offset - 1]
          : "";

/** The card where it was last known to start, if it is still there as whole lines. */
function findAtOffset(text: string, card: string, readAt: LineSpan): Region | null {
    const start = readAt.offset;
    const end = start + card.length;
    if (
        !text.startsWith(card, start) ||
        (start > 0 && !isLineBreak(text.charCodeAt(start - 1))) ||
        (end < text.length && !isLineBreak(text.charCodeAt(end)))
    ) {
        return null;
    }
    const last = readAt.first + card.split("\n").length - 1;
    const ending = endingFrom(text, end) || endingBefore(text, start) || "\n";
    return {
        span: { first: readAt.first, last, offset: start },
        start,
        end,
        pre: "",
        post: "",
        ending,
    };
}

/**
 * The common case, found without looking at every line: the card is in the note as it is, as whole lines. A card that
 * appears more than once is the one on the line it was read from.
 */
function findWholeLines(
    text: string,
    card: string,
    readAt: LineSpan | null,
): Region | null | undefined {
    const found: number[] = [];
    for (let at = text.indexOf(card); at !== -1; at = text.indexOf(card, at + 1)) {
        const end = at + card.length;
        if (
            (at === 0 || isLineBreak(text.charCodeAt(at - 1))) &&
            (end === text.length || isLineBreak(text.charCodeAt(end)))
        ) {
            found.push(at);
        }
    }
    if (found.length === 0) return undefined;

    const lines = card.split("\n").length;
    const regions = found.map((start) => {
        const first = lineAt(text, start);
        const end = start + card.length;
        const ending = endingFrom(text, end) || endingBefore(text, start) || "\n";
        return {
            span: { first, last: first + lines - 1, offset: start },
            start,
            end,
            pre: "",
            post: "",
            ending,
        };
    });
    if (regions.length === 1) return regions[0];
    return regions.find((region) => region.span.first === readAt?.first) ?? null;
}

/**
 * Finds the card text (with LF line endings) in a note. The lines the card was read from are tried first. When the
 * note changed since (lines moved), the card is looked for line by line instead, and found only if there is exactly
 * one such place: with look-alikes there is no telling which one is meant.
 *
 * @returns Null when the note no longer holds the card.
 */
export function findCard(text: string, card: string, readAt: LineSpan | null): Region | null {
    if (card === "") return null;
    if (readAt?.offset !== undefined) {
        const there = findAtOffset(text, card, readAt);
        if (there !== null) return there;
    }
    const whole = findWholeLines(text, card, readAt);
    if (whole !== undefined) return whole;

    const starts = lineStarts(text);
    const runAt = (span: LineSpan): Region | null => {
        if (span.first < 0 || span.last >= starts.length || span.last < span.first) return null;
        const start = starts[span.first];
        const end = lineEnd(text, starts, span.last);
        const raw = text.slice(start, end);
        const padding = fit(raw.includes("\r") ? raw.replace(/\r\n?/g, "\n") : raw, card);
        if (padding === null) return null;
        const ending = lineEndingNear(text, starts, span.first);
        return {
            span: { ...span, offset: start },
            start,
            end,
            pre: padding[0],
            post: padding[1],
            ending,
        };
    };

    if (readAt !== null) {
        const found = runAt(readAt);
        if (found !== null) return found;
    }

    const wanted = card.split("\n");
    const firstLine = wanted[0].trim();
    let only: Region | null = null;
    for (let first = 0; first + wanted.length <= starts.length; first++) {
        if (text.slice(starts[first], lineEnd(text, starts, first)).trim() !== firstLine) continue;
        const found = runAt({ first, last: first + wanted.length - 1 });
        if (found === null) continue;
        if (only !== null) return null;
        only = found;
    }
    return only;
}

/** The note text with the run of lines replaced by `replacement` (LF line endings), keeping the note's line endings. */
export function replaceCard(text: string, region: Region, replacement: string): string {
    const inserted =
        region.ending === "\n" ? replacement : replacement.replace(/\n/g, region.ending);
    return (
        text.slice(0, region.start) + region.pre + inserted + region.post + text.slice(region.end)
    );
}
