import { App, Component, MarkdownRenderer, Platform } from "obsidian";

import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { readableDeckName } from "src/ui/design/deck-identity";
import type { ChoiceContext } from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import EmulatedPlatform from "src/utils/platform-detector";
import { wireInternalLinks } from "src/utils/renderers";

/**
 * What every exam screen needs to draw a card's text: the app, the plugin (for links) and a component that owns the
 * rendered Markdown, which the screen unloads when it goes away.
 */
export interface ExamRenderContext {
    app: App;
    plugin: SRPlugin;
    component: Component;
}

/** Whether the device is a phone or tablet, where a text field that takes focus raises the keyboard. */
export function isMobileDevice(): boolean {
    return Platform.isMobile || EmulatedPlatform().isMobile;
}

/** `CIA › Part1`: the last two names of a deck path, or a label for cards that are in no deck. */
export function deckLabel(path: string): string {
    if (path === "") return t("EXAM_NO_DECK");
    return path.split("/").slice(-2).map(readableDeckName).join(" › ");
}

/**
 * Renders a card's Markdown into an element, as it is in the note (images and links relative to the note), and wires
 * its internal links. The text reads in its own direction, so an Arabic card sits on the right.
 */
export async function renderCardMarkdown(
    ctx: ExamRenderContext,
    text: string,
    el: HTMLElement,
    sourcePath: string,
): Promise<void> {
    el.addClass("markdown-rendered");
    el.setAttribute("dir", "auto");
    await MarkdownRenderer.render(ctx.app, text, el, sourcePath, ctx.component);
    wireInternalLinks(el, ctx.app, ctx.plugin, sourcePath);
}

/** What the multiple choice tiles need to render an option's Markdown. */
export function choiceContext(ctx: ExamRenderContext, sourcePath: string): ChoiceContext {
    return {
        app: ctx.app,
        sourcePath,
        component: ctx.component,
        onRendered: (el) => {
            el.setAttribute("dir", "auto");
            wireInternalLinks(el, ctx.app, ctx.plugin, sourcePath);
        },
    };
}
