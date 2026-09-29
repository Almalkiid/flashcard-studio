/**
 * The M3b card syntaxes through the real path: parse a note, review a card, let the plugin write the
 * schedule into the note, then parse the note again. The re-parsed cards must be the same cards, with
 * the schedules the review gave them, and no schedule may be lost or duplicated on the way.
 */
import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteParser } from "src/note/note-parser";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import {
    setupStaticDateProvider20230906,
    setupStaticDateProviderOriginDatePlusDays,
} from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { stripCardIds } from "./helpers/unit-test-helper";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const order: IIteratorOrder = {
    repItemOrder: RepItemOrder.NewFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

interface Loaded {
    note: Note;
    deck: Deck;
    sequencer: FlashcardReviewSequencer;
}

const settingsWith = (overrides: Partial<SRSettings>): SRSettings => ({
    ...DEFAULT_SETTINGS,
    ...overrides,
});

async function load(file: UnitTestSRFile, settings: SRSettings): Promise<Loaded> {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const note = await new NoteParser(settings).parse(
        file,
        TextDirection.Ltr,
        new TopicPath(["Root"]),
    );
    const deck = new Deck("Root", null);
    note.appendCardsToDeck(deck);

    const postponementList = new QuestionPostponementList(null, settings, []);
    const sequencer = new FlashcardReviewSequencer(
        FlashcardReviewMode.Review,
        new DeckTreeIterator(order, null),
        settings,
        SRAlgorithm.getInstance(),
        postponementList,
        new CardDueDateHistogram(),
    );
    sequencer.setDeckTree(
        deck,
        DeckTreeFilter.filterForRemainingRepItems(
            postponementList,
            deck,
            FlashcardReviewMode.Review,
        ),
    );
    return { note, deck, sequencer };
}

/** Front, back and whether it has a schedule, of every card in the note. */
function cardsOf(note: Note): { front: string; back: string; scheduled: boolean }[] {
    return note.questionList.flatMap((q) =>
        q.cards.map((card) => ({
            front: card.front,
            back: card.back,
            scheduled: card.hasSchedule,
        })),
    );
}

async function reviewAll(loaded: Loaded, response: ReviewResponse, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await loaded.sequencer.processReview(response);
    }
}

const sr = /<!--SR:![^>]*-->/g;
// One schedule entry of a comment, e.g. `!2023-09-09,3,250`
const entry = "!\\d{4}-\\d\\d-\\d\\d,\\d+,\\d+";
const comments = (text: string): string[] => text.match(sr) ?? [];

beforeAll(() => {
    setupStaticDateProvider20230906();
});

