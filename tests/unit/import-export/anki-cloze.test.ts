import { ClozeCrafter } from "clozecraft";

import { CardType } from "src/data/data-structures/card/questions/question";
import {
    convertAnkiClozes,
    CURLY_CLOZE_PATTERN,
    ensureCurlyClozePattern,
    hasAnkiCloze,
} from "src/import-export/anki-cloze";
import { parse } from "src/parser";

describe("hasAnkiCloze", () => {
    test("recognises Anki cloze syntax only", () => {
        expect(hasAnkiCloze("a {{c1::b}} c")).toBe(true);
        expect(hasAnkiCloze("a {{c1,2::b}} c")).toBe(true);
        expect(hasAnkiCloze("a {{1;;b}} c")).toBe(false);
        expect(hasAnkiCloze("a {b} c")).toBe(false);
    });
});

describe("convertAnkiClozes", () => {
    test("converts numbered clozes with and without hints", () => {
        expect(convertAnkiClozes("{{c1::Canberra}} was founded in {{c2::1913::year}}.")).toBe(
            "{{1;;Canberra}} was founded in {{2;;1913;;year}}.",
        );
    });

    test("keeps repeated numbers on one card", () => {
        expect(convertAnkiClozes("{{c1::A}} and {{c1::B}}")).toBe("{{1;;A}} and {{1;;B}}");
    });

    test("takes everything after the first :: as the hint", () => {
        expect(convertAnkiClozes("{{c1::std::vector}}")).toBe("{{1;;std;;vector}}");
    });

    test("writes clozes with several numbers as overlapping clozes", () => {
        expect(convertAnkiClozes("{{c1::-te}}, {{c2::-sion}} are {{c1,2,3::feminine}}.")).toBe(
            "{{a;;-te}}, {{sa;;-sion}} are {{aaa;;feminine}}.",
        );
    });

    test("splits nested clozes into clozes that are hidden on the numbers of all their parents", () => {
        expect(convertAnkiClozes("{{c1::Canberra was {{c2::founded}}}} in 1913")).toBe(
            "{{a;;Canberra was }}{{aa;;founded}} in 1913",
        );
    });

    test("leaves text without a cloze, with unbalanced braces, and empty clozes", () => {
        expect(convertAnkiClozes("plain text")).toBeNull();
        expect(convertAnkiClozes("{{c1::open")).toBeNull();
        expect(convertAnkiClozes("x {{c1::}} y")).toBe("x  y");
    });

    test("the converted text is read as a cloze card by the parser, the original is not", () => {
        const options = {
            singleLineCardSeparator: "::",
            singleLineReversedCardSeparator: ":::",
            multilineCardSeparator: "?",
            multilineReversedCardSeparator: "??",
            multilineCardEndMarker: "",
            clozePatterns: [CURLY_CLOZE_PATTERN],
        };
        const original = "{{c1::Canberra}} was founded in {{c2::1913}}.";
        expect(parse(original, options)[0].cardType).toBe(CardType.SingleLineBasic);

        const converted = convertAnkiClozes(original);
        expect(parse(converted, options)[0].cardType).toBe(CardType.Cloze);
        const note = new ClozeCrafter(options.clozePatterns).createClozeNote(converted);
        expect(note?.numCards).toBe(2);
        expect(note?.getCardFront(0)).toBe("[...] was founded in 1913.");
        expect(note?.getCardFront(1)).toBe("Canberra was founded in [...].");
    });

    test("an overlapping cloze gives one card per number", () => {
        const converted = convertAnkiClozes("{{c1::A}} {{c2::B}} {{c1,2::C}}");
        const note = new ClozeCrafter([CURLY_CLOZE_PATTERN]).createClozeNote(converted);
        expect(note?.numCards).toBe(2);
        expect(note?.getCardFront(0)).toBe("[...] B [...]");
        expect(note?.getCardFront(1)).toBe("A [...] [...]");
    });
});

describe("ensureCurlyClozePattern", () => {
    test("adds the pattern and turns the toggle on, once", () => {
        const settings = {
            clozePatterns: ["==[123;;]answer[;;hint]=="],
            convertCurlyBracketsToClozes: false,
        };
        expect(ensureCurlyClozePattern(settings)).toBe(true);
        expect(settings).toEqual({
            clozePatterns: ["==[123;;]answer[;;hint]==", CURLY_CLOZE_PATTERN],
            convertCurlyBracketsToClozes: true,
        });
        expect(ensureCurlyClozePattern(settings)).toBe(false);
        expect(settings.clozePatterns).toHaveLength(2);
    });
});
