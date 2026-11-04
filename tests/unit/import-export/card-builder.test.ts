import { CardFrontBackUtil } from "src/cards/expand";
import { parse } from "src/cards/parse";
import { CardType } from "src/data/data-structures/card/question";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { CURLY_CLOZE_PATTERN } from "src/import-export/anki-cloze";
import { BasicStyle, buildCard, CardResult } from "src/import-export/card-builder";

const settings = {
    ...DEFAULT_SETTINGS,
    clozePatterns: [...DEFAULT_SETTINGS.clozePatterns, CURLY_CLOZE_PATTERN],
};

function markdown(result: CardResult): string {
    if ("skipped" in result) throw new Error(`skipped: ${result.skipped}`);
    return result.markdown;
}

const card = (kind: Parameters<typeof buildCard>[0], fields: string[], style: BasicStyle) =>
    markdown(buildCard(kind, fields, style));

describe("buildCard", () => {
    test("writes a basic note on several lines or on one", () => {
        expect(card("basic", ["Question", "Answer"], "multi")).toBe("Question\n?\nAnswer");
        expect(card("basic", ["Question", "Answer"], "single")).toBe("Question::Answer");
    });

    test("writes a reversed note with the reversed separators", () => {
        expect(card("reversed", ["gracias", "thanks"], "multi")).toBe("gracias\n??\nthanks");
        expect(card("reversed", ["gracias", "thanks"], "single")).toBe("gracias:::thanks");
    });

    test("writes a note with a line break on several lines even when one line is asked for", () => {
        expect(card("basic", ["Question", "line 1\nline 2"], "single")).toBe(
            "Question\n?\nline 1\nline 2",
        );
    });

    test("writes text with the card separator on several lines, and protects it in the front", () => {
        expect(card("basic", ["std::vector is a", "container"], "single")).toBe(
            "std:&#58;vector is a\n?\ncontainer",
        );
        // In the back the separator does no harm
        expect(card("basic", ["Question", "uses std::vector"], "multi")).toBe(
            "Question\n?\nuses std::vector",
        );
        // Inline code is not read as a separator
        expect(card("basic", ["What is `std::vector`?", "A type"], "multi")).toBe(
            "What is `std::vector`?\n?\nA type",
        );
    });

    test("writes a note on several lines when the separator and the text next to it make another separator", () => {
        // `Capital of France:` + `::` + `Paris` would read as `:::`, a reversed card
        expect(card("basic", ["Capital of France:", "Paris"], "single")).toBe(
            "Capital of France:\n?\nParis",
        );
        expect(card("basic", ["Define", ":)"], "single")).toBe("Define\n?\n:)");
        // `::::` would be cut after the first three colons, moving one to the back
        expect(card("reversed", ["Translate:", "hola"], "single")).toBe("Translate:\n??\nhola");
        // A back that starts with a colon is fine after the reversed separator, which is cut first
        expect(card("reversed", ["Smile", ":)"], "single")).toBe("Smile::::)");
    });

    test("protects a front that starts like a tag", () => {
        expect(card("basic", ["#1 rule", "Answer"], "multi")).toBe("\\#1 rule\n?\nAnswer");
    });

    test("makes the back of another note type from its other fields", () => {
        expect(card("other", ["comer", "to eat", "", "Yo como pan"], "multi")).toBe(
            "comer\n?\nto eat\n<br>\nYo como pan",
        );
    });

    test("skips notes with an empty front or back", () => {
        expect(buildCard("basic", ["", "Answer"], "multi")).toEqual({ skipped: "empty" });
        expect(buildCard("basic", ["Question", "  "], "multi")).toEqual({ skipped: "empty" });
        expect(buildCard("other", ["Question", "", ""], "multi")).toEqual({ skipped: "empty" });
        expect(buildCard("cloze", ["no deletion here"], "multi")).toEqual({ skipped: "empty" });
    });

    test("writes a cloze note in curly-bracket syntax, with its extra field after the text", () => {
        const result = buildCard("cloze", ["Yo {{c1::hablo::hablar}}", "Present"], "multi");
        expect(result).toEqual({
            markdown: "Yo {{1;;hablo;;hablar}}\n<br>\nPresent",
            clozeNeedsCurlyPattern: true,
        });
    });

    test("skips a cloze note with unbalanced braces", () => {
        expect(buildCard("cloze", ["{{c1::open"], "multi")).toEqual({ skipped: "invalid-cloze" });
    });

    test("honours custom separators", () => {
        const separators = {
            singleLine: "=>",
            singleLineReversed: "<=>",
            multiLine: "---",
            multiLineReversed: "----",
        };
        expect(markdown(buildCard("basic", ["a", "b"], "single", separators))).toBe("a=>b");
        expect(markdown(buildCard("basic", ["a=>x", "b"], "single", separators))).toBe(
            "a=&#62;x\n---\nb",
        );
        expect(markdown(buildCard("reversed", ["a", "b"], "multi", separators))).toBe("a\n----\nb");
        // `a<` + `=>` is the reversed separator `<=>`
        expect(markdown(buildCard("basic", ["a<", "b"], "single", separators))).toBe("a<\n---\nb");
        // A longer reversed separator that does not contain the basic one is protected as well
        const apart = { ...separators, singleLineReversed: "<<>>" };
        expect(markdown(buildCard("basic", ["a<<>>x", "b"], "single", apart))).toBe(
            "a<&#60;>>x\n---\nb",
        );
        expect(markdown(buildCard("basic", ["a<<>>x", "b"], "multi", apart))).toBe(
            "a<&#60;>>x\n---\nb",
        );
        // A one character separator is replaced whole
        const oneChar = { ...separators, singleLine: "=" };
        expect(markdown(buildCard("basic", ["a=x", "b"], "single", oneChar))).toBe(
            "a&#61;x\n---\nb",
        );
        // No single-line separator at all: nothing to protect, and no line is ever single-line
        const none = { ...separators, singleLine: "" };
        expect(markdown(buildCard("basic", ["a", "b"], "single", none))).toBe("a\n---\nb");
    });
});

