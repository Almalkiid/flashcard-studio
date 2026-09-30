import { App, MarkdownRenderChild, MarkdownRenderer } from "obsidian";

import SRPlugin from "src/main";
// import { CardState } from "src/ui/obsidian-ui-components/content-container/content-manager";
import { TextDirection } from "src/utils/strings";

/**
 * Makes the internal links in rendered Markdown open their note in a new tab and show the hover preview, as they do
 * in a card. A click on a link does not reach the element around it, so a link in an option does not choose the option.
 */
export function wireInternalLinks(
    containerEl: HTMLElement,
    app: App,
    plugin: SRPlugin,
    notePath: string,
): void {
    containerEl.findAll(".internal-link").forEach((el: HTMLElement) => {
        (el as HTMLAnchorElement).addEventListener("click", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const href = el.getAttr("href") || el.getAttr("data-href");

            if (href) {
                void app.workspace.openLinkText(href, notePath, true);
                return true;
            }
            return false;
        });

        (el as HTMLAnchorElement).addEventListener("mouseover", (ev: Event) => {
            const href = el.getAttr("href") || el.getAttr("data-href");
            if (href) {
                app.workspace.trigger("hover-link", {
                    event: ev,
                    source: "preview",
                    hoverParent: plugin,
                    targetEl: el,
                    linktext: href,
                });
                return true;
            }
            return false;
        });
    });
}

export class RenderMarkdownWrapper {
    private app: App;
    private notePath: string;
    private plugin: SRPlugin;

    constructor(app: App, plugin: SRPlugin, notePath: string) {
        this.app = app;
        this.notePath = notePath;
        this.plugin = plugin;
    }

    async renderMarkdownWrapper(
        markdownString: string,
        containerEl: HTMLElement,
        textDirection: TextDirection,
        // cardState: CardState, // TODO: Enable once you are working on rendering clozes in here
        recursiveDepth = 0,
    ): Promise<void> {
        if (recursiveDepth > 4) return;

        let el: HTMLElement;
        if (textDirection === TextDirection.Rtl) {
            el = containerEl.createDiv();
            el.setAttribute("dir", "rtl");
        } else el = containerEl;

        if (!el.hasClass("markdown-rendered")) {
            el.addClass("markdown-rendered");
        }

        const renderChild = new MarkdownRenderChild(el);
        this.plugin.addChild(renderChild);
        await MarkdownRenderer.render(this.app, markdownString, el, this.notePath, renderChild);

        wireInternalLinks(el, this.app, this.plugin, this.notePath);
    }
}
