/**
 * Tests for the M3b card syntaxes: card regions (start marker), callout cards, atomic clozes and
 * `\cloze{}{}`, and for what the pre-existing end marker does. Backward compatibility of the default
 * settings is covered by parser-compat-baseline.test.ts.
 *
 * The region tests adapt the test cases of upstream PR #1652 (xiang2x, MIT) and the tests of #797
 * (Stefanuk12, MIT) and #1631 (Rainbow-prince, MIT).
 */
import { CardType } from "src/data/data-structures/card/questions/question";
import { parse, ParsedQuestionInfo, ParserOptions } from "src/parser";

const base: ParserOptions = {
    singleLineCardSeparator: "::",
    singleLineReversedCardSeparator: ":::",
    multilineCardSeparator: "?",
    multilineReversedCardSeparator: "??",
    multilineCardEndMarker: "",
    clozePatterns: ["==[123;;]answer[;;hint]=="],
};

function parseT(text: string, options: ParserOptions): [CardType, string, number, number][] {
    return parse(text, options).map((item: ParsedQuestionInfo) => [
        item.cardType,
        item.text,
        item.firstLineNum,
        item.lastLineNum,
    ]);
}

describe("multiline card end marker (what it did before M3b, and still does)", () => {
    const endMarker: ParserOptions = { ...base, multilineCardEndMarker: "+++" };

    test("blank lines in the ANSWER of a multiline card are kept", () => {
        expect(
            parseT("Q\n?\nAnswer 1\n\nAnswer 2\n\n| a | b |\n|---|---|\n+++", endMarker),
        ).toEqual([
            [CardType.MultiLineBasic, "Q\n?\nAnswer 1\n\nAnswer 2\n\n| a | b |\n|---|---|", 0, 7],
        ]);
    });

    test("without an end marker a blank line ends the card", () => {
        expect(parseT("Q\n?\nAnswer 1\n\nAnswer 2", base)).toEqual([
            [CardType.MultiLineBasic, "Q\n?\nAnswer 1", 0, 2],
        ]);
    });

    test("a blank line in the QUESTION still restarts the card: the first paragraph is lost", () => {
        expect(parseT("Paragraph 1\n\nParagraph 2\n?\nA\n+++", endMarker)).toEqual([
            [CardType.MultiLineBasic, "Paragraph 2\n?\nA", 2, 4],
        ]);
    });

    test("a cloze card runs to the end marker, blank lines included", () => {
        expect(parseT("A ==b==\n\nmore text\n+++\nplain", endMarker)).toEqual([
            [CardType.Cloze, "A ==b==\n\nmore text", 0, 2],
        ]);
    });

    test("an inline card needs no end marker", () => {
        expect(parseT("Q::A\n\nQ2::A2\n", endMarker)).toEqual([
            [CardType.SingleLineBasic, "Q::A", 0, 0],
            [CardType.SingleLineBasic, "Q2::A2", 2, 2],
        ]);
    });
});

describe("a card ends at its scheduling comment when an end marker is set (issue #1402)", () => {
    const endMarker: ParserOptions = { ...base, multilineCardEndMarker: "+++" };
    const sr1 = "<!--SR:!2021-08-11,4,270-->";
    const sr2 = "<!--SR:!2021-08-12,5,250-->";

    test("two scheduled cards without markers stay two cards, each with its own schedule", () => {
        const text = `Q1\n?\nA1\n${sr1}\n\nQ2\n?\nA2\n${sr2}\n`;

        expect(parseT(text, endMarker)).toEqual([
            [CardType.MultiLineBasic, `Q1\n?\nA1\n${sr1}`, 0, 3],
            [CardType.MultiLineBasic, `Q2\n?\nA2\n${sr2}`, 5, 8],
        ]);
    });

    test("scheduled cloze paragraphs stay separate", () => {
        const text = `One ==a==\n${sr1}\n\nTwo ==b==\n${sr2}`;

        expect(parseT(text, endMarker).map((c) => c[1])).toEqual([
            `One ==a==\n${sr1}`,
            `Two ==b==\n${sr2}`,
        ]);
    });

    test("a comment on the same line as the last text also ends the card", () => {
        const text = `Q1\n?\nA1 ${sr1}\n\nQ2\n?\nA2 ${sr2}`;

        expect(parseT(text, endMarker).map((c) => c[1])).toEqual([
            `Q1\n?\nA1 ${sr1}`,
            `Q2\n?\nA2 ${sr2}`,
        ]);
    });

    test("a comment followed by a block identifier ends the card", () => {
        const text = `Q1\n?\nA1 ${sr1} ^abc\n\nQ2\n?\nA2`;

        expect(parseT(text, endMarker).map((c) => c[1])).toEqual([
            `Q1\n?\nA1 ${sr1} ^abc`,
            "Q2\n?\nA2",
        ]);
    });

    test("blank lines before the comment are still part of the answer", () => {
        const text = `Q\n?\nA1\n\nA2\n${sr1}\n+++`;

        expect(parseT(text, endMarker)).toEqual([
            [CardType.MultiLineBasic, `Q\n?\nA1\n\nA2\n${sr1}`, 0, 5],
        ]);
    });

    test("without an end marker nothing changes", () => {
        const text = `Q1\n?\nA1\n${sr1}\n\nQ2\n?\nA2\n${sr2}`;

        expect(parseT(text, base).map((c) => c[1])).toEqual([
            `Q1\n?\nA1\n${sr1}`,
            `Q2\n?\nA2\n${sr2}`,
        ]);
    });
});