describe("callout cards", () => {
    const note =
        "#flashcards\n\n> [!question]- What is the capital of France?\n> Paris\n\nAfter.\n";

    test("title is the front, body is the back", async () => {
        const { sequencer } = await load(new UnitTestSRFile(note), DEFAULT_SETTINGS);

        expect(sequencer.currentCard.front).toBe("What is the capital of France?");
        expect(sequencer.currentCard.back).toBe("Paris");
    });

    test("review writes the schedule on the line after the callout, and nothing else changes", async () => {
        const file = new UnitTestSRFile(note);
        const loaded = await load(file, DEFAULT_SETTINGS);

        await reviewAll(loaded, ReviewResponse.Good, 1);

        const written = stripCardIds(file.content);
        expect(written).toMatch(
            /^#flashcards\n\n> \[!question\]- What is the capital of France\?\n> Paris\n<!--SR:!2023-09-\d\d,\d+,\d+-->\n\nAfter\.\n$/,
        );
    });

    test("parse, review, write, parse: the same card, now scheduled", async () => {
        const file = new UnitTestSRFile(note);
        const first = await load(file, DEFAULT_SETTINGS);
        expect(cardsOf(first.note)).toEqual([
            { front: "What is the capital of France?", back: "Paris", scheduled: false },
        ]);

        await reviewAll(first, ReviewResponse.Good, 1);
        const second = await load(file, DEFAULT_SETTINGS);

        expect(cardsOf(second.note)).toEqual([
            { front: "What is the capital of France?", back: "Paris", scheduled: true },
        ]);
        expect(second.note.questionList[0].cards[0].scheduleInfo.interval).toBeGreaterThan(0);
    });

    test("a second review replaces the schedule instead of adding another", async () => {
        const file = new UnitTestSRFile(note);
        const first = await load(file, DEFAULT_SETTINGS);
        await reviewAll(first, ReviewResponse.Good, 1);
        setupStaticDateProviderOriginDatePlusDays(400); // the card is due again
        const second = await load(file, DEFAULT_SETTINGS);
        await reviewAll(second, ReviewResponse.Easy, 1);
        setupStaticDateProvider20230906();

        expect(comments(file.content)).toHaveLength(1);
        expect(file.content).toMatch(/> Paris\n<!--SR:!/);
        expect(cardsOf((await load(file, DEFAULT_SETTINGS)).note)).toHaveLength(1);
    });

    test("body with several lines, a list and a nested callout is the whole back", async () => {
        const text =
            "#flashcards\n\n> [!card] List the layers\n> - Physical\n> - Data link\n>\n> > [!note] Hint\n> > Seven of them\n";
        const file = new UnitTestSRFile(text);
        const loaded = await load(file, DEFAULT_SETTINGS);

        expect(loaded.sequencer.currentCard.back).toBe(
            "- Physical\n- Data link\n\n> [!note] Hint\n> Seven of them",
        );
        await reviewAll(loaded, ReviewResponse.Good, 1);
        const written = stripCardIds(file.content);
        expect(written).toMatch(/> > Seven of them\n<!--SR:!/);
        expect(cardsOf((await load(file, DEFAULT_SETTINGS)).note)).toEqual([
            {
                front: "List the layers",
                back: "- Physical\n- Data link\n\n> [!note] Hint\n> Seven of them",
                scheduled: true,
            },
        ]);
    });

    test("the schedule stays outside the callout with the callout metadata setting on", async () => {
        const settings = settingsWith({ useCalloutsForSchedulingComments: true });
        const file = new UnitTestSRFile(note);
        await reviewAll(await load(file, settings), ReviewResponse.Good, 1);

        expect(file.content).not.toContain("sr|card-metadata");
        expect(file.content).toMatch(/> Paris\n<!--SR:!/);
    });

    test("the schedule stays on its own line with the same-line setting on", async () => {
        const settings = settingsWith({ cardCommentOnSameLine: true });
        const file = new UnitTestSRFile(note);
        await reviewAll(await load(file, settings), ReviewResponse.Good, 1);

        expect(file.content).toMatch(/> Paris\n<!--SR:!/);
    });

    test("a block identifier at the end of the callout is kept, and the schedule is written after it", async () => {
        const text = "#flashcards\n\n> [!question] Q\n> A ^blk1\n";
        const file = new UnitTestSRFile(text);
        await reviewAll(await load(file, DEFAULT_SETTINGS), ReviewResponse.Good, 1);

        expect(stripCardIds(file.content)).toMatch(/> A \^blk1\n<!--SR:!2023-09-\d\d,\d+,\d+-->/);
        expect(cardsOf((await load(file, DEFAULT_SETTINGS)).note)[0].back).toBe("A");
    });

    test("two callout cards and an inline card keep their own schedules", async () => {
        const text = "#flashcards\n\n> [!question] Q1\n> A1\n\n> [!card] Q2\n> A2\n\nQ3::A3\n";
        const file = new UnitTestSRFile(text);
        const first = await load(file, DEFAULT_SETTINGS);
        expect(cardsOf(first.note).map((c) => c.front)).toEqual(["Q1", "Q2", "Q3"]);

        await reviewAll(first, ReviewResponse.Good, 3);

        const second = await load(file, DEFAULT_SETTINGS);
        expect(cardsOf(second.note)).toEqual([
            { front: "Q1", back: "A1", scheduled: true },
            { front: "Q2", back: "A2", scheduled: true },
            { front: "Q3", back: "A3", scheduled: true },
        ]);
        expect(comments(file.content)).toHaveLength(3);
    });

    test("callout cards can be turned off", async () => {
        const settings = settingsWith({ calloutCardTypes: [] });
        const { note: parsed } = await load(new UnitTestSRFile(note), settings);

        expect(cardsOf(parsed)).toEqual([]);
    });

    test("a callout with a cloze in it is still the cloze card it always was", async () => {
        const text = "#flashcards\n\n> [!question] Capital of ==France==\n> a city\n";
        const { note: parsed } = await load(new UnitTestSRFile(text), DEFAULT_SETTINGS);

        expect(parsed.questionList).toHaveLength(1);
        expect(parsed.questionList[0].questionText.original).toBe(
            "> [!question] Capital of ==France==\n> a city",
        );
        expect(cardsOf(parsed)).toHaveLength(1);
        expect(cardsOf(parsed)[0].front).toContain("[...]");
    });
});

