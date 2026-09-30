import { Component } from "obsidian";

import { parseMultipleChoice } from "src/data/data-structures/card/questions/multiple-choice";
import {
    ChoiceState,
    createChoiceState,
    renderChoiceBack,
    renderChoiceFront,
    renderChoiceTiles,
    revealChoiceResult,
} from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import { TextDirection } from "src/utils/strings";

// Obsidian is not there in a unit test: a stand-in renderer that fills in the text when told to, so a test can see
// what happens before and after the Markdown is in
type Pending = { text: string; el: HTMLElement; done: () => void };
const pending: Pending[] = [];
let autoRender = true;

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../__mocks__/obsidian"),
    setIcon: jest.fn(),
    Component: class {},
    MarkdownRenderer: {
        render: (_app: unknown, text: string, el: HTMLElement) =>
            new Promise<void>((resolve) => {
                const done = () => {
                    el.textContent = text;
                    resolve();
                };
                if (autoRender) done();
                else pending.push({ text, el, done });
            }),
    },
}));

// The helpers Obsidian adds to every element
const create = (tag: string): HTMLElement =>
    document.createElementNS("http://www.w3.org/1999/xhtml", tag);
const newDiv = (): HTMLElement => create("div");

function make(
    parent: HTMLElement,
    tag: string,
    options: DomElementInfo | string = {},
): HTMLElement {
    const o: DomElementInfo = typeof options === "string" ? { cls: options } : options;
    const el = create(tag);
    if (o.cls) el.className = String(o.cls);
    if (typeof o.text === "string") el.textContent = o.text;
    for (const [key, value] of Object.entries(o.attr ?? {})) el.setAttribute(key, String(value));
    parent.appendChild(el);
    return el;
}

const obsidianHelpers = {
    createEl(this: HTMLElement, tag: string, options?: DomElementInfo | string): HTMLElement {
        return make(this, tag, options);
    },
    createDiv(this: HTMLElement, options?: DomElementInfo | string): HTMLElement {
        return make(this, "div", options);
    },
    createSpan(this: HTMLElement, options?: DomElementInfo | string): HTMLElement {
        return make(this, "span", options);
    },
    addClass(this: HTMLElement, ...classes: string[]): void {
        this.classList.add(...classes);
    },
    hasClass(this: HTMLElement, cls: string): boolean {
        return this.classList.contains(cls);
    },
    toggleClass(this: HTMLElement, cls: string, on: boolean): void {
        this.classList.toggle(cls, on);
    },
};

beforeAll(() => {
    Object.assign(HTMLElement.prototype, obsidianHelpers);
});

beforeEach(() => {
    pending.length = 0;
    autoRender = true;
});

const MC = parseMultipleChoice("Choose:\n- [ ] A\n- [x] B\n- [ ] C\nWhy B.");
const MULTI = parseMultipleChoice("- [x] A\n- [ ] B\n- [x] C");
const ctx = { app: {} as never, sourcePath: "n.md", component: new Component() };

