/**
 * The image cloze block: an image with masks that are asked like text clozes. Each mask says on which cards it is
 * asked (card numbers as in Anki, or overlap letters), and may carry a hint; the answer is the picture under it.
 *
 * ```image-cloze
 * image: [[Heart.png]]
 * mode: hide-all
 * question: Name the chamber
 * mask: 1   | a5l rect 0.3617 0.3182 0.2958 0.3116 | chamber
 * mask: ash | c9x ellipse 0.5500 0.2200 0.1400 0.0800 | valve
 * ```
 *
 * The block is strict: one line that cannot be read makes the whole block unreadable, and the reader says which line,
 * so a half-read block never makes cards or touches a schedule. The `image-occlusion` block is a different format and
 * is read elsewhere, unchanged.
 */
import { MaskShape, OcclusionMode, parseMaskGeometry } from "src/occlusion/occlusion-block";

export const IMAGE_CLOZE_LANG = "image-cloze";

/** On which cards a mask is asked: never (`0`, always hidden), on the cards listed, or one letter per card. */
export type CardField =
    { kind: "zero" } | { kind: "numbers"; numbers: number[] } | { kind: "letters"; seq: string };

export interface ImageClozeMask {
    id: string;
    field: CardField;
    /** The card field as written, trimmed: it is written back as it was. */
    fieldText: string;
    shape: MaskShape;
    x: number;
    y: number;
    w: number;
    h: number;
    hint: string;
}

export interface ImageClozeBlock {
    image: string;
    mode: OcclusionMode;
    question: string;
    masks: ImageClozeMask[];
}

export type BlockProblem =
    "field" | "geometry" | "duplicate-id" | "comment" | "no-image" | "no-mask";

/** A block, or what is wrong with it: the line (from 1, in the text between the fences; 0 for the whole block). */
export type BlockRead =
    { ok: true; block: ImageClozeBlock } | { ok: false; line: number; problem: BlockProblem };

