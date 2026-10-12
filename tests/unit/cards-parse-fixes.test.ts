import { CardFrontBackUtil } from "src/cards/expand";
import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings } from "src/data/settings-model";

const options = parserOptionsFromSettings(cloneDefaultSettings());
const texts = (input: string) => parse(input, options).map((card) => card.text);

describe("parse fixes (behaviour inventory section 15)", () => {
    test("item 6: a separator on the first line of a paragraph makes no card with an empty front", () => {
        expect(texts("??\nA")).toEqual([]);
        expect(texts("?\nA")).toEqual([]);
        expect(texts("x::y\n\n??\nA")).toEqual(["x::y"]);
        expect(texts("a:::b\n??\nc")).toEqual(["a:::b"]);
        expect(texts("  ??\nA")).toEqual([]);
    });

    test("item 6: a real multi-line card is unchanged", () => {
        expect(texts("Q\n??\nA")).toEqual(["Q\n??\nA"]);
        expect(texts("Q\n?\nA")).toEqual(["Q\n?\nA"]);
    });

    test("item 13: a metadata callout without a comment does not swallow the rest of the note", () => {
        const cards = parse("Q::A\n> [!sr|card-metadata]\n> x\n\nlater::card", options);
        expect(cards.map((card) => [card.text, card.firstLineNum, card.lastLineNum])).toEqual([
            ["Q::A", 0, 0],
            ["later::card", 4, 4],
        ]);
    });

    test("item 13: a metadata callout with its comment is still picked up", () => {
        const input = "Q::A\n> [!sr|card-metadata]\n> <!--SR:!2026-01-01,3,250-->\n\nlater::card";
        expect(texts(input)).toEqual([
            "Q::A\n> [!sr|card-metadata]\n> <!--SR:!2026-01-01,3,250-->",
            "later::card",
        ]);
    });
});

describe("expand keeps the lenient split of a single-line card edited to lack its separator", () => {
    test("front is empty when the separator is missing", () => {
        const sides = CardFrontBackUtil.expand(
            CardType.SingleLineBasic,
            "no separator here",
            cloneDefaultSettings(),
        );
        expect(sides[0].front).toBe("");
    });
});
