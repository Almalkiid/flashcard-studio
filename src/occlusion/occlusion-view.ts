import { App, Component, MarkdownRenderer, Platform, TFile } from "obsidian";

import { t } from "src/lang/helpers";
import {
    formatOcclusionBlock,
    imagePathOf,
    OcclusionBlock,
    parseOcclusionBlock,
} from "src/occlusion/occlusion-block";

export const OCCLUSION_CARD_LANG = "fs-occlusion-card";

// A backslash and "u0060": the JSON escape of a backtick
const BACKTICK_ESCAPE = "\\" + "u0060";

export interface OcclusionCardSpec {
    block: OcclusionBlock;
    active: number;
    side: "front" | "back";
}

export type MaskState = "hidden-active" | "hidden" | "revealed" | "none";

/**
 * A fenced block that the study screen renders through MarkdownRenderer, where the card is drawn by our code block
 * processor: "```fs-occlusion-card\n<json>\n```". The JSON is on one line, and a backtick in it is escaped, so no
 * label can close the fence early.
 */
export function occlusionCardMarkdown(
    block: OcclusionBlock,
    active: number,
    side: "front" | "back",
): string {
    const json = JSON.stringify({ block, active, side }).replaceAll("`", BACKTICK_ESCAPE);
    return "```" + OCCLUSION_CARD_LANG + "\n" + json + "\n```";
}

