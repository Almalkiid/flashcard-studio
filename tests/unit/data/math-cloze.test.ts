/**
 * Adapted from the tests of upstream PR #1584 (ievlevpn, MIT). Added: the cases the PR did not handle,
 * that is a card that also has `==highlight==` clozes, and a macro that is not inside math.
 */
import {
    containsMathCloze,
    countMathClozes,
    expandMathClozes,
    replaceMathClozesWithAnswers,
} from "src/data/data-structures/card/questions/math-cloze";
import { CardType } from "src/data/data-structures/card/questions/question";
import {
    CardFrontBack,
    CardFrontBackUtil,
    QuestionTypeClozeFormatter,
} from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";

const formatter = new QuestionTypeClozeFormatter();
const latexSettings: SRSettings = { ...DEFAULT_SETTINGS, latexClozes: true };

// Goes through the public expand() path, to also cover the QuestionTypeCloze wiring
const expand = (text: string, settings: SRSettings = latexSettings) =>
    CardFrontBackUtil.expand(CardType.Cloze, text, settings);

describe("containsMathCloze / countMathClozes", () => {
    test.each([
        ["$\\cloze{a}{b}$", true, 1],
        ["$\\cloze {a}{b}$", true, 1],
        ["$\\cloze{a}{b} + \\cloze{c}{d}$", true, 2],
        ["plain {{a}} text", false, 0],
        ["$\\clozenot{a}{b}$", false, 0], // command boundary: \clozenot is not \cloze
        ["$\\cloze{a}$", false, 0], // no second argument
        ["$\\cloze{a}{b$", false, 0], // unclosed
        ["no math here", false, 0],
    ])("%s", (text, expected, count) => {
        expect(containsMathCloze(text)).toBe(expected);
        expect(countMathClozes(text)).toBe(count);
    });
});

describe("expand, macros only", () => {
    test("inline cloze with hint", () => {
        expect(expand("$f(x) = \\cloze{g(x)}{inner function}$")).toEqual([
            new CardFrontBack(
                "$f(x) = \\color{#2196f3}{[\\text{inner function}]}$",
                "$f(x) = \\color{#2196f3}{g(x)}$",
            ),
        ]);
    });

    test("an empty hint falls back to an ellipsis", () => {
        expect(expand("$$\\cloze{c^2}{} = a^2 + b^2$$")).toEqual([
            new CardFrontBack(
                "$$\\color{#2196f3}{[\\ldots]} = a^2 + b^2$$",
                "$$\\color{#2196f3}{c^2} = a^2 + b^2$$",
            ),
        ]);
    });

    test("several macros are sibling cards, the others show their answer", () => {
        expect(expand("$$\\cloze{a^2}{} + \\cloze{b^2}{} = c^2$$")).toEqual([
            new CardFrontBack(
                "$$\\color{#2196f3}{[\\ldots]} + b^2 = c^2$$",
                "$$\\color{#2196f3}{a^2} + b^2 = c^2$$",
            ),
            new CardFrontBack(
                "$$a^2 + \\color{#2196f3}{[\\ldots]} = c^2$$",
                "$$a^2 + \\color{#2196f3}{b^2} = c^2$$",
            ),
        ]);
    });

    test("nested braces", () => {
        expect(expand("$$\\cloze{e^{x^{2}}}{} = 1$$")).toEqual([
            new CardFrontBack(
                "$$\\color{#2196f3}{[\\ldots]} = 1$$",
                "$$\\color{#2196f3}{e^{x^{2}}} = 1$$",
            ),
        ]);
    });

    test("a fraction with a root as its last argument", () => {
        expect(expand("$x = \\cloze{\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}}{}$")).toEqual([
            new CardFrontBack(
                "$x = \\color{#2196f3}{[\\ldots]}$",
                "$x = \\color{#2196f3}{\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}}$",
            ),
        ]);
    });

    test("escaped braces in the answer", () => {
        expect(expand("$S = \\cloze{\\{x : x > 0\\}}{a set}$")).toEqual([
            new CardFrontBack(
                "$S = \\color{#2196f3}{[\\text{a set}]}$",
                "$S = \\color{#2196f3}{\\{x : x > 0\\}}$",
            ),
        ]);
    });

    test("a `$$` in the answer is kept", () => {
        expect(expand("$\\cloze{$$}{}$")[0].back).toBe("$\\color{#2196f3}{$$}$");
    });

    test("malformed macros make no cards", () => {
        expect(expandMathClozes("$\\cloze{a}$", formatter)).toEqual([]);
        expect(expandMathClozes("$\\clozenot{a}{b}$", formatter)).toEqual([]);
        expect(expandMathClozes("$\\cloze{a}{b$", formatter)).toEqual([]);
    });

    test("the setting off: a macro is plain text", () => {
        expect(expand("$\\cloze{a}{b}$", DEFAULT_SETTINGS)).toEqual([]);
    });
});

