import {
    formatImageClozeBlock,
    isImageClozeFenceLine,
    parseImageClozeBlock,
    readCardField,
    scanImageClozeFences,
} from "src/occlusion/image-cloze-block";

const EXAMPLE = [
    "image: [[Heart.png]]",
    "mode: hide-all",
    "question: Name the chamber",
    "mask: 1   | a5l rect 0.3617 0.3182 0.2958 0.3116 | chamber",
    "mask: 2   | b2k rect 0.1000 0.2000 0.1500 0.1000 |",
    "mask: ash | c9x ellipse 0.5500 0.2200 0.1400 0.0800 | valve",
    "mask: 0   | d4m rect 0.7000 0.7000 0.1000 0.1000 |",
].join("\n");

describe("readCardField", () => {
    test("numbers: one, a list with spaces, repeats counted once", () => {
        expect(readCardField("1")).toEqual({ kind: "numbers", numbers: [1] });
        expect(readCardField("1, 2")).toEqual({ kind: "numbers", numbers: [1, 2] });
        expect(readCardField("2,2")).toEqual({ kind: "numbers", numbers: [2] });
        expect(readCardField("3,1")).toEqual({ kind: "numbers", numbers: [1, 3] });
    });

    test("zero alone is always hidden", () => {
        expect(readCardField("0")).toEqual({ kind: "zero" });
    });

    test("letters a, s and h", () => {
        expect(readCardField("ash")).toEqual({ kind: "letters", seq: "ash" });
    });

    test.each(["x", "1,a", "0,1", "01", "100", "", "a".repeat(100), "1,,2", "ab"])(
        "%p cannot be read",
        (text) => {
            expect(readCardField(text)).toBeNull();
        },
    );
});

describe("parseImageClozeBlock", () => {
    test("the example block", () => {
        const read = parseImageClozeBlock(EXAMPLE);
        if (!read.ok) throw new Error("not read");
        expect(read.block.image).toBe("[[Heart.png]]");
        expect(read.block.mode).toBe("hide-all");
        expect(read.block.question).toBe("Name the chamber");
        expect(read.block.masks).toHaveLength(4);
        expect(read.block.masks[2].field).toEqual({ kind: "letters", seq: "ash" });
        expect(read.block.masks[2].fieldText).toBe("ash");
        expect(read.block.masks[2].hint).toBe("valve");
        expect(read.block.masks[2].shape).toBe("ellipse");
        expect(read.block.masks[0]).toMatchObject({ id: "a5l", x: 0.3617, y: 0.3182 });
        expect(read.block.masks[1].hint).toBe("");
    });

    test("a hint is kept as written after the second bar", () => {
        const read = parseImageClozeBlock("image: x.png\nmask: 1 | a rect 0 0 .1 .1 | a | b");
        if (!read.ok) throw new Error("not read");
        expect(read.block.masks[0].hint).toBe("a | b");
    });

    test("a hint with a wiki link and an alias survives a round trip", () => {
        const source =
            "image: x.png\nmode: hide-one\nmask: 1,2 | a rect 0 0 .1 .1 | [[Heart|chamber]]";
        const read = parseImageClozeBlock(source);
        if (!read.ok) throw new Error("not read");
        const again = parseImageClozeBlock(formatImageClozeBlock(read.block));
        expect(again).toEqual(read);
        expect(read.block.masks[0].hint).toBe("[[Heart|chamber]]");
    });

    test("a bad card field names its line", () => {
        const source = EXAMPLE.split("\n");
        source[4] = "mask: x | b2k rect 0.1 0.2 0.15 0.1 |";
        expect(parseImageClozeBlock(source.join("\n"))).toEqual({
            ok: false,
            line: 5,
            problem: "field",
        });
    });

    test("a duplicate mask id", () => {
        const source = "image: x.png\nmask: 1 | a rect 0 0 .1 .1 |\nmask: 2 | a rect .5 .5 .1 .1 |";
        expect(parseImageClozeBlock(source)).toEqual({
            ok: false,
            line: 3,
            problem: "duplicate-id",
        });
    });

    test("bad geometry", () => {
        const source = "image: x.png\nmask: 1 | a rect 0 0 zero .1 |";
        expect(parseImageClozeBlock(source)).toEqual({ ok: false, line: 2, problem: "geometry" });
    });

    test("a line with a comment cannot be read, wherever it is", () => {
        const source = "image: x.png\nmask: 1 | a rect 0 0 .1 .1 | <!--SR:!2026-01-01,1,250-->";
        expect(parseImageClozeBlock(source)).toEqual({ ok: false, line: 2, problem: "comment" });
        expect(
            parseImageClozeBlock("<!-- x -->\nimage: x.png\nmask: 1 | a rect 0 0 .1 .1 |"),
        ).toEqual({
            ok: false,
            line: 1,
            problem: "comment",
        });
    });

    test("no image, no mask", () => {
        expect(parseImageClozeBlock("mask: 1 | a rect 0 0 .1 .1 |")).toEqual({
            ok: false,
            line: 0,
            problem: "no-image",
        });
        expect(parseImageClozeBlock("image: x.png")).toEqual({
            ok: false,
            line: 0,
            problem: "no-mask",
        });
    });
});