describe("card regions (start marker)", () => {
    // Adapted from upstream PR #1652
    const startEnd: ParserOptions = {
        ...base,
        multilineCardStartMarker: "+++",
        multilineCardEndMarker: "+++",
    };

    test("a cloze with a table and blank lines keeps its whole context", () => {
        expect(
            parseT(
                "+++\nhelp sb (to) do sth\n\n| verb | pattern | example |\n| ---- | ------- | ------- |\n| help | to optional | help me (to) write |\n\n> Can you ==help me (to) write== a newspaper ad?\n+++",
                startEnd,
            ),
        ).toEqual([
            [
                CardType.Cloze,
                "help sb (to) do sth\n\n| verb | pattern | example |\n| ---- | ------- | ------- |\n| help | to optional | help me (to) write |\n\n> Can you ==help me (to) write== a newspaper ad?",
                1,
                7,
            ],
        ]);
    });

    test("a multiline card can have blank lines and a table on the QUESTION side", () => {
        expect(
            parseT(
                "+++\nPatterns:\n\n| verb | pattern |\n| ---- | ------- |\n| help | help sb (to) do |\n\nPrompt: Can you ______ a newspaper ad?\n?\nCan you help me (to) write a newspaper ad?\n+++",
                startEnd,
            ),
        ).toEqual([
            [
                CardType.MultiLineBasic,
                "Patterns:\n\n| verb | pattern |\n| ---- | ------- |\n| help | help sb (to) do |\n\nPrompt: Can you ______ a newspaper ad?\n?\nCan you help me (to) write a newspaper ad?",
                1,
                9,
            ],
        ]);
    });

    test("two consecutive regions are two cards", () => {
        expect(
            parseT("+++\nFirst ==cloze== here\n+++\n\n+++\nSecond ==cloze== here\n+++", startEnd),
        ).toEqual([
            [CardType.Cloze, "First ==cloze== here", 1, 1],
            [CardType.Cloze, "Second ==cloze== here", 5, 5],
        ]);
    });

    test("a region without a card in it is not a card", () => {
        expect(parseT("+++\njust some prose\n\nwith blank lines\n+++", startEnd)).toEqual([]);
    });

    test("different start and end markers; a start marker inside a region closes it and opens the next", () => {
        const different: ParserOptions = {
            ...startEnd,
            multilineCardStartMarker: "<<<",
            multilineCardEndMarker: ">>>",
        };

        expect(
            parseT(
                "<<<\nContext\n\n==cloze one==\n<<<\nContext two\n\n==cloze two==\n>>>",
                different,
            ),
        ).toEqual([
            [CardType.Cloze, "Context\n\n==cloze one==", 1, 3],
            [CardType.Cloze, "Context two\n\n==cloze two==", 5, 7],
        ]);
    });

    test("with no start marker the blank-line rules are the old ones", () => {
        expect(
            parseT(
                "help sb (to) do sth\n\n| verb | pattern |\n| ---- | ------- |\n\n> Can you ==help me== write?\n+++",
                { ...startEnd, multilineCardStartMarker: "" },
            ),
        ).toEqual([[CardType.Cloze, "> Can you ==help me== write?", 5, 5]]);
    });

    test("outside a region inline cards are found, and clozes and multiline cards are not", () => {
        expect(
            parseT(
                "Outside::still works\n\nIgnored ==cloze== outside\n\nQ\n?\nA\n\n+++\nInside ==cloze== kept\n+++",
                startEnd,
            ),
        ).toEqual([
            [CardType.SingleLineBasic, "Outside::still works", 0, 0],
            [CardType.Cloze, "Inside ==cloze== kept", 9, 9],
        ]);
    });

    test("a region that is never closed runs to the end of the note", () => {
        expect(parseT("+++\nQ\n\nmore question\n?\nA1\n\nA2", startEnd)).toEqual([
            [CardType.MultiLineBasic, "Q\n\nmore question\n?\nA1\n\nA2", 1, 7],
        ]);
    });

    test("blank lines at the edges of a region are not part of the card", () => {
        // (As with an end marker before, the last line number is the line above the marker)
        expect(parseT("+++\n\n\nA ==b==\n\n\n+++", startEnd)).toEqual([
            [CardType.Cloze, "A ==b==", 3, 5],
        ]);
    });

    test("an end marker can be used on its own line only", () => {
        expect(parseT("+++\nA ==b== +++ c\n+++", startEnd)).toEqual([
            [CardType.Cloze, "A ==b== +++ c", 1, 1],
        ]);
    });

    test("a code block in a region keeps its blank lines and its lookalikes", () => {
        expect(
            parseT("+++\nWhat prints?\n\n```py\nprint(1)\n\nx = a::b\n```\n?\n1\n+++", startEnd),
        ).toEqual([
            [
                CardType.MultiLineBasic,
                "What prints?\n\n```py\nprint(1)\n\nx = a::b\n```\n?\n1",
                1,
                9,
            ],
        ]);
    });

    test("the scheduling comment of a card in a region is part of the card", () => {
        const sr = "<!--SR:!2021-08-11,4,270-->";
        expect(parseT(`+++\nQ\n\nmore\n?\nA\n${sr}\n+++`, startEnd)).toEqual([
            [CardType.MultiLineBasic, `Q\n\nmore\n?\nA\n${sr}`, 1, 6],
        ]);
    });

    test("a multiline card without an answer is dropped, as ever", () => {
        expect(parseT("+++\nQ\n\n?\n\n+++", startEnd)).toEqual([]);
    });

    test("a start marker only line is not the end of a card when it differs from the end marker", () => {
        const startOnly: ParserOptions = { ...base, multilineCardStartMarker: "@@@" };

        expect(parseT("@@@\nQ ==a==\n\nmore\n@@@\nX ==y==", startOnly)).toEqual([
            [CardType.Cloze, "Q ==a==\n\nmore", 1, 3],
            [CardType.Cloze, "X ==y==", 5, 5],
        ]);
    });

    test("a marker may itself be an HTML comment", () => {
        const comment: ParserOptions = {
            ...base,
            multilineCardStartMarker: "<!--card-->",
            multilineCardEndMarker: "<!--/card-->",
        };

        expect(parseT("<!--card-->\nA ==b==\n\nc\n<!--/card-->", comment)).toEqual([
            [CardType.Cloze, "A ==b==\n\nc", 1, 3],
        ]);
    });

    test("callout cards need no region", () => {
        const withCallouts: ParserOptions = { ...startEnd, calloutCardTypes: ["question"] };

        expect(parseT("> [!question] Q\n> A\n\n+++\nX ==y==\n\nz\n+++", withCallouts)).toEqual([
            [CardType.Callout, "> [!question] Q\n> A", 0, 1],
            [CardType.Cloze, "X ==y==\n\nz", 4, 6],
        ]);
    });
});

