import {
    closingFenceLine,
    formatOcclusionBlock,
    imagePathOf,
    isOcclusionFenceStart,
    newMaskId,
    occlusionSourceOf,
    parseOcclusionBlock,
} from "src/occlusion/occlusion-block";

const SRC = [
    "image: [[Heart.png]]",
    "mode: hide-one",
    "question: Name the chamber",
    "mask: a1 rect 0.1250 0.3000 0.1800 0.0950 | Left **ventricle**",
    "mask: b2 ellipse 0.55 0.22 0.14 0.08 |",
].join("\n");

describe("parseOcclusionBlock", () => {
    test("reads image, mode, question and masks", () => {
        expect(parseOcclusionBlock(SRC)).toEqual({
            image: "[[Heart.png]]",
            mode: "hide-one",
            question: "Name the chamber",
            masks: [
                {
                    id: "a1",
                    shape: "rect",
                    x: 0.125,
                    y: 0.3,
                    w: 0.18,
                    h: 0.095,
                    label: "Left **ventricle**",
                },
                { id: "b2", shape: "ellipse", x: 0.55, y: 0.22, w: 0.14, h: 0.08, label: "" },
            ],
        });
    });
    test("defaults the mode and the question", () => {
        const block = parseOcclusionBlock("image: pic.png\nmask: a rect 0 0 0.5 0.5 | A");
        expect(block?.mode).toBe("hide-all");
        expect(block?.question).toBe("");
    });
    test("no image, or no valid mask, is not a block", () => {
        expect(parseOcclusionBlock("mask: a rect 0 0 .5 .5 | A")).toBeNull();
        expect(parseOcclusionBlock("image: [[x.png]]")).toBeNull();
        expect(parseOcclusionBlock("image: [[x.png]]\nmask: a rect zero 0 .5 .5 | A")).toBeNull();
        expect(parseOcclusionBlock("image: [[x.png]]\nmask: a rect 0 0 0 .5 | A")).toBeNull();
    });
    test("clamps masks into the image", () => {
        const block = parseOcclusionBlock("image: x.png\nmask: a rect 0.9 -0.2 0.5 0.5 | A");
        expect(block?.masks[0]).toMatchObject({ x: 0.9, y: 0, w: 0.1, h: 0.5 });
    });
    test("round-trips through the canonical format", () => {
        const block = parseOcclusionBlock(SRC);
        expect(parseOcclusionBlock(formatOcclusionBlock(block))).toEqual(block);
        expect(formatOcclusionBlock(block).split("\n")[3]).toBe(
            "mask: a1 rect 0.1250 0.3000 0.1800 0.0950 | Left **ventricle**",
        );
    });
});

describe("parseOcclusionBlock, hand-edited into something malformed", () => {
    test("empty and garbage text is not a block, and does not throw", () => {
        for (const text of [
            "",
            "\n\n",
            "just some words",
            "image",
            ":::",
            "mask: |",
            "image:\nmask:",
        ]) {
            expect(parseOcclusionBlock(text)).toBeNull();
        }
    });
    test("a bad mask line is skipped and the good ones are kept", () => {
        const block = parseOcclusionBlock(
            [
                "image: x.png",
                "mask: a rect 0 0 .5 .5 | A",
                "mask: b hexagon 0 0 .5 .5 | B",
                "mask: c rect 0 0 .5 | C",
                "mask: d rect NaN 0 .5 .5 | D",
                "mask: e rect 0 0 Infinity .5 | E",
                "mask: f rect 1 0 .5 .5 | F",
                "mask: g ellipse 0.2 0.2 0.2 0.2 | G | with a bar",
            ].join("\n"),
        );
        expect(block?.masks.map((m) => m.id)).toEqual(["a", "g"]);
        expect(block?.masks[1].label).toBe("G | with a bar");
    });
    test("keys are case-insensitive, unknown lines and stray spacing are ignored", () => {
        const block = parseOcclusionBlock(
            "  IMAGE :  ![[x.png]]  \nMode: HIDE-ONE\nnotes: whatever\n\nMASK: a  RECT  0  0  .5  .5  |  Label  ",
        );
        expect(block).toEqual({
            image: "![[x.png]]",
            mode: "hide-one",
            question: "",
            masks: [{ id: "a", shape: "rect", x: 0, y: 0, w: 0.5, h: 0.5, label: "Label" }],
        });
    });
    test("an unknown mode falls back to hide-all", () => {
        expect(
            parseOcclusionBlock("image: x.png\nmode: nonsense\nmask: a rect 0 0 .5 .5 |")?.mode,
        ).toBe("hide-all");
    });
    test("the image is stored as written, in every accepted form", () => {
        for (const image of ["[[x.png]]", "![[x.png]]", "![](x.png)", "folder/x.png"]) {
            expect(parseOcclusionBlock(`image: ${image}\nmask: a rect 0 0 .5 .5 |`)?.image).toBe(
                image,
            );
        }
    });
    test("Windows line endings are read the same", () => {
        expect(parseOcclusionBlock(SRC.replaceAll("\n", "\r\n"))).toEqual(parseOcclusionBlock(SRC));
    });
    test("a label or question with a line break stays on one line when formatted", () => {
        const text = formatOcclusionBlock({
            image: "x.png",
            mode: "hide-all",
            question: "Two\nlines",
            masks: [{ id: "a", shape: "rect", x: 0, y: 0, w: 0.5, h: 0.5, label: "A\nB" }],
        });
        expect(parseOcclusionBlock(text)).toMatchObject({
            question: "Two lines",
            masks: [{ label: "A B" }],
        });
    });
});