describe("isImageClozeFenceLine", () => {
    test.each([
        "```image-cloze",
        "  ```image-cloze",
        "> ```image-cloze",
        "> > ~~~image-cloze",
        "~~~image-cloze",
    ])("%p opens a block", (line) => {
        expect(isImageClozeFenceLine(line)).toBe(true);
    });

    test.each(["```image-occlusion", "```", "text ```image-cloze", "```image-clozes"])(
        "%p does not",
        (line) => {
            expect(isImageClozeFenceLine(line)).toBe(false);
        },
    );
});

describe("scanImageClozeFences", () => {
    test("a closed block at the left edge", () => {
        const lines = ["text", "```image-cloze", "image: x.png", "```", "after"];
        expect(scanImageClozeFences(lines)).toEqual([
            { open: 1, close: 3, leftEdge: true, quoted: false, closed: true, hasComment: false },
        ]);
    });

    test("an unclosed block runs to the end of the note", () => {
        const lines = ["```image-cloze", "image: x.png", "", "more"];
        expect(scanImageClozeFences(lines)).toEqual([
            { open: 0, close: 3, leftEdge: true, quoted: false, closed: false, hasComment: false },
        ]);
    });

    test("an unclosed quoted block ends with its quote", () => {
        const lines = ["> ```image-cloze", "> image: x.png", "after the quote", "more"];
        expect(scanImageClozeFences(lines)).toEqual([
            { open: 0, close: 1, leftEdge: false, quoted: true, closed: false, hasComment: false },
        ]);
    });

    test("a quoted block closes inside its quote", () => {
        const lines = ["> ```image-cloze", "> image: x.png", "> ```", "after"];
        expect(scanImageClozeFences(lines)).toEqual([
            { open: 0, close: 2, leftEdge: false, quoted: true, closed: true, hasComment: false },
        ]);
    });

    test("an indented block is not at the left edge", () => {
        const lines = ["  ```image-cloze", "  image: x.png", "  ```"];
        expect(scanImageClozeFences(lines)[0]).toMatchObject({
            leftEdge: false,
            quoted: false,
            closed: true,
        });
    });

    test("a comment in a hint is seen", () => {
        const lines = ["```image-cloze", "mask: 1 | a rect 0 0 .1 .1 | <!--SR:!x-->", "```"];
        expect(scanImageClozeFences(lines)[0].hasComment).toBe(true);
    });

    test("two blocks, and a longer closing fence", () => {
        const lines = ["````image-cloze", "```", "````", "", "```image-cloze", "```"];
        expect(scanImageClozeFences(lines).map(({ open, close }) => [open, close])).toEqual([
            [0, 2],
            [4, 5],
        ]);
    });

    test("an image-occlusion block is not one", () => {
        expect(scanImageClozeFences(["```image-occlusion", "image: x.png", "```"])).toEqual([]);
    });
});