describe("callout cards", () => {
    const callouts: ParserOptions = {
        ...base,
        calloutCardTypes: ["flashcard", "question", "card"],
    };

    test("the title is the front and the body the back", () => {
        expect(parseT("> [!question] What is X?\n> It is Y.", callouts)).toEqual([
            [CardType.Callout, "> [!question] What is X?\n> It is Y.", 0, 1],
        ]);
    });

    test.each(["flashcard", "question", "card", "QUESTION", "Card"])("type %s", (type) => {
        expect(parseT(`> [!${type}] T\n> B`, callouts)).toHaveLength(1);
    });

    test("other types are not cards", () => {
        expect(parseT("> [!note] T\n> B\n\n> [!tip] T\n> B", callouts)).toEqual([]);
    });

    test.each(["-", "+"])("a fold marker %s is allowed", (fold) => {
        expect(parseT(`> [!question]${fold} What is X?\n> Y`, callouts)).toEqual([
            [CardType.Callout, `> [!question]${fold} What is X?\n> Y`, 0, 1],
        ]);
    });

    test("callouts are cards only for the configured types", () => {
        const onlyCard: ParserOptions = { ...base, calloutCardTypes: ["card"] };

        expect(parseT("> [!question] T\n> B\n\n> [!card] T2\n> B2", onlyCard)).toEqual([
            [CardType.Callout, "> [!card] T2\n> B2", 3, 4],
        ]);
    });

    test("an empty list, or no list, turns callout cards off", () => {
        expect(parseT("> [!question] T\n> B", { ...base, calloutCardTypes: [] })).toEqual([]);
        expect(parseT("> [!question] T\n> B", base)).toEqual([]);
    });

    test("type names are matched however the user typed them", () => {
        const sloppy: ParserOptions = { ...base, calloutCardTypes: [" [!Question] ", "", "CARD"] };

        expect(parseT("> [!question] T\n> B\n\n> [!card] T2\n> B2", sloppy)).toHaveLength(2);
    });

    test("the schedule comment on the line after the callout belongs to the card", () => {
        const text = "> [!question]- T\n> B\n<!--SR:!2021-08-11,4,270-->\n\nother::card";

        expect(parseT(text, callouts)).toEqual([
            [CardType.Callout, "> [!question]- T\n> B\n<!--SR:!2021-08-11,4,270-->", 0, 2],
            [CardType.SingleLineBasic, "other::card", 4, 4],
        ]);
    });

    test("the body may have several lines, blank quote lines and nested callouts", () => {
        const text =
            "> [!question] T\n> line 1\n>\n> line 2\n> > [!note] nested\n> > inside\n\nnext ==c==";

        expect(parseT(text, callouts)).toEqual([
            [
                CardType.Callout,
                "> [!question] T\n> line 1\n>\n> line 2\n> > [!note] nested\n> > inside",
                0,
                5,
            ],
            [CardType.Cloze, "next ==c==", 7, 7],
        ]);
    });

    test("a callout directly after a heading or after text is a card", () => {
        expect(parseT("## Topic\n> [!question] T\n> B", callouts)).toEqual([
            [CardType.Callout, "> [!question] T\n> B", 1, 2],
        ]);
        expect(parseT("Some prose\n> [!card] T\n> B", callouts)).toEqual([
            [CardType.Callout, "> [!card] T\n> B", 1, 2],
        ]);
    });

    test("a callout right after an inline card, or after another callout card, is a card", () => {
        expect(parseT("Q::A\n> [!card] T\n> B\n\n> [!card] T2\n> B2", callouts)).toEqual([
            [CardType.SingleLineBasic, "Q::A", 0, 0],
            [CardType.Callout, "> [!card] T\n> B", 1, 2],
            [CardType.Callout, "> [!card] T2\n> B2", 4, 5],
        ]);
    });

    test("a callout without a title, or without a body, is not a card", () => {
        expect(parseT("> [!question]\n> B", callouts)).toEqual([]);
        expect(parseT("> [!question] T", callouts)).toEqual([]);
        expect(parseT("> [!question] T\n>\n> ", callouts)).toEqual([]);
    });

    test("an indented callout (a list item, a code block) is not a card", () => {
        expect(parseT("    > [!question] T\n    > B", callouts)).toEqual([]);
        expect(parseT("- > [!question] T\n  > B", callouts)).toEqual([]);
    });

    test("a callout inside a code block is not a card", () => {
        expect(parseT("```md\n> [!question] T\n> B\n```", callouts)).toEqual([]);
    });

    describe("other card syntax in the callout wins, as it always did", () => {
        test("an inline separator", () => {
            expect(parseT("> [!question] What is std::vector\n> An array", callouts)).toEqual(
                parseT("> [!question] What is std::vector\n> An array", base),
            );
            expect(parseT("> [!question] What is std::vector\n> An array", callouts)).toEqual([
                [CardType.SingleLineBasic, "> [!question] What is std::vector", 0, 0],
            ]);
        });

        test("a cloze", () => {
            const text = "> [!question] The capital of ==France==\n> is a city";

            expect(parseT(text, callouts)).toEqual(parseT(text, base));
            expect(parseT(text, callouts)).toEqual([[CardType.Cloze, text, 0, 1]]);
        });

        test("a cloze in the body of the callout", () => {
            const text = "> [!card] T\n> the ==answer==";

            expect(parseT(text, callouts)).toEqual([[CardType.Cloze, text, 0, 1]]);
        });

        test("a multiline separator line right under the callout", () => {
            const text = "> [!question] T\n> B\n?\nAnswer";

            expect(parseT(text, callouts)).toEqual(parseT(text, base));
            expect(parseT(text, callouts).map((c) => c[0])).toEqual([CardType.MultiLineBasic]);
        });

        test("an inline separator inside inline code does not count", () => {
            expect(parseT("> [!question] What is `std::vector`?\n> An array", callouts)).toEqual([
                [CardType.Callout, "> [!question] What is `std::vector`?\n> An array", 0, 1],
            ]);
        });
    });

    test("a callout inside a multiline card answer stays part of that card", () => {
        const text = "Q\n?\nA\n> [!question] T\n> B";

        expect(parseT(text, callouts)).toEqual(parseT(text, base));
        expect(parseT(text, callouts)).toEqual([[CardType.MultiLineBasic, text, 0, 4]]);
    });

    test("the sr metadata callout after the card is not a card of its own", () => {
        const text = "> [!question] T\n> B\n> [!sr|card-metadata] \n>  <!--SR:!2021-08-11,4,270-->";

        // (trailing spaces are removed line by line, as for every multiline card)
        expect(parseT(text, callouts)).toEqual([
            [CardType.Callout, text.replace("metadata] ", "metadata]"), 0, 3],
        ]);
    });

    test("trailing spaces are removed from the card text, as for other multiline cards", () => {
        expect(parseT("> [!question] T  \n> B   \n\nnext::card", callouts)[0]).toEqual([
            CardType.Callout,
            "> [!question] T\n> B",
            0,
            1,
        ]);
    });

    test("with Windows line endings", () => {
        expect(parseT("> [!question] T\r\n> B\r\n", callouts)).toEqual([
            [CardType.Callout, "> [!question] T\n> B", 0, 1],
        ]);
    });

    test("html comments around a callout are skipped", () => {
        expect(parseT("<!-- x -->\n> [!question] T\n> B", callouts)).toEqual([
            [CardType.Callout, "> [!question] T\n> B", 1, 2],
        ]);
    });
});

