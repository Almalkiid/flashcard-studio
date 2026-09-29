import { Notice } from "obsidian";

import { unburyAllInText, unsuspendAllInText } from "src/data/card-meta";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import {
    setupStaticDateProvider20230906,
    setupStaticDateProviderOriginDatePlusDays,
} from "src/utils/dates";

import { ReviewSessionContext } from "../helpers/review-session-context";

// 2023-09-06 is "today" in these tests. A review-state FSRS card due 2023-09-02 with a 4 day interval.
const DUE_REVIEW = "!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z";
const DUE_REVIEW_7_LAPSES =
    "!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,20,7,0,2023-08-29T00:00:00.000Z";
const DUE_LEARNING = "!fsrs,2023-09-05T00:00:00.000Z,0,0.4,5.5,1,1,0,1,2023-09-05T00:00:00.000Z";

function idsIn(text: string): string[] {
    return [...text.matchAll(/id=([0-9a-z]{6})/g)].map((match) => match[1]);
}

beforeEach(() => {
    setupStaticDateProvider20230906();
});

describe("review log", () => {
    test("a new card answered Good logs a learn entry whose id is the one written to the note", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n");
        await c.sequencer.processReview(ReviewResponse.Good, 4200);

        expect(c.log.entries).toHaveLength(1);
        const entry = c.log.entries[0];
        expect(entry).toMatchObject({ r: 3, k: 0, n: 1, li: 0, ms: 4200, f: "CIA/Part1/Deck.md" });
        expect(entry.dk).toBe("flashcards");
        expect(idsIn(c.text)).toEqual([entry.c]);
        expect(entry.ivl).toBeGreaterThan(0);
        expect(entry.ivl).toBeLessThan(1);
        expect(entry.s).toBeGreaterThan(0);
        expect(entry.d).toBeGreaterThan(0);
        expect(c.sequencer.lastLoggedEntry).toBe(entry);
    });

    test("a due review card answered Again logs a review entry with the previous interval", async () => {
        const c = await ReviewSessionContext.create(`#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n`);
        await c.sequencer.processReview(ReviewResponse.Again, 1000);

        expect(c.log.entries[0]).toMatchObject({ r: 1, k: 1, li: 4 });
        expect(c.log.entries[0].n).toBeUndefined();
    });

    test("answer time is capped at 60 seconds", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n");
        await c.sequencer.processReview(ReviewResponse.Good, 5 * 60 * 1000);
        expect(c.log.entries[0].ms).toBe(60000);
    });

    test("resetting a due card logs a manual entry", async () => {
        const c = await ReviewSessionContext.create(`#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n`);
        await c.sequencer.processReview(ReviewResponse.Reset, 0);
        expect(c.log.entries[0]).toMatchObject({ r: 0, k: 4 });
    });

    test("resetting a new card changes nothing and logs nothing", async () => {
        const text = "#flashcards Q1::A1\n";
        const c = await ReviewSessionContext.create(text);
        await c.sequencer.processReview(ReviewResponse.Reset, 0);
        expect(c.log.entries).toHaveLength(0);
        expect(c.text).toBe(text);
        expect(c.sequencer.canUndo).toBe(false);
    });

    test("cram answers are logged as cram and do not touch the note", async () => {
        const text = `#flashcards Q1::A1 <!--SR:${DUE_REVIEW},id=abc123-->\n`;
        const c = await ReviewSessionContext.create(text, { mode: FlashcardReviewMode.Cram });
        await c.sequencer.processReview(ReviewResponse.Good, 900);

        expect(c.text).toBe(text);
        expect(c.log.entries[0]).toMatchObject({ c: "abc123", r: 3, k: 3, ms: 900 });
    });

    test("SM-2 answers are logged too", async () => {
        const c = await ReviewSessionContext.create(
            "#flashcards Q1::A1 <!--SR:!2023-09-02,4,270-->\n",
            {
                algorithm: SRAlgorithmType.SM_2_OSR,
            },
        );
        await c.sequencer.processReview(ReviewResponse.Good, 0);
        expect(c.log.entries[0]).toMatchObject({ r: 3, k: 1, li: 4 });
        expect(c.log.entries[0].s).toBeUndefined();
    });

    test("a failing log write does not interrupt the review", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n#flashcards Q2::A2\n");
        c.log.failAppends = true;

        await c.sequencer.processReview(ReviewResponse.Easy, 0);

        expect(c.currentFront).toBe("Q2");
        expect(errorSpy).toHaveBeenCalledTimes(1);
        errorSpy.mockRestore();
    });
});

