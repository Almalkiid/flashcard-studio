/**
 * Regression tests for the patched clozecraft dependency (patches/clozecraft.patch).
 *
 * clozecraft 0.4.0 built card fronts/backs with String.replace(raw, replacementString). JavaScript
 * gives `$$`, `$&`, `` $` ``, `$'` and `$1` a special meaning in a replacement STRING, so an answer
 * such as `$$ x $$` lost a `$` and `$&` was replaced by the matched text. The patch passes replacer
 * functions instead, which are never interpreted.
 */
import { ClozeCrafter } from "clozecraft";

import { CardType } from "src/data/data-structures/card/questions/question";
import {
    CardFrontBackUtil,
    QuestionTypeClozeFormatter,
} from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

const formatter = new QuestionTypeClozeFormatter();

function expandCloze(text: string, settings: SRSettings = DEFAULT_SETTINGS) {
    return CardFrontBackUtil.expand(CardType.Cloze, text, settings);
}

describe("clozecraft: `$` sequences in cloze answers are kept literally", () => {
    const answers: [string, string][] = [
        ["display math delimiters", "$$ x^2 $$"],
        ["inline math with braces", "$\\frac{a}{b}$"],
        ["nested braces", "$\\frac{\\vec{v}}{\\vec{u}}$"],
        ["$& (matched text)", "cost $& tax"],
        ["$` (text before)", "a $` b"],
        ["$' (text after)", "a $' b"],
        ["$1 (capture group)", "price $1 and $2"],
        ["a lone dollar", "US$"],
        ["dollar before the closing delimiter", "$5$"],
    ];

    test.each(answers)("%s", (_name, answer) => {
        const cards = expandCloze(`Before ==${answer}== after`);

        expect(cards).toHaveLength(1);
        expect(cards[0].front).toBe(`Before ${formatter.asking()} after`);
        expect(cards[0].back).toBe(`Before ${formatter.showingAnswer(answer)} after`);
    });

    test("an answer with `$$` is shown intact on the sibling card", () => {
        const cards = expandCloze("==$$ a $$== and ==b==");

        expect(cards).toHaveLength(2);
        // Card 1 asks for the math, card 2 shows it as plain text
        expect(cards[1].front).toBe(`$$ a $$ and ${formatter.asking()}`);
        expect(cards[1].back).toBe(`$$ a $$ and ${formatter.showingAnswer("b")}`);
        expect(cards[0].back).toBe(`${formatter.showingAnswer("$$ a $$")} and b`);
    });

    test("a hint containing `$$` survives", () => {
        const cards = expandCloze("==answer;;cost $$ hint==");

        expect(cards[0].front).toBe(formatter.asking("answer", "cost $$ hint"));
    });

    test("the answer of a numbered (classic) cloze keeps `$$`", () => {
        const settings: SRSettings = {
            ...DEFAULT_SETTINGS,
            clozePatterns: ["==[123;;]answer[;;hint]=="],
        };
        const cards = expandCloze("==1;;$$ x $$== and ==1;;$& y==", settings);

        expect(cards).toHaveLength(1);
        expect(cards[0].back).toBe(
            `${formatter.showingAnswer("$$ x $$")} and ${formatter.showingAnswer("$& y")}`,
        );
    });

    test("the answer of an overlapping (OL) cloze keeps `$$`", () => {
        // Overlapping clozes use a footnote-style sequence, here `[^a]` (ask) and `[^sa]` (show, ask)
        const crafter = new ClozeCrafter(["==answer==[^\\[hint\\]][\\[^123\\]]"]);
        const note = crafter.createClozeNote("A ==$$ x $$==[^a] then ==$&==[^sa]");

        expect(note).not.toBeNull();
        expect(note.getCardBack(0, formatter)).toBe(
            `A ${formatter.showingAnswer("$$ x $$")} then $&`,
        );
    });

    test("text outside the cloze that contains `$$` is untouched", () => {
        const cards = expandCloze("Given $$ a = b $$ find ==the value==");

        expect(cards[0].front).toBe(`Given $$ a = b $$ find ${formatter.asking()}`);
        expect(cards[0].back).toBe(
            `Given $$ a = b $$ find ${formatter.showingAnswer("the value")}`,
        );
    });
});