describe("atomic clozes", () => {
    const atomic: ParserOptions = { ...base, atomicClozes: true };

    test("off (the default): the whole paragraph is the card", () => {
        expect(parseT("intro line\nthe ==cloze== here\nmore text", base)).toEqual([
            [CardType.Cloze, "intro line\nthe ==cloze== here\nmore text", 0, 2],
        ]);
    });

    test("on: only the line with the cloze is the card", () => {
        expect(parseT("intro line\nthe ==cloze== here\nmore text", atomic)).toEqual([
            [CardType.Cloze, "the ==cloze== here", 1, 1],
        ]);
    });

    test("each line with a cloze is a card of its own", () => {
        expect(parseT("a ==1==\nplain\nb ==2== ==3==\n\nc ==4==", atomic)).toEqual([
            [CardType.Cloze, "a ==1==", 0, 0],
            [CardType.Cloze, "b ==2== ==3==", 2, 2],
            [CardType.Cloze, "c ==4==", 4, 4],
        ]);
    });

    test("a schedule comment under the line belongs to that line's card", () => {
        const sr1 = "<!--SR:!2021-08-11,4,270-->";
        const sr2 = "<!--SR:!2021-08-12,5,250!2021-08-13,6,260-->";

        expect(parseT(`a ==1==\n${sr1}\nb ==2== ==3==\n${sr2}\nc ==4==`, atomic)).toEqual([
            [CardType.Cloze, `a ==1==\n${sr1}`, 0, 1],
            [CardType.Cloze, `b ==2== ==3==\n${sr2}`, 2, 3],
            [CardType.Cloze, "c ==4==", 4, 4],
        ]);
    });

    test("a comment on the same line stays on that line", () => {
        const sr = "<!--SR:!2021-08-11,4,270-->";

        expect(parseT(`a ==1== ${sr}\nb ==2==`, atomic)).toEqual([
            [CardType.Cloze, `a ==1== ${sr}`, 0, 0],
            [CardType.Cloze, "b ==2==", 1, 1],
        ]);
    });

    test("the sr metadata callout under the line belongs to it", () => {
        const text = "a ==1==\n> [!sr|card-metadata] \n>  <!--SR:!2021-08-11,4,270-->\nb ==2==";

        expect(parseT(text, atomic)).toEqual([
            [
                CardType.Cloze,
                "a ==1==\n> [!sr|card-metadata] \n>  <!--SR:!2021-08-11,4,270-->",
                0,
                2,
            ],
            [CardType.Cloze, "b ==2==", 3, 3],
        ]);
    });

    describe("a paragraph that already has one shared schedule stays one card", () => {
        test("the comment of two clozes on two lines", () => {
            const text = "L1 ==a==\nL2 ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";

            expect(parseT(text, atomic)).toEqual(parseT(text, base));
            expect(parseT(text, atomic)).toEqual([[CardType.Cloze, text, 0, 2]]);
        });

        test("the comment is not under a cloze line", () => {
            const text = "L ==a==\nplain\n<!--SR:!2021-08-11,4,270-->";

            expect(parseT(text, atomic)).toEqual([[CardType.Cloze, text, 0, 2]]);
        });

        test("a comment with more entries than the line above has cards", () => {
            const text = "intro\nL ==a==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";

            expect(parseT(text, atomic)).toEqual([[CardType.Cloze, text, 0, 2]]);
        });

        test("a comment with as many entries as the line has cards is that line's", () => {
            const text = "intro\nL ==a== ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";

            expect(parseT(text, atomic)).toEqual([
                [
                    CardType.Cloze,
                    "L ==a== ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->",
                    1,
                    2,
                ],
            ]);
        });

        test("a following paragraph is judged on its own", () => {
            const legacy = "L1 ==a==\nL2 ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";

            expect(parseT(`${legacy}\n\nnew ==c==\nnew ==d==`, atomic)).toEqual([
                [CardType.Cloze, legacy, 0, 2],
                [CardType.Cloze, "new ==c==", 4, 4],
                [CardType.Cloze, "new ==d==", 5, 5],
            ]);
        });
    });

    test("a cloze in the question of a multiline card is not split off", () => {
        const text = "Q with ==a== cloze\nmore question\n?\nAnswer";

        expect(parseT(text, atomic)).toEqual(parseT(text, base));
        expect(parseT(text, atomic).map((c) => c[0])).toEqual([CardType.MultiLineBasic]);
    });

    test("a cloze in the answer of a multiline card stays in that card", () => {
        const text = "Q\n?\nAnswer with ==a==\nand more";

        expect(parseT(text, atomic)).toEqual([[CardType.MultiLineBasic, text, 0, 3]]);
    });

    test("inline cards and other paragraphs are as before", () => {
        expect(parseT("Q::A\n\nplain\n\nQ2:::A2", atomic)).toEqual(
            parseT("Q::A\n\nplain\n\nQ2:::A2", base),
        );
    });

    test("a cloze in a code block is not a card", () => {
        expect(parseT("```\n==x==\n```", atomic)).toEqual([]);
    });

    test("with an end marker, a cloze card is still only its line", () => {
        expect(
            parseT("intro\nthe ==cloze==\n\nother\n+++", {
                ...atomic,
                multilineCardEndMarker: "+++",
            }),
        ).toEqual([[CardType.Cloze, "the ==cloze==", 1, 1]]);
    });

    test("a start marker turns atomic clozes off: the region is the card", () => {
        expect(
            parseT("+++\nintro\n\nthe ==cloze==\n+++", {
                ...atomic,
                multilineCardStartMarker: "+++",
                multilineCardEndMarker: "+++",
            }),
        ).toEqual([[CardType.Cloze, "intro\n\nthe ==cloze==", 1, 3]]);
    });
});

