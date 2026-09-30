import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import type { Card } from "src/data/data-structures/card/card";
import {
    MultipleChoice,
    shuffledOrder,
} from "src/data/data-structures/card/questions/multiple-choice";
import { t } from "src/lang/helpers";

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
}

/**
 * Renders Markdown into an element. Not awaited by callers that build synchronously: the text fills in a moment later.
 */
function renderMarkdown(
    text: string,
    el: HTMLElement,
    options: Pick<ChoiceTileOptions, "app" | "sourcePath" | "component">,
): Promise<void> {
    el.addClass("markdown-rendered");
    return MarkdownRenderer.render(options.app, text, el, options.sourcePath, options.component);
}

/**
 * One tile per option, in `order` (display position to option index). Returns the tiles in display order.
 */
export function renderChoiceTiles(
    parent: HTMLElement,
    mc: MultipleChoice,
    order: number[],
    opts: ChoiceTileOptions,
): HTMLElement[] {
    const chosen = new Set(opts.chosen);
    const isResult = opts.mode === "result";
    parent.setAttribute("role", "group");

    return order.map((optionIndex, position) => {
        const option = mc.options[optionIndex];
        const tile: HTMLElement = isResult
            ? parent.createDiv({ cls: "fs-choice is-result" })
            : parent.createEl("button", { cls: "fs-choice", attr: { type: "button" } });
        tile.dataset.option = String(optionIndex);
        tile.createSpan({ cls: "fs-choice-key", text: String(position + 1) });
        const textEl = tile.createDiv({ cls: "fs-choice-text" });
        void renderMarkdown(option.text, textEl, opts);

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
            return tile;
        }

        if (opts.multiSelect) tile.setAttribute("aria-pressed", String(chosen.has(optionIndex)));
        tile.toggleClass("is-selected", chosen.has(optionIndex));
        tile.addEventListener("click", () => {
            if (opts.multiSelect) {
                const selected = !tile.hasClass("is-selected");
                tile.toggleClass("is-selected", selected);
                tile.setAttribute("aria-pressed", String(selected));
            } else {
                tile.addClass("is-selected");
            }
            opts.onChoose?.(optionIndex);
        });
        return tile;
    });
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

export interface ChoiceContext {
    app: App;
    sourcePath: string;
    component: Component;
}

export interface ChoiceFrontHandle {
    /** Chooses the option shown at this position (0 for the first), as a tap on its tile does. */
    chooseAt(position: number): void;
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
    renderLead(parent, mc, ctx);
    if (mc.multiSelect) parent.createDiv({ cls: "fs-choice-hint", text: t("CHOICE_SELECT_ALL") });

    const tilesEl = parent.createDiv({ cls: "fs-choices" });
    let checkButton: HTMLButtonElement | null = null;
    const tiles = renderChoiceTiles(tilesEl, mc, state.order, {
        mode: "choose",
        chosen: [],
        multiSelect: mc.multiSelect,
        sourcePath: ctx.sourcePath,
        component: ctx.component,
        app: ctx.app,
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

    return { chooseAt: (position) => tiles[position]?.click() };
}

/**
 * The answered card: the tiles with right and wrong marked, then the explanation. Resolves once the explanation has
 * been rendered, so its height is known.
 */
export async function renderChoiceBack(
    parent: HTMLElement,
    state: ChoiceState,
    ctx: ChoiceContext,
): Promise<void> {
    const { mc } = state;
    renderLead(parent, mc, ctx);
    renderChoiceTiles(parent.createDiv({ cls: "fs-choices" }), mc, state.order, {
        mode: "result",
        chosen: state.chosen,
        multiSelect: mc.multiSelect,
        sourcePath: ctx.sourcePath,
        component: ctx.component,
        app: ctx.app,
    });
    if (mc.explanation === "") return;
    const box = parent.createDiv({ cls: "fs-choice-explanation" });
    setIcon(box.createSpan({ cls: "fs-choice-explanation-icon" }), "lightbulb");
    await renderMarkdown(mc.explanation, box.createDiv({ cls: "fs-choice-explanation-text" }), ctx);
}

function renderLead(parent: HTMLElement, mc: MultipleChoice, ctx: ChoiceContext): void {
    if (mc.lead === "") return;
    void renderMarkdown(mc.lead, parent.createDiv({ cls: "fs-choice-lead" }), ctx);
}