describe("renderChoiceTiles", () => {
    test("one tile per option in the given order, numbered by position, keyed by option index", async () => {
        const parent = newDiv();
        const { tiles, rendered } = renderChoiceTiles(parent, MC, [2, 0, 1], {
            mode: "choose",
            chosen: [],
            multiSelect: false,
            ...ctx,
        });
        await rendered;
        expect(tiles).toHaveLength(3);
        expect(tiles.map((tile) => tile.dataset.option)).toEqual(["2", "0", "1"]);
        expect(tiles.map((tile) => tile.querySelector(".fs-choice-key")?.textContent)).toEqual([
            "1",
            "2",
            "3",
        ]);
        expect(tiles.map((tile) => tile.querySelector(".fs-choice-text")?.textContent)).toEqual([
            "C",
            "A",
            "B",
        ]);
        expect(tiles.every((tile) => tile.tagName === "BUTTON")).toBe(true);
    });

    test("rendered resolves only when every option's Markdown is in", async () => {
        autoRender = false;
        const parent = newDiv();
        const { rendered } = renderChoiceTiles(parent, MC, [0, 1, 2], {
            mode: "choose",
            chosen: [],
            multiSelect: false,
            ...ctx,
        });
        let resolved = false;
        void rendered.then(() => (resolved = true));
        expect(pending).toHaveLength(3);
        pending[0].done();
        pending[1].done();
        await Promise.resolve();
        await Promise.resolve();
        expect(resolved).toBe(false);
        pending[2].done();
        await rendered;
        expect(resolved).toBe(true);
    });

    test("onRendered is called with each element once its Markdown is in", async () => {
        const seen: string[] = [];
        const parent = newDiv();
        await renderChoiceTiles(parent, MC, [0, 1, 2], {
            mode: "choose",
            chosen: [],
            multiSelect: false,
            ...ctx,
            onRendered: (el) => seen.push(el.textContent ?? ""),
        }).rendered;
        expect(seen).toEqual(["A", "B", "C"]);
    });

    test("choosing a single-answer tile selects it and clears the one chosen before", () => {
        const parent = newDiv();
        const chosen: number[] = [];
        const { tiles } = renderChoiceTiles(parent, MC, [2, 0, 1], {
            mode: "choose",
            chosen: [],
            multiSelect: false,
            ...ctx,
            onChoose: (optionIndex) => chosen.push(optionIndex),
        });
        expect(parent.getAttribute("role")).toBe("radiogroup");
        tiles[1].click();
        tiles[2].click();
        // The option indices, not the positions
        expect(chosen).toEqual([0, 1]);
        expect(tiles.map((tile) => tile.classList.contains("is-selected"))).toEqual([
            false,
            false,
            true,
        ]);
        expect(tiles.map((tile) => tile.getAttribute("aria-checked"))).toEqual([
            "false",
            "false",
            "true",
        ]);
        expect(tiles[0].getAttribute("role")).toBe("radio");
    });

    test("several-answer tiles toggle, and a pointer click leaves no focus on the tile", () => {
        const parent = newDiv();
        document.body.appendChild(parent);
        const { tiles } = renderChoiceTiles(parent, MULTI, [0, 1, 2], {
            mode: "choose",
            chosen: [],
            multiSelect: true,
            ...ctx,
        });
        expect(parent.getAttribute("role")).toBe("group");
        tiles[0].click();
        tiles[2].click();
        tiles[0].click();
        expect(tiles.map((tile) => tile.classList.contains("is-selected"))).toEqual([
            false,
            false,
            true,
        ]);
        expect(tiles[2].getAttribute("aria-pressed")).toBe("true");

        tiles[1].focus();
        tiles[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(document.activeElement).not.toBe(tiles[1]);
        tiles[1].focus();
        tiles[1].click(); // from the keyboard: detail 0
        expect(document.activeElement).toBe(tiles[1]);
        parent.remove();
    });

    test("tiles chosen before start out selected", () => {
        const { tiles } = renderChoiceTiles(newDiv(), MULTI, [0, 1, 2], {
            mode: "choose",
            chosen: [2],
            multiSelect: true,
            ...ctx,
        });
        expect(tiles.map((tile) => tile.classList.contains("is-selected"))).toEqual([
            false,
            false,
            true,
        ]);
    });

    test("result mode marks the right options, a wrong choice and your answer, and takes no clicks", () => {
        const parent = newDiv();
        const { tiles } = renderChoiceTiles(parent, MC, [0, 1, 2], {
            mode: "result",
            chosen: [0],
            multiSelect: false,
            ...ctx,
        });
        expect(tiles.every((tile) => tile.tagName === "DIV")).toBe(true);
        expect(tiles[0].className).toContain("is-wrong");
        expect(tiles[0].className).toContain("is-picked");
        expect(tiles[1].className).toContain("is-correct");
        expect(tiles[1].className).not.toContain("is-picked");
        expect(tiles[2].className).not.toMatch(/is-(correct|wrong|picked)/);
        expect(tiles[0].querySelector(".fs-choice-tag")?.textContent).toBe("Your answer · wrong");
        expect(tiles[1].querySelector(".fs-choice-tag")?.textContent).toBe("Right answer");
        expect(tiles[2].querySelector(".fs-choice-tag")).toBeNull();
    });

    test("a right-to-left note sets the direction on the tiles", () => {
        const options = {
            mode: "choose" as const,
            chosen: [] as number[],
            multiSelect: false,
            ...ctx,
        };
        const rtl = newDiv();
        renderChoiceTiles(rtl, MC, [0, 1, 2], { ...options, textDirection: TextDirection.Rtl });
        expect(rtl.getAttribute("dir")).toBe("rtl");
        const ltr = newDiv();
        renderChoiceTiles(ltr, MC, [0, 1, 2], { ...options, textDirection: TextDirection.Ltr });
        expect(ltr.hasAttribute("dir")).toBe(false);
    });
});

describe("renderChoiceFront", () => {
    function front(mc: NonNullable<typeof MC>, onSubmit = jest.fn()) {
        const parent = newDiv();
        const state = createChoiceState({} as never, mc, false);
        const handle = renderChoiceFront(parent, state, ctx, onSubmit);
        return { parent, state, handle, onSubmit };
    }

    test("a single answer submits at once, with the option chosen, and the number key does the same", async () => {
        const { parent, state, handle, onSubmit } = front(MC);
        await handle.rendered;
        expect(parent.querySelector(".fs-choice-lead")?.textContent).toBe("Choose:");
        handle.chooseAt(1);
        expect(state.chosen).toEqual([1]);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        handle.chooseAt(7); // no such option: nothing happens
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test("several answers wait for Check, which needs a selection", () => {
        const { parent, state, handle, onSubmit } = front(MULTI);
        const check = parent.querySelector<HTMLButtonElement>(".fs-choice-check");
        expect(parent.querySelector(".fs-choice-hint")?.textContent).toBe("Select all that apply");
        expect(check.disabled).toBe(true);
        handle.chooseAt(0);
        handle.chooseAt(2);
        expect(state.chosen).toEqual([0, 2]);
        expect(check.disabled).toBe(false);
        expect(onSubmit).not.toHaveBeenCalled();
        handle.chooseAt(0);
        expect(state.chosen).toEqual([2]);
        check.click();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test("once the answer is showing, the old tiles change nothing", () => {
        const { state, handle, onSubmit } = front(MC);
        state.locked = true;
        handle.chooseAt(0);
        expect(state.chosen).toEqual([]);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe("renderChoiceBack", () => {
    test("resolves after the explanation and the options are in, marks the tiles, and shows the explanation", async () => {
        autoRender = false;
        const parent = newDiv();
        const state: ChoiceState = {
            ...createChoiceState({} as never, MC, false),
            chosen: [0],
            locked: true,
        };
        let done = false;
        const back = renderChoiceBack(parent, state, ctx).then(() => (done = true));
        await Promise.resolve();
        expect(done).toBe(false);
        pending.forEach((p) => p.done());
        await back;
        expect(done).toBe(true);
        expect(parent.querySelector(".fs-choice-explanation-text")?.textContent).toBe("Why B.");
        expect(parent.querySelectorAll(".fs-choice.is-correct")).toHaveLength(1);
    });

    test("a card without an explanation has no explanation box", async () => {
        const parent = newDiv();
        const mc = parseMultipleChoice("- [x] A\n- [ ] B");
        await renderChoiceBack(
            parent,
            { ...createChoiceState({} as never, mc, false), locked: true },
            ctx,
        );
        expect(parent.querySelector(".fs-choice-explanation")).toBeNull();
    });
});

describe("revealChoiceResult", () => {
    // jsdom has no layout: each element gets a top, and scrolls are recorded
    function card(tileTop: number, contentTop = 100) {
        const content = newDiv();
        const tile = newDiv();
        tile.className = "fs-choice is-picked";
        const explanation = newDiv();
        explanation.className = "fs-choice-explanation";
        content.append(tile, explanation);
        const scrolls: string[] = [];
        content.getBoundingClientRect = () => ({ top: contentTop }) as DOMRect;
        tile.getBoundingClientRect = () => ({ top: tileTop }) as DOMRect;
        tile.scrollIntoView = (arg) => void scrolls.push(`tile ${JSON.stringify(arg)}`);
        explanation.scrollIntoView = (arg) =>
            void scrolls.push(`explanation ${JSON.stringify(arg)}`);
        return { content, scrolls };
    }

    test("shows the explanation when the chosen tile stays in view", () => {
        const { content, scrolls } = card(150);
        revealChoiceResult(content);
        expect(scrolls).toEqual(['explanation {"block":"nearest"}']);
    });

    test("puts the chosen tile first when the explanation would push it out of view", () => {
        const { content, scrolls } = card(60);
        revealChoiceResult(content);
        expect(scrolls).toEqual(['explanation {"block":"nearest"}', 'tile {"block":"start"}']);
    });

    test("without an explanation it shows the last marked tile, and nothing marked does nothing", () => {
        const content = newDiv();
        expect(() => revealChoiceResult(content)).not.toThrow();
        const { content: withTile, scrolls } = card(150);
        withTile.querySelector(".fs-choice-explanation").remove();
        revealChoiceResult(withTile);
        expect(scrolls).toEqual(['tile {"block":"nearest"}']);
    });
});
