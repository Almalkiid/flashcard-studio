import { CardType } from "src/data/data-structures/card/questions/question";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { CURLY_CLOZE_PATTERN } from "src/import-export/anki-cloze";
import { importNotes, NO_MEDIA } from "src/import-export/anki-importer";
import { AnkiNote } from "src/import-export/anki-types";
import { findGuids } from "src/import-export/guid-comment";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { ReviewSessionContext } from "../helpers/review-session-context";
import { UnitTestSRFile } from "../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { createTestNoteQuestionParser } from "../sample-items";
import { FakeHost } from "./helpers/fake-host";
import { simpleHtmlToMarkdown } from "./helpers/simple-html-to-markdown";

// Runs in the default (jsdom) environment, which the review sequencer needs for `window.crypto`. The package reader
// needs Node, so the notes are written out here as the reader gives them.

const settings = {
    ...DEFAULT_SETTINGS,
    algorithm: SRAlgorithmType.SM_2_OSR,
    clozePatterns: [...DEFAULT_SETTINGS.clozePatterns, CURLY_CLOZE_PATTERN],
};

const note = (overrides: Partial<AnkiNote> & Pick<AnkiNote, "guid" | "fields">): AnkiNote => ({
    deck: "Spanish",
    kind: "basic",
    noteTypeName: "Basic",
    fieldNames: ["Front", "Back"],
    tags: [],
    ...overrides,
});

const notes: AnkiNote[] = [
    note({
        guid: "guid-hola",
        fields: ["hola", "<b>hello</b><br>(a greeting)"],
        tags: ["greetings", "week1"],
    }),
    note({ guid: "guid-gracias", kind: "reversed", fields: ["gracias", "thanks"] }),
    note({ guid: "guid-plain", fields: ["adios", "goodbye"] }),
    note({
        guid: "guid-cloze",
        deck: "Spanish::Verbs",
        kind: "cloze",
        fields: ["Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}", "Present tense"],
    }),
    note({
        guid: "guid-vocab",
        deck: "Spanish::Verbs",
        kind: "other",
        fields: ["comer", "to eat", "Yo como pan"],
    }),
    note({
        guid: "guid-colons",
        deck: "Spanish::Verbs",
        fields: ["std::vector is a", "container"],
    }),
];

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(settings);
});

async function importedText(path: string): Promise<string> {
    const host = new FakeHost();
    await importNotes(
        notes,
        NO_MEDIA,
        { targetFolder: "Flashcards/Imported", basicStyle: "multi", keepTags: true },
        { host, htmlToMarkdown: simpleHtmlToMarkdown, flashcardTag: "#flashcards" },
    );
    return host.texts.get(path);
}

describe("imported notes work as flashcards", () => {
    test("every note becomes the cards it should, in the deck of its tag", async () => {
        const text = await importedText("Flashcards/Imported/Spanish/Verbs/Verbs.md");
        const questions = await createTestNoteQuestionParser(settings).createQuestionList(
            new UnitTestSRFile(text),
            TextDirection.Ltr,
            TopicPath.emptyPath,
            true,
        );
        // The cloze note has two cards, the two other notes one each
        expect(questions.map((question) => question.questionType)).toEqual([
            CardType.Cloze,
            CardType.MultiLineBasic,
            CardType.MultiLineBasic,
        ]);
        expect(questions.map((question) => question.cards.length)).toEqual([2, 1, 1]);
        expect(questions[0].topicPathList.formatPsv()).toBe("#flashcards/Spanish/Verbs");
    });

    test("reviewing a card keeps the guid comments and does not disturb neighbouring cards", async () => {
        const text = await importedText("Flashcards/Imported/Spanish/Spanish.md");
        const guids = findGuids(text);
        expect(guids).toHaveLength(3);

        const c = await ReviewSessionContext.create(text, { settings });
        await c.sequencer.processReview(ReviewResponse.Good, 1000);
        // The schedule goes between the card and its guid comment
        expect(c.text).toMatch(/\(a greeting\)\n<!--SR:[^\n]+-->\n<!--anki:guid%2Dhola-->/);
        expect(findGuids(c.text)).toEqual(guids);
        expect(c.text.split("\n")[0]).toBe("#flashcards/Spanish #greetings #week1");

        // Review the rest: every card gets a schedule and no guid comment is lost or moved to another card
        while (c.sequencer.hasCurrentCard) {
            await c.sequencer.processReview(ReviewResponse.Good, 1000);
        }
        expect(findGuids(c.text)).toEqual(guids);
        // The reversed note is two cards with one comment: 3 notes, 4 cards
        expect(c.text.match(/<!--SR:/g)).toHaveLength(3);
        for (const guid of guids) {
            const comment = `<!--anki:${guid.replace(/-/g, "%2D")}-->`;
            const before = c.text.slice(0, c.text.indexOf(comment)).trimEnd().split("\n").pop();
            expect(before).toMatch(/^<!--SR:/);
        }
        // Reopened, the reviewed cards are scheduled and none is due today
        await c.reopen();
        expect(c.sequencer.hasCurrentCard).toBe(false);
    });

    test("a multi-line card with a schedule and a guid comment survives more reviews", async () => {
        const text = await importedText("Flashcards/Imported/Spanish/Spanish.md");
        const c = await ReviewSessionContext.create(text, { settings });
        await c.sequencer.processReview(ReviewResponse.Good, 1000);
        const afterFirst = c.text;
        // Rewriting the same card again must not duplicate its comments
        await c.reopen();
        expect(c.text).toBe(afterFirst);
        expect(afterFirst.match(/<!--anki:guid%2Dhola-->/g)).toHaveLength(1);
        expect(afterFirst.match(/hola\n\?\n/g)).toHaveLength(1);
    });
});