describe("multi-paragraph cards (card regions)", () => {
    const settings = settingsWith({
        multilineCardStartMarker: "+++",
        multilineCardEndMarker: "+++",
    });
    const text = [
        "#flashcards",
        "",
        "+++",
        "Patterns:",
        "",
        "| verb | pattern |",
        "| ---- | ------- |",
        "| help | help sb (to) do |",
        "",
        "Prompt: Can you ______ a newspaper ad?",
        "?",
        "Can you help me (to) write a newspaper ad?",
        "",
        "It is a request.",
        "+++",
        "",
        "Q::A",
        "",
    ].join("\n");

    test("blank lines, a table and lists stay in the front and back", async () => {
        const { note: parsed } = await load(new UnitTestSRFile(text), settings);

        const multiline = cardsOf(parsed)[0];
        expect(multiline.front).toBe(
            "Patterns:\n\n| verb | pattern |\n| ---- | ------- |\n| help | help sb (to) do |\n\nPrompt: Can you ______ a newspaper ad?",
        );
        expect(multiline.back).toBe(
            "Can you help me (to) write a newspaper ad?\n\nIt is a request.",
        );
        expect(cardsOf(parsed)[1].front).toBe("Q");
    });

    test("the schedule is written inside the region, before the end marker, and survives a re-parse", async () => {
        const file = new UnitTestSRFile(text);
        const first = await load(file, settings);
        await reviewAll(first, ReviewResponse.Good, 2);

        const written = stripCardIds(file.content);
        expect(written).toMatch(
            /It is a request\.\n<!--SR:!2023-09-\d\d,\d+,\d+-->\n\+\+\+\n\nQ::A\n<!--SR:!/,
        );

        const second = await load(file, settings);
        expect(cardsOf(second.note)).toEqual([
            {
                front: cardsOf(first.note)[0].front,
                back: cardsOf(first.note)[0].back,
                scheduled: true,
            },
            { front: "Q", back: "A", scheduled: true },
        ]);
    });

    test("reviewing again does not duplicate or move the schedule", async () => {
        const file = new UnitTestSRFile(text);
        await reviewAll(await load(file, settings), ReviewResponse.Good, 2);
        const afterFirst = file.content;

        setupStaticDateProviderOriginDatePlusDays(400); // both cards are due again
        await reviewAll(await load(file, settings), ReviewResponse.Easy, 2);
        setupStaticDateProvider20230906();

        expect(comments(file.content)).toHaveLength(2);
        expect(stripCardIds(file.content).replace(sr, "<sr>")).toBe(
            stripCardIds(afterFirst).replace(sr, "<sr>"),
        );
    });

    test("cards outside a region are not found, and their schedule text is left alone", async () => {
        const outside =
            "#flashcards\n\nQ\n?\nA\n<!--SR:!2023-09-05,4,270-->\n\n+++\nX ==y==\n\nz\n+++\n";
        const file = new UnitTestSRFile(outside);
        const first = await load(file, settings);

        expect(cardsOf(first.note)).toHaveLength(1);
        await reviewAll(first, ReviewResponse.Good, 1);
        expect(file.content).toContain("Q\n?\nA\n<!--SR:!2023-09-05,4,270-->\n");
    });
});

describe("scheduled cards must not lose a schedule (issue #1402)", () => {
    const sr1 = "<!--SR:!2023-09-05,4,270-->";
    const sr2 = "<!--SR:!2023-09-07,6,250-->";

    test("turning on an end marker keeps two scheduled cards apart", async () => {
        const text = `#flashcards\n\nQ1\n?\nA1\n${sr1}\n\nQ2\n?\nA2\n${sr2}\n`;
        const file = new UnitTestSRFile(text);
        const loaded = await load(file, settingsWith({ multilineCardEndMarker: "+++" }));

        expect(cardsOf(loaded.note)).toEqual([
            { front: "Q1", back: "A1", scheduled: true },
            { front: "Q2", back: "A2", scheduled: true },
        ]);
        expect(loaded.note.hasChanged).toBe(false);
        expect(file.content).toBe(text);
    });

    test("two scheduled cards wrapped in one region: reviewing the card keeps the other schedule", async () => {
        const settings = settingsWith({
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
        });
        const text = `#flashcards\n\n+++\nQ1\n?\nA1\n${sr1}\n\nQ2\n?\nA2\n${sr2}\n+++\n`;
        const file = new UnitTestSRFile(text);

        await reviewAll(await load(file, settings), ReviewResponse.Easy, 1);

        // The card of the region got a new schedule; the second comment was not thrown away
        expect(comments(file.content)).toHaveLength(2);
        expect(file.content).toContain(sr2);
    });

    test("atomic clozes: a paragraph with one shared schedule is not split, so nothing is deleted", async () => {
        const text = "#flashcards\n\nL1 ==a==\nL2 ==b==\n<!--SR:!2023-09-05,4,270!2023-09-07,6,250-->\n";
        const file = new UnitTestSRFile(text);
        const loaded = await load(file, settingsWith({ atomicClozes: true }));

        expect(cardsOf(loaded.note)).toHaveLength(2);
        expect(cardsOf(loaded.note).every((c) => c.scheduled)).toBe(true);
        expect(loaded.note.hasChanged).toBe(false);
        expect(file.content).toBe(text);
    });
});

