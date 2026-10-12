import { App, Component, Keymap, MarkdownRenderer, Plugin } from "obsidian";

import {
    CardMarkdown,
    HOVER_LINK_SOURCE,
    registerHoverLinkSource,
    wireInternalLinks,
} from "src/utils/markdown-render";
import { TextDirection } from "src/utils/text";

// Obsidian is not there in a unit test. Its Component keeps only whether it is loaded; its renderer turns [[Note]] into
// the link Obsidian makes, and puts the result into the element at once, as the real one does before it awaits embeds
jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    Component: class {
        loaded = false;
        load(): void {
            this.loaded = true;
        }
        unload(): void {
            this.loaded = false;
        }
    },
    Keymap: { isModEvent: jest.fn(() => false) },
    MarkdownRenderer: {
        render: jest.fn((_app: unknown, markdown: string, el: HTMLElement) => {
            for (const part of markdown.split(/(\[\[.+?\]\])/)) {
                const target = /^\[\[(.+)\]\]$/.exec(part)?.[1];
                if (target === undefined) {
                    el.appendChild(document.createTextNode(part));
                    continue;
                }
                const link = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
                link.setAttribute("class", "internal-link");
                link.setAttribute("data-href", target);
                link.setAttribute("href", target);
                link.textContent = target;
                el.appendChild(link);
            }
            return Promise.resolve();
        }),
    },
}));

const create = (tag: string): HTMLElement =>
    document.createElementNS("http://www.w3.org/1999/xhtml", tag);

// The helpers Obsidian adds to every element
const obsidianHelpers = {
    createDiv(this: HTMLElement, options?: { attr?: Record<string, string> }): HTMLElement {
        const el = create("div");
        for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
        this.appendChild(el);
        return el;
    },
    addClass(this: HTMLElement, ...classes: string[]): void {
        this.classList.add(...classes);
    },
};

beforeAll(() => {
    Object.assign(HTMLElement.prototype, obsidianHelpers);
});

// spyOn on the mocks above gives the same mock functions, without taking the methods off their objects
const render = jest.spyOn(MarkdownRenderer, "render");
const isModEvent = jest.spyOn(Keymap, "isModEvent");

interface HoverRequest {
    event: Event;
    source: string;
    hoverParent: unknown;
    targetEl: HTMLElement;
    linktext: string;
    sourcePath: string;
}

function fakeApp() {
    const openLinkText = jest.fn();
    const trigger = jest.fn<void, [string, HoverRequest]>();
    return {
        app: { workspace: { openLinkText, trigger } } as unknown as App,
        openLinkText,
        trigger,
    };
}

function newRoot(): HTMLElement {
    const root = create("div");
    document.body.appendChild(root);
    return root;
}

function click(el: Element, type = "click", init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    return event;
}

function linkIn(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>("a.internal-link");
}

beforeEach(() => {
    render.mockClear();
    isModEvent.mockReset();
    isModEvent.mockReturnValue(false);
});

