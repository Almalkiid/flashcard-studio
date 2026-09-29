import {
    isBlockquoteLine,
    isCompleteCalloutCard,
    normalizeCalloutTypes,
    parseCalloutHeader,
    splitCalloutCard,
    stripBlockquotePrefix,
} from "src/data/data-structures/card/questions/callout-card";
import { CardType } from "src/data/data-structures/card/questions/question";
import {
    CardFrontBack,
    CardFrontBackUtil,
} from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS } from "src/data/settings";

describe("parseCalloutHeader", () => {
    test.each([
        ["> [!question] What is X?", { type: "question", fold: "", title: "What is X?" }],
        ["> [!question]- Folded", { type: "question", fold: "-", title: "Folded" }],
        ["> [!question]+ Open", { type: "question", fold: "+", title: "Open" }],
        ["> [!card]", { type: "card", fold: "", title: "" }],
        ["> [!card]-", { type: "card", fold: "-", title: "" }],
        [
            ">[!card] No space after the quote mark",
            { type: "card", fold: "", title: "No space after the quote mark" },
        ],
        [
            "   > [!card] Indented up to 3 spaces",
            { type: "card", fold: "", title: "Indented up to 3 spaces" },
        ],
        [
            "> [!flashcard|meta] With metadata",
            { type: "flashcard", fold: "", title: "With metadata" },
        ],
        ["> [!Question]   Padded   ", { type: "Question", fold: "", title: "Padded" }],
        ["> [!question] a::b ==c==", { type: "question", fold: "", title: "a::b ==c==" }],
    ])("%s", (line, expected) => {
        expect(parseCalloutHeader(line)).toEqual(expected);
    });

    test.each([
        "> plain quote",
        "> [!] empty type",
        "[!question] no quote mark",
        "    > [!question] four spaces is code",
        "- > [!question] in a list",
        "> [!question]title without a space",
        "",
    ])("not a callout header: %j", (line) => {
        expect(parseCalloutHeader(line)).toBeNull();
    });
});

describe("normalizeCalloutTypes", () => {
    test("trims, lower-cases, drops brackets and blanks, removes duplicates", () => {
        expect(
            normalizeCalloutTypes([" Question ", "[!Card]", "!flashcard", "", "  ", "CARD"]),
        ).toEqual(["question", "card", "flashcard"]);
    });

    test("tolerates a missing list", () => {
        expect(normalizeCalloutTypes(undefined)).toEqual([]);
        expect(normalizeCalloutTypes(null)).toEqual([]);
    });
});

describe("blockquote helpers", () => {
    test("isBlockquoteLine", () => {
        expect(isBlockquoteLine("> a")).toBe(true);
        expect(isBlockquoteLine(">")).toBe(true);
        expect(isBlockquoteLine("   > a")).toBe(true);
        expect(isBlockquoteLine("    > a")).toBe(false);
        expect(isBlockquoteLine("a > b")).toBe(false);
        expect(isBlockquoteLine("")).toBe(false);
    });

    test("stripBlockquotePrefix removes one level only", () => {
        expect(stripBlockquotePrefix("> text")).toBe("text");
        expect(stripBlockquotePrefix(">text")).toBe("text");
        expect(stripBlockquotePrefix(">")).toBe("");
        expect(stripBlockquotePrefix("> > nested")).toBe("> nested");
        expect(stripBlockquotePrefix(">     code")).toBe("    code");
    });
});

describe("splitCalloutCard", () => {
    test("title and body", () => {
        expect(splitCalloutCard("> [!question] Front\n> Back")).toEqual({
            front: "Front",
            back: "Back",
        });
    });

    test("a multi-line body with a list, a code block and a blank quote line", () => {
        expect(
            splitCalloutCard("> [!card] List\n> - one\n> - two\n>\n> ```py\n> print(1)\n> ```"),
        ).toEqual({ front: "List", back: "- one\n- two\n\n```py\nprint(1)\n```" });
    });

    test("a nested callout keeps its own quote mark", () => {
        expect(splitCalloutCard("> [!card] T\n> A\n> > [!note] N\n> > inner")).toEqual({
            front: "T",
            back: "A\n> [!note] N\n> inner",
        });
    });

    test("the scheduling comment is not part of the card", () => {
        expect(splitCalloutCard("> [!card] T\n> A\n<!--SR:!2021-08-11,4,270-->")).toEqual({
            front: "T",
            back: "A",
        });
        expect(splitCalloutCard("> [!card] T\n> A\n> <!--SR:!2021-08-11,4,270-->")).toEqual({
            front: "T",
            back: "A",
        });
    });

    test("the sr metadata callout is not part of the card", () => {
        expect(
            splitCalloutCard(
                "> [!card] T\n> A\n> [!sr|card-metadata] \n>  <!--SR:!2021-08-11,4,270-->",
            ),
        ).toEqual({ front: "T", back: "A" });
    });

    test("not a callout", () => {
        expect(splitCalloutCard("just text")).toBeNull();
    });
});

describe("isCompleteCalloutCard", () => {
    test("needs a title and a body", () => {
        expect(isCompleteCalloutCard(["> [!card] T", "> A"])).toBe(true);
        expect(isCompleteCalloutCard(["> [!card]", "> A"])).toBe(false);
        expect(isCompleteCalloutCard(["> [!card] T"])).toBe(false);
        expect(isCompleteCalloutCard(["> [!card] T", ">", "> "])).toBe(false);
        expect(isCompleteCalloutCard(["> [!card] T", "<!--SR:!2021-08-11,4,270-->"])).toBe(false);
    });
});

describe("CardType.Callout", () => {
    test("expands to one card, title to body", () => {
        expect(
            CardFrontBackUtil.expand(
                CardType.Callout,
                "> [!question]- What is X?\n> **Y**, because\n> Z.",
                DEFAULT_SETTINGS,
            ),
        ).toEqual([new CardFrontBack("What is X?", "**Y**, because\nZ.")]);
    });
});
