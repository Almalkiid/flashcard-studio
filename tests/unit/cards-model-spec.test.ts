/**
 * Behaviour of the card model that the golden vectors reach only in passing, written from the cards, parser and
 * storage behaviour inventory (sections 2.2, 3.2, 4, 5.4) and the data core inventory (section 5.2): how a question
 * becomes cards, what a card and a deck list say about themselves, and where a rewrite puts the schedule comment.
 */
import {
    CardFrontBackUtil,
    QuestionTypeClozeFormatter,
    QuestionTypeClozeInputFormatter,
} from "src/cards/expand";
import { parse, parserOptionsFromSettings } from "src/cards/parse";
import { DataStore, DataStoreAlgorithm } from "src/data/data-store/store";
import { Card } from "src/data/data-structures/card/flashcard";
import { CardType } from "src/data/data-structures/card/question";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { StudioSettings } from "src/data/settings-model";
import { formatOcclusionBlock } from "src/occlusion/occlusion-block";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

import { load, settingsWith, setUp } from "./storage/helpers";

const expand = (type: CardType, text: string, options: Partial<StudioSettings> = {}) =>
    CardFrontBackUtil.expand(type, text, settingsWith(options)).map((c) => [c.front, c.back]);

describe("expanding a question into cards", () => {
    test("a single-line card splits at the first separator and keeps the spaces around it", () => {
        expect(expand(CardType.SingleLineBasic, "Q ::  A  ")).toEqual([["Q ", "  A  "]]);
        expect(expand(CardType.SingleLineBasic, "a::b::c")).toEqual([["a", "b::c"]]);
    });

    test("a reversed single-line card gives the card and its mirror", () => {
        expect(expand(CardType.SingleLineReversed, "a:::b")).toEqual([
            ["a", "b"],
            ["b", "a"],
        ]);
    });

    test("a multi-line card splits at the separator line, and a reversed one also mirrors", () => {
        expect(expand(CardType.MultiLineBasic, "Q1\nQ2\n   ?  \nA1\nA2")).toEqual([
            ["Q1\nQ2", "A1\nA2"],
        ]);
        expect(expand(CardType.MultiLineReversed, "Q\n??\nA")).toEqual([
            ["Q", "A"],
            ["A", "Q"],
        ]);
    });

    test("the separators come from the settings", () => {
        expect(expand(CardType.SingleLineBasic, "a=>b", { singleLineCardSeparator: "=>" })).toEqual(
            [["a", "b"]],
        );
        expect(
            expand(CardType.MultiLineBasic, "Q\n---\nA", { multilineCardSeparator: "---" }),
        ).toEqual([["Q", "A"]]);
    });

    test("a callout card has its title as the front and its body as the back; any other text gives no card", () => {
        expect(expand(CardType.Callout, "> [!question]- Capital?\n> Paris")).toEqual([
            ["Capital?", "Paris"],
        ]);
        expect(expand(CardType.Callout, "plain text")).toEqual([]);
    });

    test("an image occlusion block gives one card per mask, and anything else none", () => {
        const block = formatOcclusionBlock({
            image: "[[Heart.png]]",
            mode: "hide-one",
            question: "Name the chamber",
            masks: [
                { id: "a1", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "Left" },
                { id: "b2", shape: "ellipse", x: 0.5, y: 0.5, w: 0.1, h: 0.1, label: "Right" },
            ],
        });
        expect(
            expand(CardType.ImageOcclusion, "```image-occlusion\n" + block + "\n```"),
        ).toHaveLength(2);
        expect(expand(CardType.ImageOcclusion, "no block here")).toEqual([]);
    });

    describe("clozes", () => {
        test("numbered clozes make one card per number, asking with the hint or [...]", () => {
            const cards = expand(
                CardType.Cloze,
                "==1;;alpha;;first== ==1;;beta== ==2;;gamma;;third==",
            );
            expect(cards).toHaveLength(2);
            const [front, back] = cards[0];
            expect(front).toContain("<span style='color:#2196f3'>[first]</span>");
            expect(front).toContain("<span style='color:#2196f3'>[...]</span>");
            expect(front).toContain("gamma");
            expect(back).toContain("<span style='color:#2196f3'>alpha</span>");
            expect(back).toContain("<span style='color:#2196f3'>beta</span>");
        });

        test("the input formatter asks with a text box sized to the answer, and shows the answer in its own span", () => {
            const [[front, back]] = expand(CardType.Cloze, "The ==answer;;hint== is here", {
                convertClozePatternsToInputs: true,
            });
            expect(front).toContain(
                '<span style=\'color:#2196f3\'><input class="cloze-input" type="text" size="6" />[hint]</span>',
            );
            expect(back).toContain(
                "<span class=\"cloze-answer\" style='color:#2196f3'>answer</span>",
            );
        });

        test("typing answers turns on the input formatter too, and an answer with no hint has no brackets", () => {
            const [[front]] = expand(CardType.Cloze, "A ==b== c", { typeAnswers: true });
            expect(front).toContain(
                '<span style=\'color:#2196f3\'><input class="cloze-input" type="text" size="1" /></span>',
            );
        });

        test("the formatters write a deleted cloze the same way, with its hint or [...]", () => {
            for (const formatter of [
                new QuestionTypeClozeFormatter(),
                new QuestionTypeClozeInputFormatter(),
            ]) {
                expect(formatter.hiding("x", "hint")).toBe(
                    "<span style='color:var(--code-comment)'>[hint]</span>",
                );
                expect(formatter.hiding("x")).toBe(
                    "<span style='color:var(--code-comment)'>[...]</span>",
                );
            }
            expect(new QuestionTypeClozeInputFormatter().asking()).toContain('size="1"');
        });

        test("a marker with nothing inside makes no card", () => {
            expect(expand(CardType.Cloze, "a ==== b")).toEqual([]);
        });
    });
});