describe("CardMarkdown: one owner per card", () => {
    test("renders with the app, the note, and a loaded Component", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const card = new CardMarkdown(app, root).startCard("notes/a.md");
        await card.render("Front", root, TextDirection.Ltr);

        expect(render).toHaveBeenCalledTimes(1);
        const [appArg, markdown, el, sourcePath, owner] = render.mock.calls[0];
        expect(appArg).toBe(app);
        expect(markdown).toBe("Front");
        expect(el).toBe(root);
        expect(sourcePath).toBe("notes/a.md");
        expect(owner).toBeInstanceOf(Component);
        expect((owner as unknown as { loaded: boolean }).loaded).toBe(true);
        expect(root.classList.contains("markdown-rendered")).toBe(true);
    });

    test("the front and the back of one card share one owner", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const card = new CardMarkdown(app, root).startCard("a.md");
        await card.render("Front", root, TextDirection.Ltr);
        await card.render("Back", root, TextDirection.Ltr);
        expect(render.mock.calls[0][4]).toBe(render.mock.calls[1][4]);
    });

    test("the next card releases the last card's owner and gets its own", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);
        await cards.startCard("a.md").render("One", root, TextDirection.Ltr);
        await cards.startCard("a.md").render("Two", root, TextDirection.Ltr);

        const [first, second] = render.mock.calls.map(
            (call) => call[4] as unknown as { loaded: boolean },
        );
        expect(first).not.toBe(second);
        expect(first.loaded).toBe(false);
        expect(second.loaded).toBe(true);
    });

    test("after 200 cards exactly one owner is alive", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);
        for (let i = 0; i < 200; i++) {
            await cards.startCard("a.md").render(`Card ${i}`, root, TextDirection.Ltr);
        }
        const owners = new Set(
            render.mock.calls.map((call) => call[4] as unknown as { loaded: boolean }),
        );
        expect(owners.size).toBe(200);
        expect([...owners].filter((owner) => owner.loaded)).toHaveLength(1);
    });

    test("release() lets go of the last owner", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);
        await cards.startCard("a.md").render("One", root, TextDirection.Ltr);
        cards.release();
        expect((render.mock.calls[0][4] as unknown as { loaded: boolean }).loaded).toBe(false);
    });

    test("right-to-left text is rendered into its own right-to-left block", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const card = new CardMarkdown(app, root).startCard("a.md");
        await card.render("مرحبا", root, TextDirection.Rtl);

        const block = root.querySelector<HTMLElement>("div[dir=rtl]");
        expect(block).not.toBeNull();
        expect(render.mock.calls[0][2]).toBe(block);
        expect(block?.textContent).toBe("مرحبا");
        expect(block?.classList.contains("markdown-rendered")).toBe(true);
    });
});

describe("CardMarkdown: a render for a card that is gone is dropped", () => {
    test("one that finishes after the card changed says so, and the new card is unaffected", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);

        let finishFirst: () => void = () => undefined;
        render.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishFirst = resolve;
                }),
        );
        const slow = cards.startCard("a.md").render("Slow", root, TextDirection.Ltr);
        const next = cards.startCard("b.md");
        finishFirst();

        await expect(slow).resolves.toBe(false);
        await expect(next.render("Next", root, TextDirection.Ltr)).resolves.toBe(true);
    });

    // The review screen draws a card's front, and while that renders the answer is shown: the back starts the card
    // again, for the same note. The front's draw is told it is no longer current, so it adds nothing more
    // (card-container.tsx cannot be loaded in a unit test: it imports CSS and the Obsidian-bound screens).
    test("a front still rendering when the answer is shown says so, and the back is unaffected", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);

        let finishFront: () => void = () => undefined;
        render.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishFront = resolve;
                }),
        );
        const front = cards.startCard("a.md").render("Question", root, TextDirection.Ltr);
        const back = cards.startCard("a.md");
        finishFront();

        await expect(front).resolves.toBe(false);
        await expect(back.render("Answer", root, TextDirection.Ltr)).resolves.toBe(true);
    });

    // The review screen draws the back, and while that renders another card is drawn (bury, suspend or undo). The
    // back's draw is told it is no longer current, so it shows no rating buttons over the newer card
    // (card-container.tsx cannot be loaded in a unit test, see the test above).
    test("a back still rendering when another card is drawn says so, and the new front is unaffected", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);

        let finishBack: () => void = () => undefined;
        const front = cards.startCard("a.md");
        await expect(front.render("Question", root, TextDirection.Ltr)).resolves.toBe(true);
        render.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishBack = resolve;
                }),
        );
        const back = cards.startCard("a.md").render("Answer", root, TextDirection.Ltr);
        const next = cards.startCard("b.md");
        finishBack();

        await expect(back).resolves.toBe(false);
        await expect(next.render("Next question", root, TextDirection.Ltr)).resolves.toBe(true);
    });

    test("one asked for after the card changed is not even started", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);
        const old = cards.startCard("a.md");
        cards.startCard("b.md");
        render.mockClear();

        await expect(old.render("Late", root, TextDirection.Ltr)).resolves.toBe(false);
        expect(render).not.toHaveBeenCalled();
    });

    test("nothing is rendered after release()", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const cards = new CardMarkdown(app, root);
        const card = cards.startCard("a.md");
        cards.release();
        await expect(card.render("Late", root, TextDirection.Ltr)).resolves.toBe(false);
        expect(render).not.toHaveBeenCalled();
    });
});