describe("undo", () => {
    test("nothing to undo at the start of a session", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n");
        expect(c.sequencer.canUndo).toBe(false);
        expect(await c.sequencer.undoLastAnswer()).toBe(false);
    });

    test("undo restores the note, removes the log entry and shows the card again", async () => {
        const text = `#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n#flashcards Q2::A2 <!--SR:${DUE_REVIEW}-->\n`;
        const c = await ReviewSessionContext.create(text);
        expect(c.currentFront).toBe("Q1");

        await c.sequencer.processReview(ReviewResponse.Easy, 0);
        expect(c.currentFront).toBe("Q2");
        expect(c.sequencer.canUndo).toBe(true);

        expect(await c.sequencer.undoLastAnswer()).toBe(true);
        expect(c.currentFront).toBe("Q1");
        expect(c.log.entries).toHaveLength(0);
        expect(c.text).toBe(text);
        expect(c.sequencer.canUndo).toBe(false);
    });

    test("undo twice walks back two answers", async () => {
        const text = "#flashcards Q1::A1\n#flashcards Q2::A2\n#flashcards Q3::A3\n";
        const c = await ReviewSessionContext.create(text);
        await c.sequencer.processReview(ReviewResponse.Easy, 0);
        await c.sequencer.processReview(ReviewResponse.Easy, 0);
        expect(c.currentFront).toBe("Q3");

        expect(await c.sequencer.undoLastAnswer()).toBe(true);
        expect(c.currentFront).toBe("Q2");
        expect(await c.sequencer.undoLastAnswer()).toBe(true);
        expect(c.currentFront).toBe("Q1");
        expect(c.log.entries).toHaveLength(0);
        expect(c.text).toBe(text);
    });

    test("undo refuses when the note was edited after the answer", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n#flashcards Q2::A2\n");
        await c.sequencer.processReview(ReviewResponse.Easy, 0);
        const edited = "#flashcards Q1 rewritten elsewhere::A1\n#flashcards Q2::A2\n";
        c.file.content = edited;

        expect(await c.sequencer.undoLastAnswer()).toBe(false);
        expect(c.text).toBe(edited);
        expect(c.log.entries).toHaveLength(1);
        expect(c.currentFront).toBe("Q2");
    });

    test("undo of a learning step removes the card from the pending list", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n");
        await c.sequencer.processReview(ReviewResponse.Again, 0);
        expect(c.sequencer.hasPendingCards).toBe(true);

        expect(await c.sequencer.undoLastAnswer()).toBe(true);
        expect(c.sequencer.hasPendingCards).toBe(false);
        expect(c.currentFront).toBe("Q1");
        expect(c.text).toBe("#flashcards Q1::A1\n");
    });
});

describe("suspend, bury and flag", () => {
    test("a suspended card is written to the note and left out of later sessions", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n#flashcards Q2::A2\n");
        await c.sequencer.suspendCurrentCard();

        // By default the schedule comment goes on the line after the card
        expect(c.text).toMatch(/Q1::A1\n<!--SR:!fsrs,-,0,0,0,0,0,0,0,-,id=[0-9a-z]{6},susp-->/);
        expect(c.currentFront).toBe("Q2");

        await c.reopen();
        expect(c.currentFront).toBe("Q2");
    });

    test("suspended cards are excluded from cram sessions too", async () => {
        const text = `#flashcards Q1::A1 <!--SR:${DUE_REVIEW},id=aaaaaa,susp-->\n#flashcards Q2::A2\n`;
        const c = await ReviewSessionContext.create(text, { mode: FlashcardReviewMode.Cram });
        expect(c.currentFront).toBe("Q2");
    });

    test("a buried card comes back the next day", async () => {
        const c = await ReviewSessionContext.create(
            `#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n#flashcards Q2::A2\n`,
        );
        await c.sequencer.buryCurrentCard();
        expect(c.text).toContain(",bury=2023-09-07-->");

        await c.reopen();
        expect(c.currentFront).toBe("Q2");

        setupStaticDateProviderOriginDatePlusDays(1);
        await c.reopen();
        expect(c.currentFront).toBe("Q1");
    });

    test("flagging keeps the card current and in the queue", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n");
        await c.sequencer.setFlagCurrentCard(3);
        expect(c.text).toMatch(/,flag=3-->/);
        expect(c.currentFront).toBe("Q1");

        // A never-reviewed card with nothing left to store goes back to having no comment at all
        await c.sequencer.setFlagCurrentCard(0);
        expect(c.text).toBe("#flashcards Q1::A1\n");
    });

    test("suspending one new cloze keeps its siblings new and aligned", async () => {
        const c = await ReviewSessionContext.create("#flashcards\nQ ==a== ==b== ==c==\n", {
            settings: { burySiblingCards: false },
        });
        await c.sequencer.processReview(ReviewResponse.Reset, 0); // no-op on a new card, keeps order
        c.sequencer.skipCurrentCard();
        // Skipping removes the whole question from the session, so reopen and suspend the second card directly
        await c.reopen();
        const question = c.sequencer.currentQuestion;
        question.cards[1].meta.suspended = true;
        await question.writeQuestion(c.settings);

        const comment = c.text.match(/<!--SR:(.+?)-->/)[1];
        const segments = comment.split("!").filter((segment) => segment.length > 0);
        expect(segments).toHaveLength(3);
        expect(segments[0]).toBe("fsrs,-,0,0,0,0,0,0,0,-");
        expect(segments[1]).toMatch(/^fsrs,-,0,0,0,0,0,0,0,-,id=[0-9a-z]{6},susp$/);
        expect(segments[2]).toBe("fsrs,-,0,0,0,0,0,0,0,-");

        await c.reopen();
        const remaining: string[] = [];
        while (c.sequencer.hasCurrentCard) {
            remaining.push(c.currentFront);
            c.sequencer.skipCurrentCard();
            if (!c.sequencer.hasCurrentCard) break;
        }
        expect(remaining).toHaveLength(1);
    });

    test("a lapse that reaches the threshold marks and suspends a leech", async () => {
        const noticeSpy = Notice as unknown as jest.Mock;
        noticeSpy.mockClear();
        const c = await ReviewSessionContext.create(
            `#flashcards Q1::A1 <!--SR:${DUE_REVIEW_7_LAPSES}-->\n`,
        );
        await c.sequencer.processReview(ReviewResponse.Again, 0);

        expect(c.text).toMatch(/,leech-->/);
        expect(c.text).toMatch(/,susp,/);
        expect(noticeSpy).toHaveBeenCalled();
        expect(c.sequencer.hasPendingCards).toBe(false);
    });

    test("with the tag action a leech is marked but not suspended", async () => {
        const c = await ReviewSessionContext.create(
            `#flashcards Q1::A1 <!--SR:${DUE_REVIEW_7_LAPSES}-->\n`,
            { settings: { leechAction: "tag" } },
        );
        await c.sequencer.processReview(ReviewResponse.Again, 0);
        expect(c.text).toMatch(/,leech-->/);
        expect(c.text).not.toMatch(/susp/);
    });

    test("unsuspend and unbury only touch their own tokens inside SR comments", () => {
        const text =
            "susp stays in prose\nQ1::A1 <!--SR:!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,susp,flag=2-->\n" +
            "Q2::A2 <!--SR:!2023-09-02,4,270,id=bbbbbb,bury=2023-09-07!2000-01-01,1,250,susp-->\n";
        expect(unsuspendAllInText(text)).toBe(
            "susp stays in prose\nQ1::A1 <!--SR:!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,flag=2-->\n" +
                "Q2::A2 <!--SR:!2023-09-02,4,270,id=bbbbbb,bury=2023-09-07!2000-01-01,1,250-->\n",
        );
        expect(unburyAllInText(text)).toBe(
            "susp stays in prose\nQ1::A1 <!--SR:!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,susp,flag=2-->\n" +
                "Q2::A2 <!--SR:!2023-09-02,4,270,id=bbbbbb!2000-01-01,1,250,susp-->\n",
        );
    });
});

