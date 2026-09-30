import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import type { Card } from "src/data/data-structures/card/card";
import {
    MultipleChoice,
    shuffledOrder,
} from "src/data/data-structures/card/questions/multiple-choice";
import { t } from "src/lang/helpers";
import { TextDirection } from "src/utils/strings";

export interface ChoiceTileOptions {
    /** "choose": tappable tiles. "result": the answer is in, right and wrong are marked. */
    mode: "choose" | "result";
    /** Option indices (in `mc.options`, not display positions) the person chose. */
    chosen: number[];
    multiSelect: boolean;
    /** Called with an option index when a tile is chosen (or, for multi-select, toggled). */
    onChoose?: (optionIndex: number) => void;
    /** The note the card comes from, for links and embeds in the options. */
    sourcePath: string;
    /** Owns the rendered Markdown; unload it when the tiles go away. */
    component: Component;
    /** Needed by `MarkdownRenderer.render`; the older `renderMarkdown` that needs none is deprecated. */
    app: App;
    /** Reading direction of the note; right to left puts the tiles' key badges and tags on the other side. */
    textDirection?: TextDirection;
    /** Called with each element once its Markdown is in, for the internal links (see `wireInternalLinks`). */
    onRendered?: (el: HTMLElement) => void;
}

/**
 * Everything but the tiles' own options: what the parts of a multiple choice card need to render Markdown.
 */
export type ChoiceContext = Pick<
    ChoiceTileOptions,
    "app" | "sourcePath" | "component" | "textDirection" | "onRendered"
>;

/**
 * Renders Markdown into an element. Resolves once the text is in.
 */
async function renderMarkdown(text: string, el: HTMLElement, ctx: ChoiceContext): Promise<void> {
    el.addClass("markdown-rendered");
    await MarkdownRenderer.render(ctx.app, text, el, ctx.sourcePath, ctx.component);
    ctx.onRendered?.(el);
}

export interface ChoiceTiles {
    /** The tiles in display order. */
    tiles: HTMLElement[];
    /** Resolves when the text of every option has been rendered. Await it before reading the tiles' text. */
    rendered: Promise<void>;
}

/**
 * One tile per option, in `order` (display position to option index).
 *
 * In "choose" mode a single-select tile marks itself `is-selected` and clears the tiles it was chosen over, so a
 * screen that lets the person change the answer needs no redrawing; several-answer tiles toggle. Either way
 * `onChoose` gets the option index.
 */
export function renderChoiceTiles(
    parent: HTMLElement,
    mc: MultipleChoice,
    order: number[],
    opts: ChoiceTileOptions,
): ChoiceTiles {
    const chosen = new Set(opts.chosen);
    const isResult = opts.mode === "result";
    parent.setAttribute("role", isResult || opts.multiSelect ? "group" : "radiogroup");
    if (opts.textDirection === TextDirection.Rtl) parent.setAttribute("dir", "rtl");
    const tiles: HTMLElement[] = [];
    const renders: Promise<void>[] = [];

    order.forEach((optionIndex, position) => {
        const option = mc.options[optionIndex];
        const tile: HTMLElement = isResult
            ? parent.createDiv({ cls: "fs-choice is-result" })
            : parent.createEl("button", { cls: "fs-choice", attr: { type: "button" } });
        tiles.push(tile);
        tile.dataset.option = String(optionIndex);
        tile.createSpan({ cls: "fs-choice-key", text: String(position + 1) });
        const textEl = tile.createDiv({ cls: "fs-choice-text" });
        renders.push(renderMarkdown(option.text, textEl, opts));

        if (isResult) {
            const picked = chosen.has(optionIndex);
            tile.toggleClass("is-correct", option.correct);
            tile.toggleClass("is-wrong", picked && !option.correct);
            tile.toggleClass("is-picked", picked);
            if (picked || option.correct) {
                const tag = tile.createSpan({ cls: "fs-choice-tag" });
                setIcon(
                    tag.createSpan({ cls: "fs-choice-tag-icon" }),
                    option.correct ? "check" : "x",
                );
                tag.createSpan({
                    text: picked
                        ? t(
                              option.correct
                                  ? "CHOICE_YOUR_ANSWER_RIGHT"
                                  : "CHOICE_YOUR_ANSWER_WRONG",
                          )
                        : t("CHOICE_RIGHT_ANSWER"),
                });
            }
            return;
        }

        const select = (selected: boolean) => {
            tile.toggleClass("is-selected", selected);
            tile.setAttribute(opts.multiSelect ? "aria-pressed" : "aria-checked", String(selected));
        };
        if (!opts.multiSelect) tile.setAttribute("role", "radio");
        select(chosen.has(optionIndex));
        tile.addEventListener("click", (event) => {
            if (opts.multiSelect) {
                select(!tile.hasClass("is-selected"));
                // A tap or click leaves no focus on the tile, so a later Space checks the answer, as it did before
                if (event.detail > 0) tile.blur();
            } else {
                for (const other of tiles) other.toggleClass("is-selected", other === tile);
                for (const other of tiles)
                    other.setAttribute("aria-checked", String(other === tile));
            }
            opts.onChoose?.(optionIndex);
        });
    });

    return { tiles, rendered: Promise.all(renders).then((): void => undefined) };
}

