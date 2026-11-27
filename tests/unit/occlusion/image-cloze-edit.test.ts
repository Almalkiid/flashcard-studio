import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings } from "src/data/settings-model";
import { parseImageClozeBlock } from "src/occlusion/image-cloze-block";
import {
    imageClozeInsertion,
    imageEmbedsIn,
    locateImageClozeBlock,
    replaceImageClozeBlock,
    sameCardNumbers,
} from "src/occlusion/image-cloze-edit";

const SOURCE = "image: x.png\nmode: hide-all\nmask: 1 | a rect 0.1000 0.1000 0.1000 0.1000 | one";
const read = parseImageClozeBlock(SOURCE);
if (!read.ok) throw new Error("not read");
const BLOCK = read.block;
const FENCED = ["```image-cloze", SOURCE, "```"].join("\n");

describe("replaceImageClozeBlock", () => {
    test("in a combined question only the block's lines change: the text and the comment stay byte for byte", () => {
        const note = [
            "# Heart",
            "",
            "The ==1;;left ventricle== pumps.  ",
            FENCED,
            "<!--SR:!2026-01-01,1,250,c=1!2026-01-05,5,250,id=abc,c=5-->",
            "",
            "Q::A",
        ].join("\n");
        const edited = {
            ...BLOCK,
            masks: [
                {
                    ...BLOCK.masks[0],
                    hint: "chamber",
                    fieldText: "5",
                    field: { kind: "numbers" as const, numbers: [5] },
                },
            ],
        };
        const after = replaceImageClozeBlock(note, 3, edited);
        const before = note.split("\n");
        const lines = after.split("\n");
        expect(lines.slice(0, 3)).toEqual(before.slice(0, 3));
        expect(lines.slice(-3)).toEqual(before.slice(-3));
        expect(lines[3]).toBe("```image-cloze");
        expect(after).toContain("mask: 5 | a rect 0.1000 0.1000 0.1000 0.1000 | chamber");
    });

    test("no block on that line: the note as it was", () => {
        expect(replaceImageClozeBlock("text\nmore", 0, BLOCK)).toBe("text\nmore");
    });
});

describe("locateImageClozeBlock", () => {
    test("the block on its line, else the one block with its content, else not certain", () => {
        const note = `a\n\n${FENCED}`;
        expect(locateImageClozeBlock(note, 2, BLOCK)).toBe(2);
        expect(locateImageClozeBlock(`x\n${note}`, 2, BLOCK)).toBe(3);
        expect(locateImageClozeBlock("nothing", 0, BLOCK)).toBe("not-found");
        expect(locateImageClozeBlock(`${FENCED}\n\n${FENCED}`, 9, BLOCK)).toBe("ambiguous");
    });
});

describe("imageClozeInsertion", () => {
    test("outside a card: a line of its own with a blank line before and after", () => {
        // Inserted at the end of the line: what follows is what the note already has, so one blank line each side
        const lines = ["Some text", "", "more"];
        const insert = (at: number) => {
            const { line, text } = imageClozeInsertion(lines, at, FENCED);
            return [...lines.slice(0, line), lines[line] + text, ...lines.slice(line + 1)].join(
                "\n",
            );
        };
        expect(insert(0)).toBe(`Some text\n\n${FENCED}\n\nmore`);
        expect(insert(1)).toBe(`Some text\n\n${FENCED}\n\nmore`);
        expect(insert(2)).toBe(`Some text\n\nmore\n\n${FENCED}`);
    });

    test("in a cloze paragraph: right under its last line, above its comment, so it joins that card", () => {
        const lines = [
            "The ==1;;a== pumps.",
            "More of it.",
            "<!--SR:!2026-01-01,1,250-->",
            "",
            "next",
        ];
        expect(
            imageClozeInsertion(lines, 0, FENCED, {
                clozePatterns: ["==[123;;]answer[;;hint]=="],
                latexClozes: false,
            }),
        ).toEqual({
            line: 1,
            text: `\n${FENCED}`,
            joined: true,
            paragraph: ["The ==1;;a== pumps.", "More of it.", "<!--SR:!2026-01-01,1,250-->"],
        });
    });

    test("says whether the block joined a cloze paragraph: then a plain image in it would show the answer", () => {
        const clozes = { clozePatterns: ["==[123;;]answer[;;hint]=="], latexClozes: false };
        expect(
            imageClozeInsertion(["The ==1;;a== pumps.", "![[Heart.png]]"], 1, FENCED, clozes)
                .joined,
        ).toBe(true);
        expect(
            imageClozeInsertion(["Plain text.", "![[Heart.png]]"], 1, FENCED, clozes).joined,
        ).toBe(false);
        // The paragraph the block joined, so a plain image in it is found however the picture was chosen
        expect(
            imageClozeInsertion(
                ["The ==1;;a== fills.", "![[Heart.png]]", "", "x"],
                0,
                FENCED,
                clozes,
            ).paragraph,
        ).toEqual(["The ==1;;a== fills.", "![[Heart.png]]"]);
    });

    test("in a paragraph whose only clozes are math clozes: it joins that card too (final review #1)", () => {
        const settings = { ...cloneDefaultSettings(), latexClozes: true };
        const lines = ["The $\\cloze{atrium}$ fills first.", "", "next"];
        const { line, text } = imageClozeInsertion(lines, 0, FENCED, settings);
        const note = [...lines.slice(0, line), lines[line] + text, ...lines.slice(line + 1)].join(
            "\n",
        );
        const questions = parse(note, parserOptionsFromSettings(settings));
        expect(questions.map((q) => CardType[q.cardType])).toEqual(["Cloze"]);
        expect(questions[0].text).toContain("```image-cloze");
    });
});

describe("sameCardNumbers", () => {
    test("an edit during review may not change the question's card numbers", () => {
        expect(sameCardNumbers([1, 5], [1, 5])).toBe(true);
        expect(sameCardNumbers([1, 5], [1, 2])).toBe(false);
        expect(sameCardNumbers([1, 5], [1, 5, 6])).toBe(false);
    });
});

test("imageEmbedsIn finds every image embed in a paragraph, wiki and Markdown, not plain links", () => {
    expect(
        imageEmbedsIn([
            "The ==1;;a== fills. ![[Heart.png|200]]",
            "![Heart](pics/Heart.png) and [[Note]]",
        ]),
    ).toEqual(["![[Heart.png|200]]", "![Heart](pics/Heart.png)"]);
    expect(imageEmbedsIn(["no image here", "[[Heart.png]]"])).toEqual([]);
});
