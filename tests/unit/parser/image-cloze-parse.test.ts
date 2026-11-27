import { parse, ParserOptions, parserOptionsFromSettings } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings } from "src/data/settings-model";
import { scanImageClozeFences } from "src/occlusion/image-cloze-block";

function options(changes: Partial<ParserOptions> = {}): ParserOptions {
    return { ...parserOptionsFromSettings(cloneDefaultSettings()), ...changes };
}

const BLOCK = ["```image-cloze", "image: x.png", "mask: 1 | a rect 0 0 .1 .1 | hint", "```"];

/** Each question as [type name, first line, last line]. */
function shape(text: string, opts = options()): [string, number, number][] {
    return parse(text, opts).map((q) => [CardType[q.cardType], q.firstLineNum, q.lastLineNum]);
}

describe.each([false, true])("latexClozes %p", (latexClozes) => {
    const opts = options({ latexClozes });

    test("a block alone is one image cloze question, with its schedule comment", () => {
        const text = [...BLOCK, "<!--SR:!2026-01-01,1,250,c=1-->", "", "after"].join("\n");
        const questions = parse(text, opts);
        expect(questions.map((q) => [CardType[q.cardType], q.firstLineNum, q.lastLineNum])).toEqual(
            [["ImageCloze", 0, 4]],
        );
        expect(questions[0].text).toBe([...BLOCK, "<!--SR:!2026-01-01,1,250,c=1-->"].join("\n"));
    });

    test("a cloze line with a block under it is one cloze question", () => {
        expect(shape(["The ==1;;a== pumps.", ...BLOCK].join("\n"), opts)).toEqual([
            ["Cloze", 0, 4],
        ]);
    });

    test("a block with a cloze line under it is one cloze question", () => {
        expect(shape([...BLOCK, "The ==1;;a== pumps."].join("\n"), opts)).toEqual([
            ["Cloze", 0, 4],
        ]);
    });

    test("plain text with a block is one image cloze question", () => {
        expect(shape(["Label the heart:", ...BLOCK].join("\n"), opts)).toEqual([
            ["ImageCloze", 0, 4],
        ]);
    });

    test("atomic clozes do not split a paragraph that has a block", () => {
        const text = ["First ==1;;a==.", "Second ==2;;b==.", ...BLOCK].join("\n");
        expect(shape(text, { ...opts, atomicClozes: true })).toEqual([["Cloze", 0, 5]]);
    });

    test("an indented block's lines are never cards", () => {
        const text = ["Some text", "  ```image-cloze", "  A::B", "  ```"].join("\n");
        expect(shape(text, opts)).toEqual([]);
    });

    test("A::B first is its own card; then the cloze and the block, as the cloze alone parses today", () => {
        const text = ["A::B", "The ==1;;a== pumps.", ...BLOCK].join("\n");
        // A one-line card does not move its paragraph's first line: the cloze after it starts at 0, as it does today
        const today = shape(["A::B", "The ==1;;a== pumps."].join("\n"), opts);
        expect(today).toEqual([
            ["SingleLineBasic", 0, 0],
            ["Cloze", 0, 1],
        ]);
        expect(shape(text, opts)).toEqual([
            ["SingleLineBasic", 0, 0],
            ["Cloze", 0, 5],
        ]);
    });

    test("a cloze, then A::B, then a block: one cloze question, as today", () => {
        const text = ["The ==1;;a== pumps.", "A::B", ...BLOCK].join("\n");
        expect(shape(text, opts)).toEqual([["Cloze", 0, 5]]);
    });

    test("an unclosed block: no question from its line to the end of the note", () => {
        const text = [
            "The ==1;;a== pumps.",
            "```image-cloze",
            "image: x.png",
            "",
            "Q ==1;;x==",
            "",
            "A::B",
        ].join("\n");
        expect(shape(text, opts)).toEqual([]);
    });

    test("an unclosed quoted block ends with its quote", () => {
        const text = ["> ```image-cloze", "> A::B", "", "A::B"].join("\n");
        expect(shape(text, opts)).toEqual([["SingleLineBasic", 3, 3]]);
    });

    test("a block in a multiline basic card: the basic card only", () => {
        const text = ["Question", "?", "Answer", ...BLOCK].join("\n");
        expect(shape(text, opts)).toEqual([["MultiLineBasic", 0, 6]]);
    });

    test("a block in a multiline reversed card: the reversed card only", () => {
        const text = ["Question", "??", "Answer", ...BLOCK].join("\n");
        expect(shape(text, opts)).toEqual([["MultiLineReversed", 0, 6]]);
    });

    test("what a hint holds changes nothing around the block", () => {
        const plain = ["The ==1;;a== pumps.", ...BLOCK].join("\n");
        for (const hint of ["A::B", "$x", "$$", "?", "==2;;b=="]) {
            const lines = [
                "The ==1;;a== pumps.",
                "```image-cloze",
                "image: x.png",
                `mask: 1 | a rect 0 0 .1 .1 | ${hint}`,
                "```",
            ];
            expect(shape(lines.join("\n"), opts)).toEqual(shape(plain, opts));
        }
        const separatorLine = ["The ==1;;a== pumps.", "```image-cloze", "?", "image: x.png", "```"];
        expect(shape(separatorLine.join("\n"), opts)).toEqual([["Cloze", 0, 4]]);
    });

    test("a block in start and end markers with a cloze: one cloze question", () => {
        const regions = options({
            latexClozes,
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
        });
        const text = ["+++", "The ==1;;a== pumps.", "", ...BLOCK, "+++"].join("\n");
        expect(shape(text, regions)).toEqual([["Cloze", 1, 6]]);
    });

    test("a basic card in markers with a block: no image cloze", () => {
        const regions = options({
            latexClozes,
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
        });
        const text = ["+++", "Question", "?", "Answer", ...BLOCK, "+++"].join("\n");
        expect(shape(text, regions)).toEqual([["MultiLineBasic", 1, 7]]);
    });

    test("a quoted callout card holding a block keeps its lines, body and schedule", () => {
        const callout = ["> [!question] What is it?", "> The answer", "> more"];
        const fenced = [
            "> [!question] What is it?",
            "> The answer",
            "> ```image-cloze",
            "> > [!question] x",
            "> A::B",
            "> ```",
            "> more",
        ];
        const comment = "<!--SR:!2026-01-01,1,250-->";
        const plainQ = parse([...callout, comment].join("\n"), opts);
        const fencedQ = parse([...fenced, comment].join("\n"), opts);
        expect(plainQ.map((q) => CardType[q.cardType])).toEqual(["Callout"]);
        expect(fencedQ.map((q) => [CardType[q.cardType], q.firstLineNum, q.lastLineNum])).toEqual([
            ["Callout", 0, fenced.length],
        ]);
        expect(fencedQ[0].text).toBe([...fenced, comment].join("\n"));
    });
});

test("an example in an ordinary code block is not a block", () => {
    const text = ["````markdown", "```image-cloze", "image: x.png", "```", "````"];
    expect(scanImageClozeFences(text)).toEqual([]);
    expect(shape(["The ==1;;a== pumps.", ...text].join("\n"))).toEqual([["Cloze", 0, 5]]);
});

test("notes without image cloze blocks parse exactly as before", () => {
    const text = [
        "Q::A",
        "",
        "The ==1;;a== and ==2;;b==.",
        "",
        "```image-occlusion",
        "image: x.png",
        "mask: a rect 0 0 .1 .1 | A",
        "```",
        "",
        "Question",
        "?",
        "Answer",
    ].join("\n");
    expect(shape(text)).toEqual([
        ["SingleLineBasic", 0, 0],
        ["Cloze", 2, 2],
        ["ImageOcclusion", 4, 7],
        ["MultiLineBasic", 9, 11],
    ]);
});