/** The card the source of an `fs-occlusion-card` block describes, or null when it is not a valid one. */
export function parseOcclusionCardSpec(source: string): OcclusionCardSpec | null {
    let raw: unknown;
    try {
        raw = JSON.parse(source);
    } catch {
        return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const { block: rawBlock, active, side } = raw as Record<string, unknown>;
    if (side !== "front" && side !== "back") return null;

    // A block that is typed by hand goes through the block format, the one place that knows what a valid block is.
    // Writing something that is not a block throws.
    let block: OcclusionBlock | null;
    try {
        block = parseOcclusionBlock(formatOcclusionBlock(rawBlock as OcclusionBlock));
    } catch {
        return null;
    }
    if (block === null || typeof active !== "number") return null;
    if (!Number.isInteger(active) || active < 0 || active >= block.masks.length) return null;
    return { block, active, side };
}

/**
 * Which masks are drawn filled, outlined (revealed) or not at all. The active mask is the one the card asks about.
 * "Hide all" draws the other masks too, on both sides, as Anki does; "hide one" draws only the active one.
 */
export function maskStates(spec: OcclusionCardSpec): MaskState[] {
    return spec.block.masks.map((_mask, index) => {
        if (index === spec.active) return spec.side === "front" ? "hidden-active" : "revealed";
        return spec.block.mode === "hide-all" ? "hidden" : "none";
    });
}

/**
 * A card as one line of text, for the places that show a card's front outside the study screen (card info): its
 * question and the label of its mask. Null when the text is not the markdown of an occlusion card.
 */
export function occlusionCardText(markdown: string): string | null {
    if (!markdown.startsWith("```" + OCCLUSION_CARD_LANG + "\n")) return null;
    const spec = parseOcclusionCardSpec(
        markdown.slice(markdown.indexOf("\n") + 1, markdown.lastIndexOf("\n```")),
    );
    if (spec === null) return null;
    const mask = spec.block.masks[spec.active];
    const question = spec.block.question || t("OCCLUSION_DEFAULT_QUESTION");
    return `${question} · ${mask.label || t("OCCLUSION_MASK_NUMBER", { n: spec.active + 1 })}`;
}

/** A label without the Markdown symbols, for the room inside a mask. The full label is rendered below the image. */
export function plainLabel(markdown: string): string {
    return markdown
        .replaceAll(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
        .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replaceAll(/\*\*|__|==|~~|[*`]|\b_|_\b/g, "")
        .trim();
}

/** The image file of a block, found the way Obsidian finds a link, from the note that has the block. */
export function resolveImagePath(app: App, image: string, sourcePath: string): TFile | null {
    return app.metadataCache.getFirstLinkpathDest(imagePathOf(image), sourcePath);
}

/** A fraction of the image as a CSS percentage. */
export const percent = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

/**
 * Sizes the stage for an image: as wide as the container allows, no wider than the image itself, and no taller than
 * `--fs-occ-max-h`. The stage is the box that the mask overlays are drawn in, so it has to be exactly the image.
 */
export function fitStageToImage(stage: HTMLElement, img: HTMLImageElement): void {
    const fit = () => {
        if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
        stage.setCssProps({
            "--fs-occ-ratio": String(img.naturalWidth / img.naturalHeight),
            "--fs-occ-natural": `${img.naturalWidth}px`,
        });
    };
    img.addEventListener("load", fit);
    if (img.complete) fit();
}

// Even in a very small card the picture is this tall, and the card scrolls
const MIN_FIT_HEIGHT = 80;

/**
 * In the study screen the card has a fixed height and scrolls when its content is taller. The picture is sized to what
 * is left of the card after everything else in it, so that the question, the whole picture and the hint under it show
 * without a scroll, and the mask that is asked about is never below the fold. It is sized again when the card's box
 * changes, or when something is added to the card (the "tap to reveal" hint comes after the card is drawn).
 * Anywhere else (a note, the editor) there is no such card and the picture keeps the height the stylesheet gives it.
 */
function fitStageToCard(
    el: HTMLElement,
    scroller: HTMLElement,
    stage: HTMLElement,
    owner?: Component,
): void {
    let observers: { resize: ResizeObserver; mutate: MutationObserver } | null = null;
    let last = "";

    const stop = () => {
        observers?.resize.disconnect();
        observers?.mutate.disconnect();
        observers = null;
    };
    const fit = () => {
        const host = el.closest<HTMLElement>(".sr-content");
        if (!el.isConnected || host === null) return stop();

        const px = (value: string) => Number.parseFloat(value) || 0;
        const style = host.win.getComputedStyle(host);
        let others = px(style.paddingTop) + px(style.paddingBottom);
        for (const child of Array.from(host.children) as HTMLElement[]) {
            // The rows of this card, and what is beside it. Only the bottom margins are counted: the top ones can be
            // "auto", which is whatever room is left over. A row that is squeezed (the note's title above the card,
            // when the card is too tall) is counted as tall as its content, or the picture would never get small enough.
            others += child.contains(el)
                ? child.offsetHeight - scroller.offsetHeight
                : Math.max(child.offsetHeight, child.scrollHeight);
            others += px(host.win.getComputedStyle(child).marginBottom);
        }
        const height = `${Math.max(MIN_FIT_HEIGHT, Math.floor(host.clientHeight - others))}px`;
        if (height === last) return;
        last = height;
        stage.setCssProps({ "--fs-occ-max-h": height });
    };

    // The card is put in its screen after this runs, so it is looked for on the next frames
    let tries = 0;
    const start = () => {
        const host = el.closest<HTMLElement>(".sr-content");
        if (host === null) {
            if (el.isConnected || ++tries > 10) return;
            el.win.requestAnimationFrame(start);
            return;
        }
        observers = { resize: new ResizeObserver(fit), mutate: new MutationObserver(fit) };
        observers.resize.observe(host);
        observers.mutate.observe(host, { childList: true });
        owner?.register(stop);
        fit();
    };
    el.win.requestAnimationFrame(start);
}

/**
 * Draws a block into `el`: the image, and over it a mask for each state. `states` is what maskStates gives for a
 * review card, or "labels" for the note's own view, where every mask is outlined with its label in it.
 *
 * On the back of a card the mask that is revealed is an outline, and its label is rendered as Markdown under the
 * image, which needs `owner` (the component whose lifetime the render belongs to).
 *
 * @returns The stage the image and masks are in, or null when the image is not in the vault.
 */
export function renderOcclusion(
    el: HTMLElement,
    app: App,
    sourcePath: string,
    block: OcclusionBlock,
    states: MaskState[] | "labels",
    owner?: Component,
): HTMLElement | null {
    el.empty();
    el.addClass("fs-studio", "fs-occ");
    el.removeClass("is-front", "is-back", "is-note");
    const revealed = states === "labels" ? -1 : states.indexOf("revealed");
    el.addClass(states === "labels" ? "is-note" : revealed >= 0 ? "is-back" : "is-front");

    if (states !== "labels") {
        el.createDiv({
            cls: "fs-occ-question",
            text: block.question || t("OCCLUSION_DEFAULT_QUESTION"),
        });
    }

    // On the back the label is also written under the picture. It is the answer, so it shows without the picture too.
    const addAnswer = () => {
        if (revealed < 0 || block.masks[revealed].label.length === 0) return;
        const answer = el.createDiv({ cls: "fs-occ-answer" });
        if (owner === undefined) answer.setText(block.masks[revealed].label);
        else
            void MarkdownRenderer.render(
                app,
                block.masks[revealed].label,
                answer,
                sourcePath,
                owner,
            );
    };

    const file = resolveImagePath(app, block.image, sourcePath);
    if (file === null) {
        el.createDiv({
            cls: "fs-occ-missing",
            text: t("OCCLUSION_IMAGE_MISSING", { path: imagePathOf(block.image) }),
        });
        addAnswer();
        return null;
    }

    const scroller = el.createDiv({ cls: "fs-occ-scroll" });
    const stage = scroller.createDiv({ cls: "fs-occ-stage" });
    const img = stage.createEl("img", {
        cls: "fs-occ-image",
        attr: { src: app.vault.getResourcePath(file), alt: file.name, draggable: "false" },
    });
    fitStageToImage(stage, img);
    const overlay = stage.createSvg("svg", {
        cls: "fs-occ-overlay",
        attr: { viewBox: "0 0 1 1", preserveAspectRatio: "none", "aria-hidden": "true" },
    });

    block.masks.forEach((mask, index) => {
        const state: MaskState = states === "labels" ? "revealed" : states[index];
        if (state === "none") return;

        // A list, not a space separated string: createSvg adds a string as one class token, which throws on a space
        const cls = [
            "fs-mask",
            state === "hidden-active" ? "is-active" : "",
            state === "revealed" ? "is-revealed" : "",
        ].filter((name) => name.length > 0);
        if (mask.shape === "ellipse") {
            overlay.createSvg("ellipse", {
                cls,
                attr: {
                    cx: mask.x + mask.w / 2,
                    cy: mask.y + mask.h / 2,
                    rx: mask.w / 2,
                    ry: mask.h / 2,
                },
            });
        } else {
            overlay.createSvg("rect", {
                cls,
                attr: { x: mask.x, y: mask.y, width: mask.w, height: mask.h },
            });
        }

        // "?" in the mask that the card asks about. The labels are on the masks only in the note's own view: on the
        // back of a card the answer is under the picture, which usually has the label written on it already
        const text =
            state === "hidden-active" ? "?" : states === "labels" ? plainLabel(mask.label) : "";
        if (text.length === 0) return;
        const tag = stage.createDiv({
            cls: state === "hidden-active" ? "fs-occ-tag is-question" : "fs-occ-tag",
        });
        tag.createSpan({ cls: "fs-occ-tag-text", text });
        tag.setCssProps({
            "--fs-occ-x": percent(mask.x),
            "--fs-occ-y": percent(mask.y),
            "--fs-occ-w": percent(mask.w),
            "--fs-occ-h": percent(mask.h),
        });
    });

    // A tap on the image zooms it on a phone, where the picture is small. The tap is not a tap on the card, which
    // would show the answer: the answer button is still there.
    if (Platform.isMobile) {
        img.addEventListener("click", (event) => {
            event.stopPropagation();
            stage.toggleClass("is-zoomed", !stage.hasClass("is-zoomed"));
        });
    }

    addAnswer();
    if (states !== "labels") fitStageToCard(el, scroller, stage, owner);
    return stage;
}