describe("occlusionSourceOf", () => {
    test("takes the text between the fences and ignores the schedule comment", () => {
        expect(occlusionSourceOf("```image-occlusion\n" + SRC + "\n```\n<!--SR:!fsrs,x-->")).toBe(
            SRC,
        );
        expect(occlusionSourceOf("~~~image-occlusion\n" + SRC + "\n~~~")).toBe(SRC);
        expect(occlusionSourceOf("```js\nx\n```")).toBeNull();
    });
    test("an unclosed fence has no source", () => {
        expect(occlusionSourceOf("```image-occlusion\nimage: x.png")).toBeNull();
    });
});

describe("fences", () => {
    test("an opening fence is the language tag alone, trimmed", () => {
        expect(isOcclusionFenceStart("```image-occlusion")).toBe(true);
        expect(isOcclusionFenceStart("~~~image-occlusion  ")).toBe(true);
        expect(isOcclusionFenceStart("  ```image-occlusion")).toBe(true);
        expect(isOcclusionFenceStart("```js")).toBe(false);
        expect(isOcclusionFenceStart("```image-occlusion extra")).toBe(false);
        expect(isOcclusionFenceStart("image-occlusion")).toBe(false);
    });
    test("the closing fence is at least as long, of the same kind, and alone on its line", () => {
        const lines = ["````image-occlusion", "image: x", "```", "mask", "````", "after"];
        expect(closingFenceLine(lines, 0)).toBe(4);
        expect(closingFenceLine(["~~~image-occlusion", "a", "```", "~~~ "], 0)).toBe(3);
        expect(closingFenceLine(["```image-occlusion", "a"], 0)).toBe(-1);
        expect(closingFenceLine(["```image-occlusion", "```js"], 0)).toBe(-1);
    });
});

describe("newMaskId", () => {
    test("is unique among existing ids", () => {
        const ids = ["a1", "b2"];
        for (let i = 0; i < 50; i++) {
            const id = newMaskId(ids);
            expect(id).toMatch(/^[a-z0-9]{2,6}$/);
            expect(ids).not.toContain(id);
            ids.push(id);
        }
    });
});

describe("imagePathOf", () => {
    test.each([
        ["[[Heart.png]]", "Heart.png"],
        ["![[Heart.png]]", "Heart.png"],
        ["![[Heart.png|300]]", "Heart.png"],
        ["[[folder/Heart.png#page=2]]", "folder/Heart.png"],
        ["![](my%20pic.png)", "my pic.png"],
        ["![alt](<my pic.png>)", "my pic.png"],
        ["[](x.png)", "x.png"],
        ["folder/x.png", "folder/x.png"],
        ["  spaced.png  ", "spaced.png"],
        ["![](100%.png)", "100%.png"],
    ])("%s is %s", (image, path) => {
        expect(imagePathOf(image)).toBe(path);
    });
});
