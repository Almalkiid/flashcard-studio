import { CardFrontBackUtil } from "src/cards/expand";
import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { joinCardText, splitCardText } from "src/ui/obsidian-ui-components/modals/card-text-split";

const settings: StudioSettings = cloneDefaultSettings();

/** What the edit dialog did before: cut at every separator and keep the first two pieces. */
function oldSplit(text: string, separator: string): [string, string] {
    const parts = text.split(separator);
    return [parts[0], parts[1] ?? ""];
}

const SINGLE_LINE = [
    ["std::vector::push", CardType.SingleLineBasic],
    ["What is a ::: b? :::: c", CardType.SingleLineReversed],
    ["Plain :: card", CardType.SingleLineBasic],
    ["Time:: 12:30::45", CardType.SingleLineBasic],
] as const;

const MULTI_LINE = [
    ["Is it?\n?\nYes", CardType.MultiLineBasic],
    ["Why?\nIs this ok?\n?\nBecause it works?\nReally?", CardType.MultiLineBasic],
    ["Front\n\n?\n\nBack\n\nmore", CardType.MultiLineBasic],
    ["A??\n??\nB??", CardType.MultiLineReversed],
    ["What?\n  ?  \nanswer\n?\nnot a separator", CardType.MultiLineBasic],
    // Indentation is markdown: an indented code block, a card nested in a list
    ["How to print?\n?\n    print('hi')\n    more", CardType.MultiLineBasic],
    ["- Capital of France\n  ?\n  Paris", CardType.MultiLineBasic],
    ["- Main topic\n  ?\n  - sub a\n    - sub b", CardType.MultiLineBasic],
    ["Front\n  \n\t?\n \n\tBack", CardType.MultiLineBasic],
] as const;

/** A side of a multi-line card as the parser reads it, without the blank lines next to the separator. */
const withoutBlankLinesAfter = (front: string) => front.replace(/(?:\n[ \t]*)+$/, "");
const withoutBlankLinesBefore = (back: string) => back.replace(/^(?:[ \t]*\n)+/, "");

describe("the edit dialog cuts a card where the parser does", () => {
    test.each([...SINGLE_LINE, ...MULTI_LINE])(
        "%j has the sides the parser reads",
        (text, type) => {
            const sides = splitCardText(type, text, settings);
            expect(sides).not.toBeNull();
            const [parsed] = CardFrontBackUtil.expand(type, text, settings);
            const multi = type === CardType.MultiLineBasic || type === CardType.MultiLineReversed;
            expect(sides?.front).toBe(multi ? withoutBlankLinesAfter(parsed.front) : parsed.front);
            expect(sides?.back).toBe(multi ? withoutBlankLinesBefore(parsed.back) : parsed.back);
        },
    );

    // Saving without a change rewrote the note: the first answer line and the separator line lost their indentation,
    // which broke an indented code block and moved a card nested in a list out of its list item
    test.each([...SINGLE_LINE, ...MULTI_LINE])("%j is saved byte for byte", (text, type) => {
        const sides = splitCardText(type, text, settings);
        const saved = joinCardText(type, sides, settings);
        expect(saved).toBe(text);
        expect(splitCardText(type, saved, settings)).toEqual(sides);
    });

    test("an edited side keeps the indentation of the other side and of the separator line", () => {
        const text = "- Capital of France\n  ?\n  Paris";
        const sides = splitCardText(CardType.MultiLineBasic, text, settings);
        expect(sides).toEqual({ front: "- Capital of France", back: "  Paris", between: "  ?" });
        const edited = { ...sides, front: "- Capital of Italy" };
        expect(joinCardText(CardType.MultiLineBasic, edited, settings)).toBe(
            "- Capital of Italy\n  ?\n  Paris",
        );
    });

    test("an indented code block answer keeps its first line in the code block", () => {
        const text = "How to print?\n?\n    print('hi')\n    more";
        const sides = splitCardText(CardType.MultiLineBasic, text, settings);
        expect(sides?.back).toBe("    print('hi')\n    more");
    });

    test("a single-line card is saved byte for byte", () => {
        const text = "std::vector::push";
        const sides = splitCardText(CardType.SingleLineBasic, text, settings);
        expect(sides).toEqual({ front: "std", back: "vector::push" });
        expect(joinCardText(CardType.SingleLineBasic, sides, settings)).toBe(text);
    });

    test("a multi-line answer with a question mark keeps it (the old way truncated the card)", () => {
        const text = "Is it?\n?\nYes";
        const [oldFront, oldBack] = oldSplit(text, settings.multilineCardSeparator);
        // The substring cut finds the "?" in "Is it?" first: the front is "Is it" and the back is empty
        expect([oldFront, oldBack]).toEqual(["Is it", "\n"]);

        const sides = splitCardText(CardType.MultiLineBasic, text, settings);
        expect(sides).toEqual({ front: "Is it?", back: "Yes", between: "?" });
        expect(joinCardText(CardType.MultiLineBasic, sides, settings)).toBe(text);
    });

    test("a card without a separator is edited as one text", () => {
        for (const type of [CardType.Cloze, CardType.Callout, CardType.ImageOcclusion]) {
            expect(splitCardText(type, "Some {{c1::text}}", settings)).toBeNull();
        }
        // A basic card whose separator was deleted from the note has nothing to cut at either
        expect(splitCardText(CardType.SingleLineBasic, "no separator here", settings)).toBeNull();
        expect(splitCardText(CardType.MultiLineBasic, "one\ntwo", settings)).toBeNull();
    });
});