describe("a card", () => {
    test("starts empty, copies the fields it is given, and prints as front::back", () => {
        expect(new Card().front).toBe("");
        expect(new Card().back).toBe("");
        const card = new Card({ front: "Q", back: "A", cardIdx: 2 });
        expect(card.cardIdx).toBe(2);
        expect(card.toString()).toBe("Q::A");
    });

    test("says New until it has a schedule, then writes the schedule as in the note", () => {
        const card = new Card({ front: "Q", back: "A" });
        expect(card.formatSchedule()).toBe("New");
        card.scheduleInfo = new Sm2State(moment("2026-10-20", "YYYY-MM-DD"), 12, 260);
        expect(card.formatSchedule()).toBe("!2026-10-20,12,260");
    });
});

describe("the decks of a question", () => {
    test("a list refuses null, counts its paths and writes them as tags", () => {
        expect(() => new TopicPathList(null)).toThrow("TopicPathList null");
        const list = new TopicPathList([new TopicPath(["a", "b"]), new TopicPath(["c"])], 4);
        expect(list.length).toBe(2);
        expect(list.lineNum).toBe(4);
        expect(list.format(", ")).toBe("#a/b, #c");
        expect(TopicPathList.empty().length).toBe(0);
        expect(TopicPathList.empty().lineNum).toBeNull();
    });

    test("an empty path inside a list cannot be written as a tag", () => {
        expect(() => new TopicPathList([new TopicPath([])]).format("|")).toThrow();
    });

    test("the compact form reads and writes lists of tags", () => {
        const list = TopicPathList.fromPsv("#a/b||#c", 7);
        expect(list.formatPsv()).toBe("#a/b|#c");
        expect(list.lineNum).toBe(7);
        expect(TopicPathList.fromPsv("").length).toBe(0);
    });
});

describe("the data store in use", () => {
    test("asking for one that was never set is an error", () => {
        const store = DataStore.instance;
        const algorithm = DataStoreAlgorithm.instance;
        DataStore.instance = undefined;
        DataStoreAlgorithm.instance = undefined;
        try {
            expect(() => DataStore.getInstance()).toThrow("there is no DataStore instance.");
            expect(() => DataStoreAlgorithm.getInstance()).toThrow(
                "there is no DataStoreAlgorithm instance.",
            );
        } finally {
            DataStore.instance = store;
            DataStoreAlgorithm.instance = algorithm;
        }
    });
});

