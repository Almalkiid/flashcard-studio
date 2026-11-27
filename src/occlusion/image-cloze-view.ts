/**
 * How an image cloze card is drawn: which masks are filled, outlined or left out on card k, what is written on them,
 * and in which order they are drawn. The card's front and back hold a spec in an `fs-image-cloze-card` block, which
 * a code block processor draws with the same renderer as image occlusion.
 */
import { App, Component } from "obsidian";

import { t } from "src/lang/translate";
import {
    formatImageClozeBlock,
    ImageClozeBlock,
    parseImageClozeBlock,
} from "src/occlusion/image-cloze-block";
import { actionOf, cardNumbersOf } from "src/occlusion/image-cloze-cards";
import { OcclusionBlock } from "src/occlusion/occlusion-block";
import { MaskState, plainLabel, renderOcclusion } from "src/occlusion/occlusion-view";

export const IMAGE_CLOZE_CARD_LANG = "fs-image-cloze-card";

// A backslash and "u0060": the JSON escape of a backtick
const BACKTICK_ESCAPE = "\\" + "u0060";
const CARD_BLOCK = new RegExp("```" + IMAGE_CLOZE_CARD_LANG + "\\n(.*)\\n```");

/** One card of an image cloze question: the block, the card number, the side, and how many cards the text has. */
export interface ImageClozeCardSpec {
    kind: "cloze";
    block: ImageClozeBlock;
    card: number;
    side: "front" | "back";
    textCards: number;
}

/** The fenced block a card's front or back holds: the spec as JSON on one line, a backtick escaped. */
export function imageClozeCardMarkdown(spec: ImageClozeCardSpec): string {
    const { kind, block, card, side, textCards } = spec;
    const json = JSON.stringify({ kind, block, card, side, textCards }).replaceAll(
        "`",
        BACKTICK_ESCAPE,
    );
    return "```" + IMAGE_CLOZE_CARD_LANG + "\n" + json + "\n```";
}

