import type { App } from "obsidian";

import { ImageClozeBlock, parseImageClozeBlock } from "src/occlusion/image-cloze-block";
import {
    imageClozeCardMarkdown,
    imageClozeCardText,
    imageClozeDrawing,
    parseImageClozeCardSpec,
    renderImageClozeCard,
    renderImageClozeNote,
    toOcclusionView,
} from "src/occlusion/image-cloze-view";

jest.mock("obsidian", () =>
    jest.requireActual<object>("../note-review/helpers/obsidian-dom-mock.cjs"),
);

// The DOM helpers the drawing uses that the mock does not have: SVG elements and the element's window
const P = HTMLElement.prototype as unknown as Record<string, unknown>;
const SVG = "http://www.w3.org/2000/svg";
function createSvg(
    this: Element,
    tag: string,
    o?: { cls?: string[] | string; attr?: Record<string, string | number> },
): Element {
    const el = document.createElementNS(SVG, tag);
    const cls = o?.cls === undefined ? [] : Array.isArray(o.cls) ? o.cls : [o.cls];
    el.classList.add(...cls);
    for (const [key, value] of Object.entries(o?.attr ?? {})) el.setAttribute(key, String(value));
    this.appendChild(el);
    return el;
}
P.createSvg = createSvg;
(SVGElement.prototype as unknown as Record<string, unknown>).createSvg = createSvg;
Object.defineProperty(HTMLElement.prototype, "win", { get: () => window, configurable: true });

function appWith(image: boolean): App {
    return {
        metadataCache: { getFirstLinkpathDest: () => (image ? { name: "Heart.png" } : null) },
        vault: { getResourcePath: () => "app://heart" },
    } as unknown as App;
}

const SOURCE = [
    "image: [[Heart.png]]",
    "mode: hide-all",
    "question: Name the chamber",
    "mask: 1   | a5l rect 0.3617 0.3182 0.2958 0.3116 | chamber",
    "mask: 2   | b2k rect 0.1000 0.2000 0.1500 0.1000 |",
    "mask: ash | c9x ellipse 0.5500 0.2200 0.1400 0.0800 | valve",
    "mask: 0   | d4m rect 0.7000 0.7000 0.1000 0.1000 |",
].join("\n");

function read(source: string): ImageClozeBlock {
    const result = parseImageClozeBlock(source);
    if (!result.ok) throw new Error("not read");
    return result.block;
}
const BLOCK = read(SOURCE);
const spec = (card: number, side: "front" | "back", block = BLOCK, textCards = 0) => ({
    kind: "cloze" as const,
    block,
    card,
    side,
    textCards,
});

describe("imageClozeDrawing", () => {
    test("card 1 front: its mask asked with its hint, the others hidden (hide all), the 0 mask hidden", () => {
        const drawing = imageClozeDrawing(spec(1, "front"));
        expect(drawing.states).toEqual(["hidden-active", "hidden", "hidden-active", "hidden"]);
        expect(drawing.tags).toEqual(["chamber", "", "valve", ""]);
    });

    test("card 1 back: the asked masks are outlined, with no text", () => {
        const drawing = imageClozeDrawing(spec(1, "back"));
        expect(drawing.states).toEqual(["revealed", "hidden", "revealed", "hidden"]);
        expect(drawing.tags).toEqual(["", "", "", ""]);
    });

    test("card 2 asks the mask without a hint with a question mark; the letter mask shows", () => {
        const drawing = imageClozeDrawing(spec(2, "front"));
        expect(drawing.states).toEqual(["hidden", "hidden-active", "none", "hidden"]);
        expect(drawing.tags).toEqual(["", "?", "", ""]);
    });

    test("card 3: the letter mask is hidden (h), nothing asked by the block", () => {
        const drawing = imageClozeDrawing(spec(3, "back", BLOCK, 3));
        expect(drawing.states).toEqual(["hidden", "hidden", "hidden", "hidden"]);
    });

    test("the 0 mask is never revealed, on any card or side", () => {
        for (const card of [1, 2])
            for (const side of ["front", "back"] as const)
                expect(imageClozeDrawing(spec(card, side)).states[3]).toBe("hidden");
    });

    test("an asked mask under a hidden one: the hidden one stays hidden on the back (as Anki)", () => {
        const block = read(
            "image: x.png\nmask: 2 | big rect 0 0 1 1 |\nmask: 1 | small rect .4 .4 .1 .1 |",
        );
        expect(imageClozeDrawing(spec(1, "back", block)).states).toEqual(["hidden", "revealed"]);
    });

    test("the asked masks are drawn last, in their order", () => {
        const block = read(
            "image: x.png\nmask: 1 | a rect 0 0 .1 .1 |\nmask: 0 | z rect .5 .5 .1 .1 |\nmask: 1 | b rect .2 .2 .1 .1 |",
        );
        expect(imageClozeDrawing(spec(1, "front", block)).order).toEqual([1, 0, 2]);
    });
});

