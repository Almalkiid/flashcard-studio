import { App, Component, HoverParent, Keymap, MarkdownRenderer, Plugin } from "obsidian";

import { TextDirection } from "src/utils/text";

/** The id the previews of links in cards are listed under in Obsidian's Page preview settings. */
export const HOVER_LINK_SOURCE = "flashcard-studio";

/**
 * Lists card links in Page preview settings, where the person chooses whether hovering needs Cmd or Ctrl. The default
 * is no key, the same as for links in reading view.
 */
export function registerHoverLinkSource(plugin: Plugin): void {
    plugin.registerHoverLinkSource(HOVER_LINK_SOURCE, {
        display: plugin.manifest.name,
        defaultMod: false,
    });
}

const wired = new WeakSet<HTMLElement>();

/**
 * Makes the internal links inside `root` work, however they got there: a click opens the note in a new tab (a middle
 * click, or Cmd or Ctrl as well, where Obsidian puts it: another tab, a split, a window), and hovering asks for a page
 * preview. Rendered Markdown has the links but nothing that acts on them outside a note.
 *
 * The listeners are on `root` and look at what was hit, so one call covers every link rendered into `root` later, and
 * calling it again for the same `root` does nothing. They run before those of whatever the link sits in (a choice
 * tile, say), and keep the click from reaching them.
 *
 * @param sourcePath The note links are relative to; a function when it changes (read at every click).
 */
export function wireInternalLinks(
    root: HTMLElement,
    app: App,
    sourcePath: string | (() => string),
): void {
    if (wired.has(root)) return;
    wired.add(root);

    // Obsidian keeps the page preview on this object, so it belongs to the surface that closes, not to the plugin
    const hoverParent: HoverParent = { hoverPopover: null };
    const pathOf = () => (typeof sourcePath === "function" ? sourcePath() : sourcePath);
    const linkOf = (event: Event): HTMLElement | null =>
        (event.target as Element | null)?.closest<HTMLElement>("a.internal-link") ?? null;
    const targetOf = (link: HTMLElement): string =>
        link.getAttribute("href") || link.getAttribute("data-href") || "";

    const open = (event: MouseEvent) => {
        // Left and middle button only; the right button is for the context menu
        const link = event.button === 0 || event.button === 1 ? linkOf(event) : null;
        if (link === null) return;
        event.preventDefault();
        event.stopPropagation();
        const target = targetOf(link);
        if (target !== "")
            void app.workspace.openLinkText(target, pathOf(), Keymap.isModEvent(event) || true);
    };
    // Capturing, so the click is dealt with before anything below `root` hears of it
    root.addEventListener("click", open, true);
    root.addEventListener("auxclick", open, true);

    root.addEventListener("mouseover", (event) => {
        const link = linkOf(event);
        // Moving between the parts of one link is not a new hover
        if (link === null || link.contains(event.relatedTarget as Node | null)) return;
        const target = targetOf(link);
        if (target === "") return;
        app.workspace.trigger("hover-link", {
            event,
            source: HOVER_LINK_SOURCE,
            hoverParent,
            targetEl: link,
            linktext: target,
            sourcePath: pathOf(),
        });
    });
}

/** The colour the cloze markup (see cards/expand.ts) gives its spans, as an inline style. */
const CLOZE_COLOR_STYLE = "color:#2196f3";

/**
 * Turns the inline colour of the cloze spans in `root` into the `fs-cloze-accent` class, which has the same colour. A
 * style sheet cannot restyle an inline colour (only !important could), and the Studio look gives clozes its own.
 */
function classifyClozeSpans(root: HTMLElement): void {
    for (const span of Array.from(root.querySelectorAll("span[style*='#2196f3']"))) {
        if (span.getAttribute("style")?.replace(/[\s;]/g, "") !== CLOZE_COLOR_STYLE) continue;
        span.removeAttribute("style");
        span.addClass("fs-cloze-accent");
    }
}

/** What draws the Markdown of one card. */
export interface CardRenderer {
    /**
     * Renders `markdown` into `target`, as it is in the note (images and links relative to it), reading in its own
     * direction. Text is added to what `target` holds.
     *
     * @returns Whether this is still the card that is up when the render has finished. When it is not, nothing was
     *          drawn (the card had already changed) or what was drawn belongs to a card that is gone.
     */
    render(markdown: string, target: HTMLElement, textDirection: TextDirection): Promise<boolean>;
}

/**
 * Draws the Markdown of the cards shown on one surface (a review view's content). Everything a card renders (embeds,
 * code blocks, handlers) belongs to a Component made for that card and let go of when the next card starts, so a long
 * session does not pile them up.
 */
export class CardMarkdown {
    private readonly app: App;
    private owner: Component | null = null;
    private sourcePath = "";

    /** Links anywhere under `root` work for as long as `root` lives (see `wireInternalLinks`). */
    constructor(app: App, root: HTMLElement) {
        this.app = app;
        wireInternalLinks(root, app, () => this.sourcePath);
    }

    /**
     * A new card is up: lets go of everything the last one rendered. Use the returned renderer for all of this card's
     * text; once another card starts, it draws nothing.
     */
    startCard(sourcePath: string): CardRenderer {
        this.release();
        const owner = new Component();
        owner.load();
        this.owner = owner;
        this.sourcePath = sourcePath;
        const isCurrent = () => this.owner === owner;

        return {
            render: async (markdown, target, textDirection) => {
                if (!isCurrent()) return false;
                const el =
                    textDirection === TextDirection.Rtl
                        ? target.createDiv({ attr: { dir: "rtl" } })
                        : target;
                el.addClass("markdown-rendered");
                await MarkdownRenderer.render(this.app, markdown, el, sourcePath, owner);
                classifyClozeSpans(el);
                return isCurrent();
            },
        };
    }

    /** The surface is done with: lets go of the last card's render. */
    release(): void {
        this.owner?.unload();
        this.owner = null;
    }
}