/**
 * What the person has done with the multiple choice card that is up: the order the options are shown in, and the
 * options chosen so far.
 */
export interface ChoiceState {
    card: Card;
    mc: MultipleChoice;
    /** Display position to option index. */
    order: number[];
    /** Option indices chosen, in the order chosen. */
    chosen: number[];
    /** The answer is showing: later taps on the old tiles change nothing. */
    locked: boolean;
}

export function createChoiceState(
    card: Card,
    mc: MultipleChoice,
    shuffle: boolean,
    random: () => number = Math.random,
): ChoiceState {
    const count = mc.options.length;
    return {
        card,
        mc,
        order: shuffle ? shuffledOrder(count, random) : Array.from({ length: count }, (_, i) => i),
        chosen: [],
        locked: false,
    };
}

export interface ChoiceFrontHandle {
    /** Chooses the option shown at this position (0 for the first), as a tap on its tile does. */
    chooseAt(position: number): void;
    /** Resolves when the lead and every option have been rendered. */
    rendered: Promise<void>;
}

/**
 * The part of the card under the question: the lead, the tiles, and for a multi-select question a Check button.
 * `onSubmit` is called once the person has chosen (at once for a single answer, on Check for several).
 */
export function renderChoiceFront(
    parent: HTMLElement,
    state: ChoiceState,
    ctx: ChoiceContext,
    onSubmit: () => void,
): ChoiceFrontHandle {
    const { mc } = state;
    const leadRendered = renderLead(parent, mc, ctx);
    if (mc.multiSelect) parent.createDiv({ cls: "fs-choice-hint", text: t("CHOICE_SELECT_ALL") });

    const tilesEl = parent.createDiv({ cls: "fs-choices" });
    let checkButton: HTMLButtonElement | null = null;
    const { tiles, rendered } = renderChoiceTiles(tilesEl, mc, state.order, {
        mode: "choose",
        chosen: [],
        multiSelect: mc.multiSelect,
        ...ctx,
        onChoose: (optionIndex) => {
            if (state.locked) return;
            if (!mc.multiSelect) {
                state.chosen = [optionIndex];
                onSubmit();
                return;
            }
            state.chosen = state.chosen.includes(optionIndex)
                ? state.chosen.filter((chosen) => chosen !== optionIndex)
                : [...state.chosen, optionIndex];
            if (checkButton) checkButton.disabled = state.chosen.length === 0;
        },
    });

    if (mc.multiSelect) {
        const actions = parent.createDiv({ cls: "fs-choice-actions" });
        checkButton = actions.createEl("button", {
            cls: "fs-primary-button mod-cta fs-choice-check",
            text: t("CHOICE_CHECK"),
            attr: { type: "button" },
        });
        checkButton.disabled = true;
        checkButton.addEventListener("click", () => {
            if (!state.locked) onSubmit();
        });
    }

    return {
        chooseAt: (position) => tiles[position]?.click(),
        rendered: Promise.all([leadRendered, rendered]).then((): void => undefined),
    };
}

/**
 * The answered card: the tiles with right and wrong marked, then the explanation. Resolves once the lead, the options
 * and the explanation have been rendered, so the text is there to read and the heights are known.
 */
export async function renderChoiceBack(
    parent: HTMLElement,
    // Only what is drawn: an exam has no card to hold
    state: Pick<ChoiceState, "mc" | "order" | "chosen"> & Partial<ChoiceState>,
    ctx: ChoiceContext,
): Promise<void> {
    const { mc } = state;
    const renders: Promise<void>[] = [renderLead(parent, mc, ctx)];
    renders.push(
        renderChoiceTiles(parent.createDiv({ cls: "fs-choices" }), mc, state.order, {
            mode: "result",
            chosen: state.chosen,
            multiSelect: mc.multiSelect,
            ...ctx,
        }).rendered,
    );
    if (mc.explanation !== "") {
        const box = parent.createDiv({ cls: "fs-choice-explanation" });
        setIcon(box.createSpan({ cls: "fs-choice-explanation-icon" }), "lightbulb");
        renders.push(
            renderMarkdown(
                mc.explanation,
                box.createDiv({ cls: "fs-choice-explanation-text" }),
                ctx,
            ),
        );
    }
    await Promise.all(renders);
}

function renderLead(parent: HTMLElement, mc: MultipleChoice, ctx: ChoiceContext): Promise<void> {
    if (mc.lead === "") return Promise.resolve();
    return renderMarkdown(mc.lead, parent.createDiv({ cls: "fs-choice-lead" }), ctx);
}

/**
 * Scrolls a card that does not fit its window to the answer: the explanation at the bottom, unless that would push
 * the tiles that were chosen and the right ones out of view, which matter more, so they win.
 */
export function revealChoiceResult(content: HTMLElement): void {
    const marked = content.querySelectorAll<HTMLElement>(
        ".fs-choice.is-picked, .fs-choice.is-correct",
    );
    const explanation = content.querySelector<HTMLElement>(".fs-choice-explanation");
    const last = explanation ?? marked[marked.length - 1];
    if (last === undefined) return;
    last.scrollIntoView({ block: "nearest" });
    const first = marked[0];
    if (
        first !== undefined &&
        first.getBoundingClientRect().top < content.getBoundingClientRect().top
    ) {
        first.scrollIntoView({ block: "start" });
    }
}