describe("the parser at the edges of a card", () => {
    const parsed = (text: string, options: Partial<StudioSettings> = {}) =>
        parse(text, parserOptionsFromSettings(settingsWith(options))).map((q) => [
            q.cardType,
            q.text,
            q.firstLineNum,
            q.lastLineNum,
        ]);

    test("a multi-line card with nothing after its separator is dropped, at a blank line and at the end of the note", () => {
        expect(parsed("Q\n?\n\nR::S")).toEqual([[CardType.SingleLineBasic, "R::S", 3, 3]]);
        expect(parsed("Q\n?")).toEqual([]);
        expect(parsed("Q\n?\n   \n")).toEqual([]);
    });

    test("a code fence that is never closed takes the rest of the note and gets a closing line", () => {
        expect(parsed("Q\n?\nA\n```\ncode\nmore")).toEqual([
            [CardType.MultiLineBasic, "Q\n?\nA\n```\ncode\nmore\n```", 0, 5],
        ]);
    });

    test("a card region ends at its end marker, and a start marker inside a region opens the next", () => {
        const region = {
            multilineCardStartMarker: "<!--card-->",
            multilineCardEndMarker: "<!--/card-->",
        };
        expect(parsed("<!--card-->\nQ\n\nmore\n?\nA\n\nA2\n<!--/card-->", region)).toEqual([
            [CardType.MultiLineBasic, "Q\n\nmore\n?\nA\n\nA2", 1, 7],
        ]);
        expect(
            parsed("<!--card-->\nQ1\n?\nA1\n<!--card-->\nQ2\n?\nA2\n<!--/card-->", region).map(
                (q) => q[1],
            ),
        ).toEqual(["Q1\n?\nA1", "Q2\n?\nA2"]);
    });

    test("with atomic clozes a comment with an entry for each line keeps the paragraph whole, a comment with one entry does not", () => {
        const two = "a ==b==\nc ==d==\n<!--SR:!2021-08-11,4,270!2021-08-12,5,250-->";
        expect(parsed(two, { atomicClozes: true })).toEqual(parsed(two));
        expect(parsed(two, { atomicClozes: true })).toHaveLength(1);

        const one = "a ==b==\nc ==d==\n<!--SR:!2021-08-11,4,270-->";
        expect(parsed(one, { atomicClozes: true }).map((q) => q[1])).toEqual([
            "a ==b==",
            "c ==d==\n<!--SR:!2021-08-11,4,270-->",
        ]);
        expect(parsed(one)).toHaveLength(1);
    });
});

describe("where a rewrite puts the schedule comment", () => {
    const schedule = "!2026-10-20,12,260";

    async function rewritten(text: string, options: Partial<StudioSettings> = {}): Promise<string> {
        const settings = settingsWith({ cardCommentOnSameLine: false, ...options });
        setUp(settings);
        const { note } = await load(text, settings);
        const question = note.questionList[0];
        question.cards[0].scheduleInfo = new Sm2State(moment("2026-10-20", "YYYY-MM-DD"), 12, 260);
        return question.formatForNote(settings).replace(/,id=[0-9a-z]+/g, "");
    }

    test("on the next line by default", async () => {
        expect(await rewritten("#flashcards\nQ::A")).toBe(`Q::A\n<!--SR:${schedule}-->`);
    });

    test("after the question when the setting says the same line", async () => {
        expect(await rewritten("#flashcards\nQ::A", { cardCommentOnSameLine: true })).toBe(
            `Q::A <!--SR:${schedule}-->`,
        );
    });

    test("in a metadata callout when the setting says so, which wins over the same line", async () => {
        expect(
            await rewritten("#flashcards\nQ::A", {
                useCalloutsForSchedulingComments: true,
                cardCommentOnSameLine: true,
            }),
        ).toBe(`Q::A\n> [!sr|card-metadata] \n>  <!--SR:${schedule}-->`);
    });

    test("after the block id, which stays on the question line", async () => {
        expect(await rewritten("#flashcards\nQ::A ^b1")).toBe(`Q::A ^b1\n<!--SR:${schedule}-->`);
        expect(await rewritten("#flashcards\nQ::A ^b1", { cardCommentOnSameLine: true })).toBe(
            `Q::A <!--SR:${schedule}--> ^b1`,
        );
    });

    test("always on the next line after a code fence or a callout card", async () => {
        expect(
            await rewritten("#flashcards\nQ\n?\n```\ncode\n```", { cardCommentOnSameLine: true }),
        ).toBe(`#flashcards\nQ\n?\n\`\`\`\ncode\n\`\`\`\n<!--SR:${schedule}-->`);
        expect(
            await rewritten("#flashcards\n> [!question]- Q\n> A", {
                cardCommentOnSameLine: true,
                useCalloutsForSchedulingComments: true,
            }),
        ).toBe(`> [!question]- Q\n> A\n<!--SR:${schedule}-->`);
    });

    test("a question with no schedule is written as it is, without the comment it had", async () => {
        const settings = settingsWith();
        setUp(settings);
        const { note } = await load("#flashcards\nQ::A", settings);
        expect(note.questionList[0].formatForNote(settings)).toBe("Q::A");
    });
});