describe("atomic clozes", () => {
    const settings = settingsWith({ atomicClozes: true });
    const text =
        "#flashcards\n\nintro line\nFirst ==one== here\nplain line\nSecond ==two== ==2b== here\n";

    test("each cloze line is its own card, without the rest of the paragraph", async () => {
        const { note: parsed } = await load(new UnitTestSRFile(text), settings);

        expect(parsed.questionList.map((q) => q.questionText.original)).toEqual([
            "First ==one== here",
            "Second ==two== ==2b== here",
        ]);
        expect(cardsOf(parsed)).toHaveLength(3);
    });

    test("each line gets its own schedule under it, and re-parses to the same cards", async () => {
        const file = new UnitTestSRFile(text);
        const first = await load(file, settings);
        await reviewAll(first, ReviewResponse.Good, 3);

        const written = stripCardIds(file.content);
        expect(written).toMatch(
            new RegExp(
                `intro line\\nFirst ==one== here\\n<!--SR:${entry}-->\\nplain line\\nSecond ==two== ==2b== here\\n<!--SR:${entry}${entry}-->\\n$`,
            ),
        );

        const second = await load(file, settings);
        expect(cardsOf(second.note)).toHaveLength(3);
        expect(cardsOf(second.note).every((c) => c.scheduled)).toBe(true);
        expect(comments(file.content)).toHaveLength(2);
    });

    test("off, the same note is one paragraph card with one schedule", async () => {
        const { note: parsed } = await load(new UnitTestSRFile(text), DEFAULT_SETTINGS);

        expect(parsed.questionList).toHaveLength(1);
        expect(cardsOf(parsed)).toHaveLength(3);
    });
});

describe("latex clozes", () => {
    const settings = settingsWith({ latexClozes: true });

    test("one card per macro, the schedule goes after the closing $$", async () => {
        const text = "#flashcards\n\n$$\n\\cloze{c^2}{} = \\cloze{a^2 + b^2}{Pythagoras}\n$$\n";
        const file = new UnitTestSRFile(text);
        const first = await load(file, settings);

        expect(cardsOf(first.note)).toHaveLength(2);
        await reviewAll(first, ReviewResponse.Good, 2);

        expect(stripCardIds(file.content)).toMatch(
            new RegExp(
                `\\$\\$\\n\\\\cloze\\{c\\^2\\}\\{\\} = \\\\cloze\\{a\\^2 \\+ b\\^2\\}\\{Pythagoras\\}\\n\\$\\$\\n<!--SR:${entry}${entry}-->\\n$`,
            ),
        );
        expect(cardsOf((await load(file, settings)).note).every((c) => c.scheduled)).toBe(true);
    });

    test("with atomic clozes a $$ block stays whole, and keeps its schedule after the block", async () => {
        const both = settingsWith({ latexClozes: true, atomicClozes: true });
        const text = "#flashcards\n\nA line ==one==\n$$\n\\cloze{a}{} + b\n$$\nA line ==two==\n";
        const file = new UnitTestSRFile(text);
        const first = await load(file, both);

        expect(first.note.questionList.map((q) => q.questionText.original)).toEqual([
            "A line ==one==",
            "$$\n\\cloze{a}{} + b\n$$",
            "A line ==two==",
        ]);
        await reviewAll(first, ReviewResponse.Good, 3);

        const written = stripCardIds(file.content);
        expect(written).toMatch(
            new RegExp(
                `A line ==one==\\n<!--SR:${entry}-->\\n\\$\\$\\n\\\\cloze\\{a\\}\\{\\} \\+ b\\n\\$\\$\\n<!--SR:${entry}-->\\nA line ==two==\\n<!--SR:${entry}-->\\n$`,
            ),
        );
        const second = await load(file, both);
        expect(cardsOf(second.note).every((c) => c.scheduled)).toBe(true);
        expect(cardsOf(second.note)).toHaveLength(3);
    });

    test("a highlight in the same paragraph is still a cloze card of its own", async () => {
        const text = "#flashcards\n\n$\\cloze{x^2}{}$ is the ==square==\n";
        const { note: parsed } = await load(new UnitTestSRFile(text), settings);

        const cards = cardsOf(parsed);
        expect(cards).toHaveLength(2);
        // The highlight's card comes first, so a schedule written before the macro existed keeps its place
        expect(cards[0].front).toContain("[...]");
        expect(cards[0].front).toContain("$x^2$");
        expect(cards[1].front).toContain("\\color{#2196f3}{[\\ldots]}");
        expect(cards[1].front).toContain("square");
    });
});