describe("links: bound once, by delegation", () => {
    test("rendering many cards adds no listeners after the first three on the root", async () => {
        const { app } = fakeApp();
        const root = newRoot();
        const add = jest.spyOn(EventTarget.prototype, "addEventListener");
        const cards = new CardMarkdown(app, root);
        expect(add.mock.calls.map((call) => call[0]).sort()).toEqual([
            "auxclick",
            "click",
            "mouseover",
        ]);

        add.mockClear();
        for (let i = 0; i < 25; i++) {
            root.replaceChildren();
            await cards
                .startCard("a.md")
                .render("A [[Note]] and [[Other]]", root, TextDirection.Ltr);
        }
        expect(add).not.toHaveBeenCalled();
        add.mockRestore();
    });

    test("wiring a surface again does not add a second set", () => {
        const { app } = fakeApp();
        const root = newRoot();
        wireInternalLinks(root, app, "a.md");
        const add = jest.spyOn(EventTarget.prototype, "addEventListener");
        wireInternalLinks(root, app, "a.md");
        new CardMarkdown(app, root);
        expect(add).not.toHaveBeenCalled();
        add.mockRestore();
    });
});

describe("links: a click opens the note once", () => {
    let root: HTMLElement;
    let openLinkText: jest.Mock;
    let trigger: jest.Mock<void, [string, HoverRequest]>;
    let cards: CardMarkdown;

    async function setUp(markdown = "See [[Note A]] here"): Promise<HTMLElement> {
        const fake = fakeApp();
        openLinkText = fake.openLinkText;
        trigger = fake.trigger;
        root = newRoot();
        cards = new CardMarkdown(fake.app, root);
        await cards.startCard("dir/src.md").render(markdown, root, TextDirection.Ltr);
        return linkIn(root);
    }

    test("opens the link in a new tab, from the card's note, and swallows the click", async () => {
        const link = await setUp();
        const parentClick = jest.fn();
        root.addEventListener("click", parentClick);

        const event = click(link);

        expect(openLinkText).toHaveBeenCalledTimes(1);
        expect(openLinkText).toHaveBeenCalledWith("Note A", "dir/src.md", true);
        expect(event.defaultPrevented).toBe(true);
        expect(parentClick).not.toHaveBeenCalled();
    });

    test("a click on something inside the link counts as a click on the link", async () => {
        const link = await setUp("[[Note A]]");
        const inner = create("span");
        link.appendChild(inner);
        click(inner);
        expect(openLinkText).toHaveBeenCalledTimes(1);
    });

    test("a link in the next card works without wiring it again, and still opens once", async () => {
        await setUp();
        root.replaceChildren();
        await cards.startCard("other/next.md").render("Go to [[Note B]]", root, TextDirection.Ltr);

        click(linkIn(root));

        expect(openLinkText).toHaveBeenCalledTimes(1);
        expect(openLinkText).toHaveBeenCalledWith("Note B", "other/next.md", true);
    });

    test("a link inside something that is clickable itself does not click it", async () => {
        await setUp();
        const tile = create("button");
        root.appendChild(tile);
        const tileClick = jest.fn();
        tile.addEventListener("click", tileClick);
        tile.appendChild(linkIn(root));

        click(linkIn(root));

        expect(openLinkText).toHaveBeenCalledTimes(1);
        expect(tileClick).not.toHaveBeenCalled();
    });

    test("holding Cmd or Ctrl (or Alt as well) opens where Obsidian says", async () => {
        const link = await setUp();
        isModEvent.mockReturnValue("split");
        click(link, "click", { metaKey: true, altKey: true });
        expect(openLinkText).toHaveBeenCalledWith("Note A", "dir/src.md", "split");
    });

    test("a middle click opens it too, in the tab Obsidian picks for it", async () => {
        const link = await setUp();
        isModEvent.mockReturnValue("tab");
        const event = click(link, "auxclick", { button: 1 });
        expect(openLinkText).toHaveBeenCalledTimes(1);
        expect(openLinkText).toHaveBeenCalledWith("Note A", "dir/src.md", "tab");
        expect(event.defaultPrevented).toBe(true);
    });

    test("a right click is left to the context menu", async () => {
        const link = await setUp();
        const event = click(link, "auxclick", { button: 2 });
        expect(openLinkText).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    test("a link that has only data-href opens", async () => {
        const link = await setUp();
        link.removeAttribute("href");
        click(link);
        expect(openLinkText).toHaveBeenCalledWith("Note A", "dir/src.md", true);
    });

    test("a link with neither is swallowed and opens nothing", async () => {
        const link = await setUp();
        link.removeAttribute("href");
        link.removeAttribute("data-href");
        const event = click(link);
        expect(openLinkText).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    test("other clicks are left alone", async () => {
        await setUp("Plain text");
        const external = create("a");
        external.setAttribute("class", "external-link");
        external.setAttribute("href", "https://example.com");
        root.appendChild(external);
        const parentClick = jest.fn();
        root.addEventListener("click", parentClick);
        const web = click(external);
        click(root);
        expect(openLinkText).not.toHaveBeenCalled();
        expect(web.defaultPrevented).toBe(false);
        expect(parentClick).toHaveBeenCalledTimes(2);
    });

    test("the note a link is read against follows the card", async () => {
        await setUp();
        cards.startCard("third.md");
        click(linkIn(root));
        expect(openLinkText).toHaveBeenCalledWith("Note A", "third.md", true);
    });

    test("wireInternalLinks on its own: one open per click, however often it is called", () => {
        const fake = fakeApp();
        const surface = newRoot();
        const link = create("a");
        link.setAttribute("class", "internal-link");
        link.setAttribute("href", "X");
        link.setAttribute("data-href", "X");
        surface.appendChild(link);
        wireInternalLinks(surface, fake.app, "n.md");
        wireInternalLinks(surface, fake.app, "n.md");
        wireInternalLinks(surface, fake.app, () => "m.md");

        click(surface.firstElementChild);

        expect(fake.openLinkText).toHaveBeenCalledTimes(1);
        expect(fake.openLinkText).toHaveBeenCalledWith("X", "n.md", true);
    });

    describe("hovering", () => {
        test("asks for a page preview once, with the card's note for relative links", async () => {
            const link = await setUp();
            const event = new MouseEvent("mouseover", { bubbles: true });
            link.dispatchEvent(event);

            expect(trigger).toHaveBeenCalledTimes(1);
            expect(trigger).toHaveBeenCalledWith("hover-link", {
                event,
                source: HOVER_LINK_SOURCE,
                hoverParent: { hoverPopover: null },
                targetEl: link,
                linktext: "Note A",
                sourcePath: "dir/src.md",
            });
        });

        test("moving around inside the same link asks again for nothing", async () => {
            const link = await setUp("[[Note A]]");
            const inner = create("span");
            link.appendChild(inner);
            inner.dispatchEvent(
                new MouseEvent("mouseover", { bubbles: true, relatedTarget: link }),
            );
            expect(trigger).not.toHaveBeenCalled();
        });

        test("a link without a target asks for nothing", async () => {
            const link = await setUp();
            link.removeAttribute("href");
            link.removeAttribute("data-href");
            link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            expect(trigger).not.toHaveBeenCalled();
        });

        test("each surface has a hover parent of its own", async () => {
            const first = await setUp();
            first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            const firstParent = trigger.mock.calls[0][1].hoverParent;

            const second = await setUp();
            second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            const secondParent = trigger.mock.calls[0][1].hoverParent;

            expect(secondParent).not.toBe(firstParent);
        });
    });
});

describe("registerHoverLinkSource", () => {
    test("lists the plugin in Page preview settings, with no key needed, as reading view has", () => {
        const registerHover = jest.fn();
        registerHoverLinkSource({
            registerHoverLinkSource: registerHover,
            manifest: { name: "Flashcard Studio" },
        } as unknown as Plugin);
        expect(registerHover).toHaveBeenCalledWith(HOVER_LINK_SOURCE, {
            display: "Flashcard Studio",
            defaultMod: false,
        });
    });
});