describe("expand, macros together with other clozes", () => {
    test("a highlight in the same paragraph is still a cloze card, and comes first", () => {
        const cards = expand("$\\cloze{x^2}{}$ is the ==square==");

        expect(cards).toEqual([
            new CardFrontBack(
                `$x^2$ is the ${formatter.asking()}`,
                `$x^2$ is the ${formatter.showingAnswer("square")}`,
            ),
            new CardFrontBack(
                "$\\color{#2196f3}{[\\ldots]}$ is the square",
                "$\\color{#2196f3}{x^2}$ is the square",
            ),
        ]);
    });

    test("with several clozes of both kinds, every cloze makes exactly one card", () => {
        const cards = expand("==a== and $\\cloze{b}{}$ and ==c== and $\\cloze{d}{}$");

        expect(cards).toHaveLength(4);
        expect(cards[0].front).toContain(formatter.asking());
        expect(cards[1].front).toContain(formatter.asking());
        expect(cards[2].front).toContain("\\color");
        expect(cards[3].front).toContain("\\color");
        // A macro's card shows the highlights as plain text, not as clozes
        expect(cards[2].front).toBe("a and $\\color{#2196f3}{[\\ldots]}$ and c and $d$");
    });

    test("a `$$` inside a highlight cloze next to a macro is kept", () => {
        const cards = expand("==$$ x $$== and $\\cloze{y}{}$");

        expect(cards[0].back).toBe(`${formatter.showingAnswer("$$ x $$")} and $y$`);
    });

    test("a paragraph without a macro is untouched by the setting", () => {
        const text = "A ==b== and ==c==";

        expect(expand(text)).toEqual(expand(text, DEFAULT_SETTINGS));
    });
});

describe("a macro that is not inside math", () => {
    test("is drawn like an ordinary cloze, not with \\color", () => {
        expect(expandMathClozes("Fill in \\cloze{this}{a hint} here", formatter)).toEqual([
            {
                front: `Fill in ${formatter.asking("this", "a hint")} here`,
                back: `Fill in ${formatter.showingAnswer("this", "a hint")} here`,
            },
        ]);
    });

    test("a macro after a dollar amount in plain text is not math", () => {
        const [card] = expandMathClozes("It costs \\$5 and \\cloze{x}{}", formatter);

        expect(card.front).toBe(`It costs \\$5 and ${formatter.asking("x")}`);
    });

    test("a macro in a code span is not in math, but math after the span is", () => {
        const [card] = expandMathClozes("`$` then $\\cloze{x}{}$", formatter);

        expect(card.front).toBe("`$` then $\\color{#2196f3}{[\\ldots]}$");
    });

    test("a macro in $$ display math over several lines is in math", () => {
        const [card] = expandMathClozes("$$\na = \n\\cloze{b}{}\n$$", formatter);

        expect(card.front).toBe("$$\na = \n\\color{#2196f3}{[\\ldots]}\n$$");
    });
});

describe("replaceMathClozesWithAnswers", () => {
    test("shows the answers", () => {
        expect(replaceMathClozesWithAnswers("$\\cloze{a}{h} + \\cloze{b^{2}}{}$")).toBe(
            "$a + b^{2}$",
        );
    });

    test("returns text without macros unchanged", () => {
        expect(replaceMathClozesWithAnswers("nothing $x$ here")).toBe("nothing $x$ here");
    });
});
