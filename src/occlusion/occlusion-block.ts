/**
 * The image occlusion block: a fenced block in a note that holds an image and the masks drawn on it.
 *
 * ```image-occlusion
 * image: [[Heart.png]]
 * mode: hide-all
 * question: Name the labelled chamber
 * mask: a1 rect 0.1250 0.3000 0.1800 0.0950 | Left ventricle
 * ```
 *
 * One item per line. Coordinates are fractions of the image, so a mask fits the image at any size. A hand-edited
 * block that is broken is not a block: nothing in here throws, it gives null and the note's other cards are unharmed.
 */

export const OCCLUSION_LANG = "image-occlusion";

export type MaskShape = "rect" | "ellipse";
export type OcclusionMode = "hide-all" | "hide-one";

export interface OcclusionMask {
    id: string;
    shape: MaskShape;
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
}

export interface OcclusionBlock {
    image: string;
    mode: OcclusionMode;
    question: string;
    masks: OcclusionMask[];
}

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
const MASK_LINE = new RegExp(
    String.raw`^([\w-]+)\s+(rect|ellipse)\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s*\|(.*)$`,
    "i",
);
const KEY_LINE = /^\s*(image|mode|question|mask)\s*:(.*)$/i;
const FENCE_START = /^(`{3,}|~{3,})image-occlusion\s*$/;
const FENCE_LINE = /^(`{3,}|~{3,})\s*$/;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
// Four decimals is what the block holds, so a value read from a note is the same value after a round trip
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const oneLine = (text: string): string => text.replaceAll(/\s*\r?\n\s*/g, " ").trim();

/** One mask line, or null when it is not one, has a number that is not finite, or would show nothing. */
function parseMask(value: string): OcclusionMask | null {
    const match = MASK_LINE.exec(value.trim());
    if (match === null) return null;

    const [x, y, w, h] = [match[3], match[4], match[5], match[6]].map(Number);
    if (![x, y, w, h].every(Number.isFinite)) return null;

    const left = round4(clamp01(x));
    const top = round4(clamp01(y));
    const width = round4(Math.min(w, 1 - left));
    const height = round4(Math.min(h, 1 - top));
    if (width <= 0 || height <= 0) return null;

    return {
        id: match[1],
        shape: match[2].toLowerCase() as MaskShape,
        x: left,
        y: top,
        w: width,
        h: height,
        label: match[7].trim(),
    };
}

/** Parses the text between the fences. Null when there is no image or no valid mask. */
export function parseOcclusionBlock(source: string): OcclusionBlock | null {
    const block: OcclusionBlock = { image: "", mode: "hide-all", question: "", masks: [] };

    for (const line of source.split("\n")) {
        const key = KEY_LINE.exec(line.trimEnd());
        if (key === null) continue;

        const name = key[1].toLowerCase();
        const value = key[2].trim();
        if (name === "image") block.image = value;
        else if (name === "question") block.question = value;
        else if (name === "mode")
            block.mode = value.toLowerCase() === "hide-one" ? "hide-one" : "hide-all";
        else {
            const mask = parseMask(value);
            if (mask !== null) block.masks.push(mask);
        }
    }

    return block.image.length > 0 && block.masks.length > 0 ? block : null;
}

/** The text between the fences, in the canonical order: image, mode, question (if any), masks. */
export function formatOcclusionBlock(block: OcclusionBlock): string {
    const lines = [`image: ${oneLine(block.image)}`, `mode: ${block.mode}`];
    const question = oneLine(block.question);
    if (question.length > 0) lines.push(`question: ${question}`);

    for (const mask of block.masks) {
        const numbers = [mask.x, mask.y, mask.w, mask.h].map((n) => clamp01(n).toFixed(4));
        const label = oneLine(mask.label);
        lines.push(
            `mask: ${mask.id} ${mask.shape} ${numbers.join(" ")} |${label ? " " + label : ""}`,
        );
    }
    return lines.join("\n");
}

/** Whether a line opens an occlusion block: ```image-occlusion or ~~~image-occlusion, trimmed. */
export function isOcclusionFenceStart(line: string): boolean {
    return FENCE_START.test(line.trim());
}

/**
 * The index of the line that closes the fence opened on lines[open], or -1 when it is never closed. A closing fence
 * is made of the same character, at least as many of them, and nothing else.
 */
export function closingFenceLine(lines: string[], open: number): number {
    const opening = FENCE_START.exec(lines[open].trim());
    if (opening === null) return -1;
    const fence = opening[1];

    for (let i = open + 1; i < lines.length; i++) {
        const closing = FENCE_LINE.exec(lines[i].trim());
        if (closing !== null && closing[1][0] === fence[0] && closing[1].length >= fence.length)
            return i;
    }
    return -1;
}

/**
 * From a whole question text (the fences, and possibly the schedule comment after them), the text between the fences.
 * Null when the text is not an occlusion block.
 */
export function occlusionSourceOf(questionText: string): string | null {
    const lines = questionText.split("\n");
    if (!isOcclusionFenceStart(lines[0])) return null;

    const close = closingFenceLine(lines, 0);
    return close === -1 ? null : lines.slice(1, close).join("\n");
}

/** A new mask id of three characters, [a-z0-9], that none of `existing` has. */
export function newMaskId(existing: string[]): string {
    const taken = new Set(existing);
    let id: string;
    do {
        id = "";
        for (let i = 0; i < 3; i++)
            id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    } while (taken.has(id));
    return id;
}