/** The spec in an `fs-image-cloze-card` block, or null when it is not a valid one or its card is not the question's. */
export function parseImageClozeCardSpec(source: string): ImageClozeCardSpec | null {
    let raw: unknown;
    try {
        raw = JSON.parse(source);
    } catch {
        return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const { kind, block: rawBlock, card, side, textCards } = raw as Record<string, unknown>;
    if (kind !== "cloze" || (side !== "front" && side !== "back")) return null;
    if (typeof textCards !== "number" || !Number.isInteger(textCards) || textCards < 0) return null;
    if (typeof card !== "number" || !Number.isInteger(card)) return null;

    // The block goes through the block format, the one place that knows what a valid block is
    let block: ImageClozeBlock;
    try {
        const read = parseImageClozeBlock(formatImageClozeBlock(rawBlock as ImageClozeBlock));
        if (!read.ok) return null;
        block = read.block;
    } catch {
        return null;
    }
    if (!cardNumbersOf(textCards, block).includes(card)) return null;
    return { kind, block, card, side, textCards };
}

/**
 * What card k draws. An asked mask is filled on the front with its hint on it ("?" without one), and outlined on the
 * back; a hidden mask is filled on both sides, with nothing on it; a shown mask is not drawn. The asked masks are drawn
 * last, in their order, so none is under another mask on the front, and the card scrolls to the first of them.
 */
export function imageClozeDrawing(spec: ImageClozeCardSpec): {
    states: MaskState[];
    tags: string[];
    order: number[];
} {
    const actions = spec.block.masks.map((mask) => actionOf(mask, spec.card, spec.block.mode));
    const states = actions.map((action): MaskState => {
        if (action === "a") return spec.side === "front" ? "hidden-active" : "revealed";
        return action === "h" ? "hidden" : "none";
    });
    const tags = spec.block.masks.map((mask, index) =>
        states[index] === "hidden-active" ? plainLabel(mask.hint) || "?" : "",
    );
    const indices = actions.map((_action, index) => index);
    const order = [
        ...indices.filter((index) => actions[index] !== "a"),
        ...indices.filter((index) => actions[index] === "a"),
    ];
    return { states, tags, order };
}

/** The block as the image occlusion renderer takes it: the same masks, each with its hint as its label. */
export function toOcclusionView(block: ImageClozeBlock): OcclusionBlock {
    return {
        image: block.image,
        mode: block.mode,
        question: block.question,
        masks: block.masks.map(({ id, shape, x, y, w, h, hint }) => ({
            id,
            shape,
            x,
            y,
            w,
            h,
            label: hint,
        })),
    };
}

/** What card k asks on the picture, as words: its hints, or "Card k" when they have none. */
function askedText(spec: ImageClozeCardSpec): string {
    const hints = spec.block.masks
        .filter((mask) => actionOf(mask, spec.card, spec.block.mode) === "a")
        .map((mask) => mask.hint)
        .filter((hint) => hint.length > 0);
    return hints.length > 0 ? hints.join(", ") : t("IMAGE_CLOZE_CARD_NUMBER", { n: spec.card });
}

/**
 * A card as one line of text, for the places that show a card without drawing it (card info). A card of a block alone
 * is its question and what it asks; a card of text and image is the text, with the picture as what it asks. Hints are
 * given in full. Null when the markdown holds no image cloze card.
 */
export function imageClozeCardText(markdown: string): string | null {
    const match = CARD_BLOCK.exec(markdown);
    const spec = match === null ? null : parseImageClozeCardSpec(match[1]);
    if (match === null || spec === null) return null;

    if (markdown.trim() === match[0]) {
        const question = spec.block.question || t("OCCLUSION_DEFAULT_QUESTION");
        return `${question} · ${askedText(spec)}`;
    }
    return markdown
        .replace(match[0], `[image: ${askedText(spec)}]`)
        .replace(/\s+/g, " ")
        .trim();
}

/** Draws one card. A combined card's question is its text, so the block's question is only shown when it has one. */
export function renderImageClozeCard(
    el: HTMLElement,
    app: App,
    sourcePath: string,
    spec: ImageClozeCardSpec,
    owner?: Component,
): HTMLElement | null {
    const { states, tags, order } = imageClozeDrawing(spec);
    return renderOcclusion(el, app, sourcePath, toOcclusionView(spec.block), states, owner, {
        tags,
        order,
        answerLine: false,
        questionLine: spec.block.question.length > 0 || spec.textCards === 0,
        side: spec.side,
        cloze: true,
        // A card with text clozes opens at its text, which asks too; a picture alone scrolls to its mask
        scrollToMask: spec.textCards === 0,
    });
}

/**
 * Draws a block in its note: every mask outlined with its card field and hint. For a block that cannot be read, the
 * line that is wrong. Returns the stage, or null when there is none (no image, or a block that cannot be read).
 */
export function renderImageClozeNote(
    el: HTMLElement,
    app: App,
    sourcePath: string,
    source: string,
    owner?: Component,
    problem?: string,
): HTMLElement | null {
    const read = parseImageClozeBlock(source);
    // `=== false`: without strict null checks, `!read.ok` does not narrow to the failed read
    if (read.ok === false) {
        el.empty();
        el.addClass("fs-studio", "fs-occ");
        el.createDiv({
            cls: "fs-occ-missing",
            text:
                read.line > 0
                    ? t("IMAGE_CLOZE_INVALID_LINE", { line: read.line })
                    : t("IMAGE_CLOZE_INVALID_BLOCK"),
        });
        return null;
    }
    const view = toOcclusionView(read.block);
    view.masks.forEach((mask, index) => {
        const field = read.block.masks[index].fieldText;
        mask.label = mask.label.length > 0 ? `${field} · ${mask.label}` : field;
    });
    const stage = renderOcclusion(el, app, sourcePath, view, "labels", owner, { cloze: true });
    // What is wrong with the question around the block (it is not a card): above the picture
    if (problem !== undefined) {
        const line = el.createDiv({ cls: "fs-occ-missing fs-occ-problem", text: problem });
        el.insertBefore(line, el.firstChild);
    }
    return stage;
}
