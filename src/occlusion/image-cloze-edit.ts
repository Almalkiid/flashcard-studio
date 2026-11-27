/**
 * Writing an edited image cloze block back into its note, and where a new block goes. The block's schedule comment is
 * never touched here: its segments carry card numbers, so they stay right whatever the masks do.
 */
import { createClozeNote } from "src/math/math-cloze";
import {
    formatImageClozeBlock,
    ImageClozeBlock,
    parseImageClozeBlock,
    scanImageClozeFences,
} from "src/occlusion/image-cloze-block";

/** The canonical text of each block at the left edge that is closed and readable, by its opening line. */
function canonicalBlocks(lines: string[]): Map<number, string> {
    const blocks = new Map<number, string>();
    for (const span of scanImageClozeFences(lines)) {
        if (!span.leftEdge || !span.closed) continue;
        const read = parseImageClozeBlock(lines.slice(span.open + 1, span.close).join("\n"));
        if (read.ok === true) blocks.set(span.open, formatImageClozeBlock(read.block));
    }
    return blocks;
}

/**
 * Replaces the lines between the fences of the block that opens on `openLine` (counted from 0) with `block`. The fences
 * themselves, and every other line of the note, stay as they were. A note with no closed block at the left edge on that
 * line is returned unchanged.
 */
export function replaceImageClozeBlock(
    text: string,
    openLine: number,
    block: ImageClozeBlock,
): string {
    const lines = text.split("\n");
    const span = scanImageClozeFences(lines).find(
        (one) => one.open === openLine && one.leftEdge && one.closed,
    );
    if (span === undefined) return text;
    lines.splice(
        span.open + 1,
        span.close - span.open - 1,
        ...formatImageClozeBlock(block).split("\n"),
    );
    return lines.join("\n");
}

/**
 * Where, in a note, the block an editor was opened on is now. The note may have changed since: the block on its line
 * when it still has the content it had, else the one block in the note with that content; otherwise not found, or not
 * certain which (the same block twice), and the caller changes nothing. As `locateOcclusionBlock`.
 */
export function locateImageClozeBlock(
    text: string,
    lineHint: number,
    original: ImageClozeBlock,
): number | "not-found" | "ambiguous" {
    const wanted = formatImageClozeBlock(original);
    const blocks = canonicalBlocks(text.split("\n"));
    if (blocks.get(lineHint) === wanted) return lineHint;
    const found = [...blocks].filter(([, canonical]) => canonical === wanted).map(([line]) => line);
    if (found.length === 0) return "not-found";
    return found.length === 1 ? found[0] : "ambiguous";
}

const blank = (line: string | undefined): boolean => line === undefined || line.trim() === "";

/**
 * Where a new block goes, from the cursor's line: the text to add at the end of `line`. In a cloze paragraph it goes
 * right under the paragraph's last line (above its schedule comment), so the block joins that card. Anywhere else it
 * goes on lines of its own, with one blank line before and after it.
 */
export function imageClozeInsertion(
    lines: string[],
    cursorLine: number,
    fenced: string,
    clozes: { clozePatterns: string[]; latexClozes?: boolean } = { clozePatterns: [] },
): { line: number; text: string; joined: boolean } {
    if (!blank(lines[cursorLine]) && clozes.clozePatterns.length > 0) {
        let first = cursorLine;
        while (first > 0 && !blank(lines[first - 1])) first--;
        let last = cursorLine;
        while (!blank(lines[last + 1])) last++;
        // Read as loading reads it, math clozes included, so a paragraph of math clozes is a cloze paragraph too
        const paragraph = lines.slice(first, last + 1).join("\n");
        const made = createClozeNote(paragraph, clozes.clozePatterns, clozes.latexClozes === true, {
            asking: () => "",
            showingAnswer: () => "",
            hiding: () => "",
        });
        if (made.note !== null) {
            let end = last;
            while (end > first && lines[end].startsWith("<!--SR:")) end--;
            return { line: end, text: `\n${fenced}`, joined: true };
        }
    }
    const before = blank(lines[cursorLine]) ? "\n" : "\n\n";
    const after = blank(lines[cursorLine + 1]) ? "" : "\n";
    return { line: cursorLine, text: `${before}${fenced}${after}`, joined: false };
}

/** Whether an edit leaves a question's card numbers as they were: an edit during review may not change them. */
export function sameCardNumbers(before: number[], after: number[]): boolean {
    return before.length === after.length && before.every((k, at) => k === after[at]);
}