describe("latex clozes (\\cloze{answer}{hint})", () => {
    const latex: ParserOptions = { ...base, latexClozes: true };

    test("a line with a macro is a cloze card", () => {
        expect(parseT("$$\n\\cloze{c^2}{} = \\cloze{a^2 + b^2}{Pythagoras}\n$$", latex)).toEqual([
            [CardType.Cloze, "$$\n\\cloze{c^2}{} = \\cloze{a^2 + b^2}{Pythagoras}\n$$", 0, 2],
        ]);
    });

    test("off (the default): a macro is not a cloze", () => {
        expect(parseT("$x = \\cloze{a}{b}$", base)).toEqual([]);
        expect(parseT("$x = \\cloze{a}{b}$", { ...base, latexClozes: false })).toEqual([]);
    });

    test("a macro that is not complete is not a cloze", () => {
        expect(parseT("$\\cloze{a}$ and \\clozes{a}{b}", latex)).toEqual([]);
    });

    test("a paragraph with a macro and a highlight is one card", () => {
        expect(parseT("$\\cloze{a}{}$ and ==b==", latex)).toEqual([
            [CardType.Cloze, "$\\cloze{a}{}$ and ==b==", 0, 0],
        ]);
    });

    test("atomic clozes count a macro as a cloze", () => {
        expect(parseT("intro\n$\\cloze{a}{}$\nplain", { ...latex, atomicClozes: true })).toEqual([
            [CardType.Cloze, "$\\cloze{a}{}$", 1, 1],
        ]);
    });
});