describe("daily limits", () => {
    test("new cards stop once the daily new limit is reached", async () => {
        const c = await ReviewSessionContext.create(
            "#flashcards Q1::A1\n#flashcards Q2::A2\n#flashcards Q3::A3\n",
            { limits: { newCardsPerDay: 1, reviewsPerDay: 100 } },
        );
        expect(c.currentFront).toBe("Q1");
        await c.sequencer.processReview(ReviewResponse.Easy, 0);

        expect(c.sequencer.hasCurrentCard).toBe(false);
        expect(c.limits.remainingNew()).toBe(0);
    });

    test("new cards introduced earlier today count against the limit", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n", {
            limits: {
                newCardsPerDay: 2,
                reviewsPerDay: 100,
                counts: { newDone: 2, reviewsDone: 0 },
            },
        });
        expect(c.sequencer.hasCurrentCard).toBe(false);
    });

    test("deck stats are clamped to the remaining allowance", async () => {
        const c = await ReviewSessionContext.create(
            `#flashcards Q1::A1\n#flashcards Q2::A2\n#flashcards Q3::A3 <!--SR:${DUE_REVIEW}-->\n`,
            { limits: { newCardsPerDay: 1, reviewsPerDay: 0 } },
        );
        const stats = c.sequencer.getDeckStats(c.sequencer.originalDeckTree.getTopicPath());
        expect(stats.newCount).toBe(1);
        expect(stats.dueCount).toBe(0);
    });

    test("learning cards are not limited by the review limit", async () => {
        const c = await ReviewSessionContext.create(
            `#flashcards L1::A1 <!--SR:${DUE_LEARNING}-->\n#flashcards R1::A1 <!--SR:${DUE_REVIEW}-->\n`,
            { limits: { newCardsPerDay: 0, reviewsPerDay: 0 } },
        );
        expect(c.currentFront).toBe("L1");
    });

    test("undo gives the allowance back", async () => {
        const c = await ReviewSessionContext.create("#flashcards Q1::A1\n#flashcards Q2::A2\n", {
            limits: { newCardsPerDay: 1, reviewsPerDay: 100 },
        });
        await c.sequencer.processReview(ReviewResponse.Easy, 0);
        expect(c.limits.remainingNew()).toBe(0);
        await c.sequencer.undoLastAnswer();
        expect(c.limits.remainingNew()).toBe(1);
        expect(c.currentFront).toBe("Q1");
    });
});