describe("the card spec", () => {
    test("round trip, with kind cloze", () => {
        const markdown = imageClozeCardMarkdown(spec(2, "back"));
        expect(markdown.startsWith("```fs-image-cloze-card\n")).toBe(true);
        const source = markdown.slice(markdown.indexOf("\n") + 1, markdown.lastIndexOf("\n```"));
        expect(parseImageClozeCardSpec(source)).toEqual(spec(2, "back"));
    });

    test("a card that is not one of the question's is refused", () => {
        const json = JSON.stringify(spec(4, "front", BLOCK, 0));
        expect(parseImageClozeCardSpec(json)).toBeNull();
        expect(parseImageClozeCardSpec(JSON.stringify(spec(4, "front", BLOCK, 4)))).not.toBeNull();
    });

    test("another kind, or a spec of the old card, is refused", () => {
        expect(
            parseImageClozeCardSpec(JSON.stringify({ ...spec(1, "front"), kind: "answers" })),
        ).toBeNull();
        expect(
            parseImageClozeCardSpec(JSON.stringify({ block: BLOCK, active: 0, side: "front" })),
        ).toBeNull();
        expect(parseImageClozeCardSpec("not json")).toBeNull();
    });

    test("a backtick in a hint cannot close the fence", () => {
        const block = read("image: x.png\nmask: 1 | a rect 0 0 .1 .1 | a `b` c");
        const markdown = imageClozeCardMarkdown(spec(1, "front", block));
        expect(markdown.split("\n")).toHaveLength(3);
    });
});

describe("imageClozeCardText", () => {
    test("a card of a block alone: its question and the hints it asks, in full", () => {
        const long = "x".repeat(200);
        const block = read(`image: x.png\nquestion: Q\nmask: 1 | a rect 0 0 .1 .1 | ${long}`);
        expect(imageClozeCardText(imageClozeCardMarkdown(spec(1, "front", block)))).toBe(
            `Q · ${long}`,
        );
    });

    test("no hint: the card number", () => {
        expect(imageClozeCardText(imageClozeCardMarkdown(spec(2, "front")))).toBe(
            "Name the chamber · Card 2",
        );
    });

    test("a card of text and image: the text, with the picture as its hints", () => {
        const markdown = `The [...] pumps.\n${imageClozeCardMarkdown(spec(1, "front"))}`;
        expect(imageClozeCardText(markdown)).toBe("The [...] pumps. [image: chamber, valve]");
    });

    test("not an image cloze card", () => {
        expect(imageClozeCardText("plain text")).toBeNull();
    });
});

test("toOcclusionView keeps the geometry and puts the hint in the label", () => {
    const view = toOcclusionView(BLOCK);
    expect(view.masks[0]).toEqual({
        id: "a5l",
        shape: "rect",
        x: 0.3617,
        y: 0.3182,
        w: 0.2958,
        h: 0.3116,
        label: "chamber",
    });
    expect(view.question).toBe("Name the chamber");
});

describe("drawing into the page", () => {
    test("a front: asked masks last, the first asked one first among them, hint tags with the full hint as a tooltip", () => {
        const block = read(
            "image: x.png\nmask: 2 | a rect 0 0 .1 .1 | first\nmask: hh | z rect .5 .5 .1 .1 |\nmask: 2 | b rect .2 .2 .1 .1 | second",
        );
        const el = document.body.createDiv();
        renderImageClozeCard(el, appWith(true), "note.md", spec(2, "front", block));
        expect(el.hasClass("is-cloze")).toBe(true);
        const masks = [...el.querySelectorAll(".fs-mask")];
        expect(masks).toHaveLength(3);
        expect(masks[0].classList.contains("is-active")).toBe(false);
        expect(el.querySelector(".fs-mask.is-active")?.getAttribute("x")).toBe("0");
        const tags = [...el.querySelectorAll(".fs-occ-tag")];
        expect(tags.map((tag) => tag.textContent)).toEqual(["first", "second"]);
        expect(tags.map((tag) => tag.getAttribute("title"))).toEqual(["first", "second"]);
        expect(el.querySelector(".fs-occ-answer")).toBeNull();
    });

    test("a back has no answer line under the picture", () => {
        const el = document.body.createDiv();
        renderImageClozeCard(el, appWith(true), "note.md", spec(1, "back"));
        expect(el.hasClass("is-back")).toBe(true);
        expect(el.querySelector(".fs-occ-answer")).toBeNull();
        expect(el.querySelectorAll(".fs-mask.is-revealed")).toHaveLength(2);
    });

    test("an image that is not in the vault, on a card and in the note", () => {
        const card = document.body.createDiv();
        renderImageClozeCard(card, appWith(false), "note.md", spec(1, "front"));
        expect(card.querySelector(".fs-occ-missing")?.textContent).toContain("Heart.png");
        const note = document.body.createDiv();
        renderImageClozeNote(note, appWith(false), "note.md", SOURCE);
        expect(note.querySelector(".fs-occ-missing")?.textContent).toContain("Heart.png");
    });

    test("in the note every mask is outlined with its card field and hint", () => {
        const el = document.body.createDiv();
        renderImageClozeNote(el, appWith(true), "note.md", SOURCE);
        expect([...el.querySelectorAll(".fs-occ-tag")].map((tag) => tag.textContent)).toEqual([
            "1 · chamber",
            "2",
            "ash · valve",
            "0",
        ]);
    });

    test("a block with a line that cannot be read says which line", () => {
        const el = document.body.createDiv();
        renderImageClozeNote(el, appWith(true), "note.md", SOURCE.replace("mask: 2 ", "mask: x "));
        expect(el.querySelector(".fs-occ-missing")?.textContent).toBe(
            "Line 5 of this image cloze block cannot be read.",
        );
    });
});