const KEY_LINE = /^\s*(image|mode|question|mask)\s*:(.*)$/i;
const CARD_NUMBER = /^[1-9]\d?$/;
const LETTERS = /^[ash]{1,99}$/;
const ID_AND_GEOMETRY = /^([\w-]+)\s+(.+)$/;
const OPENING = /^(`{3,}|~{3,})image-cloze\s*$/;
const CLOSING = /^(`{3,}|~{3,})\s*$/;
/** Any fence that opens a code block: three or more backticks or tildes, then anything. */
const ANY_OPENING = /^(`{3,}|~{3,})/;
/** Leading spaces and quote markers: what is in front of a fence that is indented or in a quote. */
const LEAD = /^\s*(?:>\s*)*/;

const oneLine = (text: string): string => text.replaceAll(/\s*\r?\n\s*/g, " ").trim();
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** A card field, or null when it cannot be read. */
export function readCardField(text: string): CardField | null {
    const value = text.trim();
    if (value === "0") return { kind: "zero" };
    if (LETTERS.test(value)) return { kind: "letters", seq: value };

    const parts = value.split(",").map((part) => part.trim());
    if (!parts.every((part) => CARD_NUMBER.test(part))) return null;
    const numbers = [...new Set(parts.map(Number))].sort((a, b) => a - b);
    return { kind: "numbers", numbers };
}

/** One mask's value (what follows `mask:`), or the problem with it. */
function readMask(value: string): ImageClozeMask | "field" | "geometry" {
    const first = value.indexOf("|");
    const second = first < 0 ? -1 : value.indexOf("|", first + 1);
    const fieldText = (first < 0 ? value : value.slice(0, first)).trim();
    const field = readCardField(fieldText);
    if (field === null) return "field";
    if (second < 0) return "geometry";

    const placed = ID_AND_GEOMETRY.exec(value.slice(first + 1, second).trim());
    const geometry = placed === null ? null : parseMaskGeometry(placed[2]);
    if (placed === null || geometry === null) return "geometry";

    return { id: placed[1], field, fieldText, ...geometry, hint: value.slice(second + 1).trim() };
}

/** Reads the text between the fences. */
export function parseImageClozeBlock(source: string): BlockRead {
    const lines = source.split("\n");
    const withComment = lines.findIndex((line) => line.includes("<!--"));
    if (withComment >= 0) return { ok: false, line: withComment + 1, problem: "comment" };

    const block: ImageClozeBlock = { image: "", mode: "hide-all", question: "", masks: [] };
    const ids = new Set<string>();
    for (const [at, line] of lines.entries()) {
        const key = KEY_LINE.exec(line.trimEnd());
        if (key === null) continue;

        const name = key[1].toLowerCase();
        const value = key[2].trim();
        if (name === "image") block.image = value;
        else if (name === "question") block.question = value;
        else if (name === "mode")
            block.mode = value.toLowerCase() === "hide-one" ? "hide-one" : "hide-all";
        else {
            const mask = readMask(value);
            if (typeof mask === "string") return { ok: false, line: at + 1, problem: mask };
            if (ids.has(mask.id)) return { ok: false, line: at + 1, problem: "duplicate-id" };
            ids.add(mask.id);
            block.masks.push(mask);
        }
    }

    if (block.image.length === 0) return { ok: false, line: 0, problem: "no-image" };
    if (block.masks.length === 0) return { ok: false, line: 0, problem: "no-mask" };
    return { ok: true, block };
}

/** The text between the fences, in the canonical order: image, mode, question (if any), masks. */
export function formatImageClozeBlock(block: ImageClozeBlock): string {
    const lines = [`image: ${oneLine(block.image)}`, `mode: ${block.mode}`];
    const question = oneLine(block.question);
    if (question.length > 0) lines.push(`question: ${question}`);

    for (const mask of block.masks) {
        const numbers = [mask.x, mask.y, mask.w, mask.h].map((n) => clamp01(n).toFixed(4));
        const hint = oneLine(mask.hint);
        lines.push(
            `mask: ${oneLine(mask.fieldText)} | ${mask.id} ${mask.shape} ${numbers.join(" ")} |${hint ? " " + hint : ""}`,
        );
    }
    return lines.join("\n");
}

/** Whether a line opens an image cloze block, also when it is indented or in a quote. */
export function isImageClozeFenceLine(line: string): boolean {
    return OPENING.test(line.replace(LEAD, "").trimEnd());
}

/** Where an image cloze block is in a note: its lines, how it is placed, and whether it is closed. */
export interface FenceSpan {
    /** The line that opens it. */
    open: number;
    /** The line that closes it; for one that is never closed, the last line of the note, or of its quote. */
    close: number;
    /** It starts at the very start of its line: not indented, not in a quote. */
    leftEdge: boolean;
    quoted: boolean;
    closed: boolean;
    /** A line from `open` to `close` holds `<!--`. */
    hasComment: boolean;
}

/**
 * Every image cloze block in a note's lines, indented and quoted ones too. It is the one place that knows where a
 * block starts and ends: the parser, the cards, loading a note and the editor all ask it, so what is inside a block is
 * never read as something else.
 */
export function scanImageClozeFences(lines: string[]): FenceSpan[] {
    const spans: FenceSpan[] = [];
    for (let open = 0; open < lines.length; open++) {
        const line = lines[open];
        const lead = LEAD.exec(line)?.[0] ?? "";
        const rest = line.slice(lead.length).trimEnd();
        const fence = ANY_OPENING.exec(rest)?.[1];
        if (fence === undefined) continue;

        const quoted = lead.includes(">");
        const { close, closed } = fenceEnd(lines, open, fence, quoted);
        // An ordinary code block is skipped whole: an example of the syntax in it is not a block
        if (OPENING.test(rest))
            spans.push({
                open,
                close,
                leftEdge: lead.length === 0,
                quoted,
                closed,
                hasComment: lines.slice(open, close + 1).some((text) => text.includes("<!--")),
            });
        open = close;
    }
    return spans;
}

/** The line that closes a fence opened on lines[open], or, unclosed, the last line of the note or of its quote. */
function fenceEnd(
    lines: string[],
    open: number,
    fence: string,
    quoted: boolean,
): { close: number; closed: boolean } {
    for (let at = open + 1; at < lines.length; at++) {
        if (quoted && !/^\s*>/.test(lines[at])) return { close: at - 1, closed: false };
        const closing = CLOSING.exec(lines[at].replace(LEAD, "").trimEnd());
        if (closing !== null && closing[1][0] === fence[0] && closing[1].length >= fence.length)
            return { close: at, closed: true };
    }
    return { close: lines.length - 1, closed: false };
}