describe("atomic clozes and display math ($$ ... $$ is not cut in two)", () => {
    const atomic: ParserOptions = { ...base, atomicClozes: true, latexClozes: true };
    const sr = "<!--SR:!2021-08-11,4,270-->";

    test("a macro in a block makes the whole block the card", () => {
        expect(parseT("intro\n$$\n\\cloze{a}{} + \\cloze{b}{} = c\n$$\nafter", atomic)).toEqual([
            [CardType.Cloze, "$$\n\\cloze{a}{} + \\cloze{b}{} = c\n$$", 1, 3],
        ]);
    });

    test("a block with the macros on several lines is one card", () => {
        const block = "$$\n\\cloze{a}{} +\n\\cloze{b}{} = c\n$$";

        expect(parseT(`${block}\nplain`, atomic)).toEqual([[CardType.Cloze, block, 0, 3]]);
    });

    test("a highlight in a block makes the whole block the card too", () => {
        expect(parseT("$$\nx = ==a==\n$$", atomic)).toEqual([
            [CardType.Cloze, "$$\nx = ==a==\n$$", 0, 2],
        ]);
    });

    test("display math on one line is just that line", () => {
        expect(parseT("intro\n$$ \\cloze{a}{} = b $$\nplain", atomic)).toEqual([
            [CardType.Cloze, "$$ \\cloze{a}{} = b $$", 1, 1],
        ]);
    });

    test("a cloze on the line that closes the block", () => {
        expect(parseT("$$\nx =\n\\cloze{a}{} $$\nplain", atomic)).toEqual([
            [CardType.Cloze, "$$\nx =\n\\cloze{a}{} $$", 0, 2],
        ]);
    });

    test("a cloze on the line that opens the block", () => {
        expect(parseT("$$ x =\n\\cloze{a}{} $$", atomic)).toEqual([
            [CardType.Cloze, "$$ x =\n\\cloze{a}{} $$", 0, 1],
        ]);
    });

    test("two blocks and a line in one paragraph are three cards", () => {
        expect(
            parseT("$$\n\\cloze{a}{}\n$$\n$$\n\\cloze{b}{}\n$$\ntext ==c==", atomic).map(
                (c) => c[1],
            ),
        ).toEqual(["$$\n\\cloze{a}{}\n$$", "$$\n\\cloze{b}{}\n$$", "text ==c=="]);
    });

    test("the schedule under the block is part of the card", () => {
        expect(parseT(`$$\n\\cloze{a}{}\n$$\n${sr}\nplain ==b==`, atomic)).toEqual([
            [CardType.Cloze, `$$\n\\cloze{a}{}\n$$\n${sr}`, 0, 3],
            [CardType.Cloze, "plain ==b==", 4, 4],
        ]);
    });

    test("a schedule for the whole paragraph keeps the paragraph whole", () => {
        // Two cards (the macro, and the highlight), so two entries: the comment of the whole paragraph
        const text =
            "$$\n\\cloze{a}{}\n$$\ntext ==b==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";

        expect(parseT(text, atomic)).toEqual([[CardType.Cloze, text, 0, 4]]);
    });

    test("a block that is never closed leaves the paragraph as it was", () => {
        expect(parseT("intro\n$$\n==a== x", atomic)).toEqual([
            [CardType.Cloze, "intro\n$$\n==a== x", 0, 2],
        ]);
    });

    test("an escaped dollar sign is not a delimiter", () => {
        expect(parseT("cost \\$$ and ==a==\nnext ==b==", atomic).map((c) => c[1])).toEqual([
            "cost \\$$ and ==a==",
            "next ==b==",
        ]);
    });
});