describe("what buildCard writes is read back by the plugin's parser", () => {
    const options = {
        singleLineCardSeparator: settings.singleLineCardSeparator,
        singleLineReversedCardSeparator: settings.singleLineReversedCardSeparator,
        multilineCardSeparator: settings.multilineCardSeparator,
        multilineReversedCardSeparator: settings.multilineReversedCardSeparator,
        multilineCardEndMarker: settings.multilineCardEndMarker,
        clozePatterns: settings.clozePatterns,
    };

    function roundTrip(kind: Parameters<typeof buildCard>[0], fields: string[], style: BasicStyle) {
        const text = card(kind, fields, style) + "\n<!--anki:abc-->\n\nnext::card\n";
        const cards = parse(text, options);
        expect(cards).toHaveLength(2);
        return {
            type: cards[0].cardType,
            sides: CardFrontBackUtil.expand(cards[0].cardType, cards[0].text, settings),
        };
    }

    test.each([
        ["multi", CardType.MultiLineBasic],
        ["single", CardType.SingleLineBasic],
    ] as const)("basic, %s", (style, type) => {
        const { type: read, sides } = roundTrip("basic", ["Q **bold**", "A"], style);
        expect(read).toBe(type);
        expect(sides).toEqual([{ front: "Q **bold**", back: "A" }]);
    });

    test("reversed", () => {
        const { type, sides } = roundTrip("reversed", ["Q", "A"], "multi");
        expect(type).toBe(CardType.MultiLineReversed);
        expect(sides.map((side) => [side.front, side.back])).toEqual([
            ["Q", "A"],
            ["A", "Q"],
        ]);
    });

    test("a front that has the separator is still one multi-line card", () => {
        const { type, sides } = roundTrip("basic", ["std::vector", "A"], "single");
        expect(type).toBe(CardType.MultiLineBasic);
        expect(sides[0].back).toBe("A");
    });

    test.each([
        ["basic", ["Capital of France:", "Paris"], CardType.MultiLineBasic],
        ["basic", ["Define", ":)"], CardType.MultiLineBasic],
        ["reversed", ["Translate:", "hola"], CardType.MultiLineReversed],
        ["reversed", ["Smile", ":)"], CardType.SingleLineReversed],
    ] as const)("single-line style, %s %p", (kind, fields, type) => {
        const { type: read, sides } = roundTrip(kind, [...fields], "single");
        expect(read).toBe(type);
        expect(sides[0]).toEqual({ front: fields[0], back: fields[1] });
        expect(sides).toHaveLength(kind === "reversed" ? 2 : 1);
    });

    test("a front with a reversed separator that does not contain the basic one is still one card", () => {
        const separators = {
            singleLine: "=>",
            singleLineReversed: "<<>>",
            multiLine: "?",
            multiLineReversed: "??",
        };
        const text = markdown(buildCard("basic", ["a<<>>x", "b"], "multi", separators));
        const cards = parse(text, {
            ...options,
            singleLineCardSeparator: separators.singleLine,
            singleLineReversedCardSeparator: separators.singleLineReversed,
        });
        expect(cards.map((parsed) => parsed.cardType)).toEqual([CardType.MultiLineBasic]);
    });

    test("a card with a paragraph break stays one card", () => {
        const { type, sides } = roundTrip("other", ["Q", "para 1\n<br>\npara 2"], "multi");
        expect(type).toBe(CardType.MultiLineBasic);
        expect(sides[0].back).toBe("para 1\n<br>\npara 2");
    });

    test("cloze", () => {
        const { type, sides } = roundTrip("cloze", ["A {{c1::b}} and {{c2::c}}"], "multi");
        expect(type).toBe(CardType.Cloze);
        expect(sides).toHaveLength(2);
    });
});
