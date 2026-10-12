import type { Moment } from "moment";
import { Notice } from "obsidian";
import { State } from "ts-fsrs";

import { t } from "src/lang/translate";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { removalConfirmation } from "src/scheduling/review/review-session";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { UndoResult } from "src/scheduling/undo-history";
import { globalDateProvider } from "src/utils/clock";

import { clockAt } from "../fsrs/clock-at";
import { Session, SessionOptions } from "./session";

const SM2 = { algorithm: SchedulerKind.SM2 };
const notices = Notice as unknown as jest.Mock;

const open = (text: string, options: SessionOptions = {}) => Session.open(text, options);

beforeEach(() => {
    clockAt("2023-09-06T00:00:00.000Z");
    notices.mockClear();
});

afterEach(() => {
    jest.restoreAllMocks();
});

function quietly(): void {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("learn ahead (the owner's tests, re-created)", () => {
    test("with nothing else left, a pending card due within the limit is shown now", async () => {
        const c = await open("#flashcards A::a <!--SR:!2023-09-02,4,270-->\n");
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.reviewSession.hasCurrentCard).toBe(false);
        expect(c.reviewSession.nextPendingDueUnix).toBe(Date.parse("2023-09-06T00:10:00.000Z"));

        // Five minutes ahead does not reach it, so it keeps waiting
        expect(c.reviewSession.learnAhead(5 * 60 * 1000)).toBe(false);
        expect(c.reviewSession.hasPendingCards).toBe(true);

        // Anki's default of twenty minutes does
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(true);
        expect(c.front).toBe("A");
        expect(c.reviewSession.hasPendingCards).toBe(false);
    });

    test("learn ahead never puts a pending card before cards still in the queue", async () => {
        const c = await open(
            "#flashcards A::a <!--SR:!2023-09-02,4,270-->\n#flashcards B::b <!--SR:!2023-09-02,4,270-->\n",
        );
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.front).toBe("B");
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(true);
        expect(c.front).toBe("B");
        expect(c.reviewSession.hasPendingCards).toBe(true);
    });

    test("with nothing waiting there is nothing to learn ahead", async () => {
        const c = await open("#flashcards A::a\n");
        await c.reviewSession.processReview(ReviewResponse.Easy);
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(false);
        expect(c.reviewSession.nextPendingDueUnix).toBeNull();
        expect(c.reviewSession.hasDuePendingCards).toBe(false);
    });
});

describe("D2 #1: an overdue SM-2 card gets its bonus when answered in a session", () => {
    test.each([
        [ReviewResponse.Easy, "!2023-10-06,30,290"],
        [ReviewResponse.Good, "!2023-09-22,16,270"],
        [ReviewResponse.Hard, "!2023-09-09,3,250"],
    ])("response %s gives %s (was 15 / 11 / 2 days)", async (response, segment) => {
        const c = await open(
            "#flashcards Q1::A1\n#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->\n#flashcards Q3::A3\n",
            SM2,
        );
        expect(c.front).toBe("Q2");
        await c.reviewSession.processReview(response);
        expect(c.text).toContain(`Q2::A2\n<!--SR:${segment},id=`);
        expect(c.front).toBe("Q1");
    });
});

describe("D2 #2: an answer the note can no longer take is not saved, logged, counted or undoable", () => {
    test("the user is told, the card keeps its schedule and the question leaves the session", async () => {
        quietly();
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", {
            limits: { newCardsPerDay: 5, reviewsPerDay: 5 },
        });
        const card = c.reviewSession.currentCard;
        c.text = "#flashcards Q1 edited::A1\n#flashcards Q2::A2\n";

        await c.reviewSession.processReview(ReviewResponse.Good, 1200);

        expect(c.text).toBe("#flashcards Q1 edited::A1\n#flashcards Q2::A2\n");
        expect(card.scheduleInfo).toBeNull();
        expect(card.meta.id).toBeNull();
        expect(c.log.entries).toEqual([]);
        expect(c.reviewSession.lastLoggedEntry).toBeNull();
        expect(c.limits.remainingNew()).toBe(5);
        expect(c.reviewSession.canUndo).toBe(false);
        expect(Object.fromEntries(c.histogram.dueDatesMap)).toEqual({});
        expect(c.reviewSession.hasPendingCards).toBe(false);
        expect(notices.mock.calls).toEqual([[t("ANSWER_NOT_SAVED_NOTE_CHANGED")]]);
        expect((notices.mock.calls as string[][])[0][0]).toBe(
            "Couldn't save this answer: the note changed. Review it again.",
        );
        expect(c.front).toBe("Q2");
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Nothing);
    });

    test("an answer that logs nothing leaves no entry from an earlier answer to report", async () => {
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n");
        await c.reviewSession.processReview(ReviewResponse.Easy);
        expect(c.reviewSession.lastLoggedEntry).not.toBeNull();
        await c.reviewSession.processReview(ReviewResponse.Reset); // a card never reviewed: nothing happens
        expect(c.reviewSession.lastLoggedEntry).toBeNull();
    });

    test("a suspend or a flag the note can no longer take is undone in memory and reported", async () => {
        quietly();
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n");
        c.text = "#flashcards Q1 edited::A1\n#flashcards Q2::A2\n";

        await c.reviewSession.suspendCurrentCard();
        expect(c.reviewSession.currentCard.meta.suspended).toBe(false);
        expect(c.front).toBe("Q1");
        await c.reviewSession.setFlagCurrentCard(2);
        expect(c.reviewSession.currentCard.meta.flag).toBe(0);
        expect(c.text).toBe("#flashcards Q1 edited::A1\n#flashcards Q2::A2\n");
        expect(notices.mock.calls).toEqual([
            [t("CHANGE_NOT_SAVED_NOTE_CHANGED")],
            [t("CHANGE_NOT_SAVED_NOTE_CHANGED")],
        ]);
    });

    test("an edit the note can no longer take changes neither the note nor the card", async () => {
        quietly();
        const c = await open("#flashcards Q1::A1\n");
        c.text = "#flashcards Q1 edited::A1\n";
        await c.reviewSession.updateCurrentQuestionTextAndCards("Q9::A9");
        expect(c.text).toBe("#flashcards Q1 edited::A1\n");
        expect(c.front).toBe("Q1");
        expect(c.reviewSession.currentQuestion.questionText.actualQuestion).toBe("Q1::A1");
        expect(notices.mock.calls).toEqual([[t("CHANGE_NOT_SAVED_NOTE_CHANGED")]]);
    });
});

describe("D2 #4: daily limits", () => {
    test("an SM-2 card answered Again twice spends one review and stays in the session", async () => {
        const c = await open("#flashcards Q1::A1 <!--SR:!2023-09-02,4,270-->\n", {
            ...SM2,
            limits: { newCardsPerDay: 20, reviewsPerDay: 2 },
        });
        await c.reviewSession.processReview(ReviewResponse.Again);
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.log.entries.map((entry) => entry.k)).toEqual([1, 1]);
        expect(c.limits.remainingReviews()).toBe(1);
        expect(c.front).toBe("Q1");
        expect(c.reviewSession.getDeckStats(c.topicPath).dueCount).toBe(1);
    });

    test("with the review allowance spent, the card still failed today is not dropped", async () => {
        const c = await open("#flashcards Q1::A1 <!--SR:!2023-09-02,4,270-->\n", {
            ...SM2,
            limits: { newCardsPerDay: 20, reviewsPerDay: 1 },
        });
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.limits.remainingReviews()).toBe(0);
        expect(c.front).toBe("Q1");
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.reviewSession.hasCurrentCard).toBe(false);
    });

    test("an FSRS card answered after a Reset spends the new-card allowance", async () => {
        const c = await open(
            "#flashcards Q1::A1 <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z-->\n",
            { limits: { newCardsPerDay: 5, reviewsPerDay: 5 } },
        );
        await c.reviewSession.processReview(ReviewResponse.Reset);
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.log.entries[1]).toMatchObject({ r: 3, k: 0, n: 1 });
        expect(c.limits.remainingNew()).toBe(4);
        expect(c.limits.remainingReviews()).toBe(5);
    });
});

describe("D2 #7: a deleted question's waiting cards never come back", () => {
    test("the cloze answered into a learning step goes with its question", async () => {
        const c = await open(
            "#flashcards\nThe ==alpha== and ==beta== cards\n#flashcards Other::x\n",
            {
                settings: { burySiblingCards: false },
            },
        );
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.reviewSession.hasPendingCards).toBe(true);

        await c.reviewSession.deleteCurrentCardFromNote();
        expect(c.reviewSession.hasPendingCards).toBe(false);
        clockAt("2023-09-07T00:00:00.000Z");
        c.reviewSession.refreshCurrentDeck();
        expect(c.reviewSession.hasCurrentCard).toBe(false);
    });
});

describe("D2 #13: cards due at the same time wake in the order they were answered", () => {
    test("A, B and C come back as A, B, C", async () => {
        const c = await open("#flashcards A::a\n#flashcards B::b\n#flashcards C::c\n");
        for (let i = 0; i < 3; i++) await c.reviewSession.processReview(ReviewResponse.Good);
        clockAt("2023-09-07T00:00:00.000Z");
        c.reviewSession.refreshCurrentDeck();
        const order: string[] = [];
        while (c.reviewSession.hasCurrentCard) {
            order.push(c.front);
            c.reviewSession.skipCurrentCard();
        }
        expect(order).toEqual(["A", "B", "C"]);
    });
});

describe("D2 #22: an edit is checked before it is written", () => {
    test("an edit that changes the number of clozes is refused and the note is left alone", async () => {
        const text = "\n#flashcards This single ==question== turns into ==3 separate== ==cards==\n";
        const c = await open(text, SM2);
        const front = c.front;
        await c.reviewSession.updateCurrentQuestionTextAndCards(
            "This single ==question== turns into 2 separate ==cards==",
        );
        expect(c.text).toBe(text);
        expect(c.front).toBe(front);
        expect(notices.mock.calls).toEqual([[t("EDIT_CHANGES_CARD_COUNT")]]);

        // The answer is written to the question as it is in the note
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.text).toMatch(
            /^\n#flashcards This single ==question== turns into ==3 separate== ==cards==\n<!--SR:!2023-09-09,3,250,id=[0-9a-z]+!2000-01-01,1,250!2000-01-01,1,250-->\n$/,
        );
    });

    test("an edit with the same number of cards is written and redrawn", async () => {
        const c = await open("#flashcards Q1::A1\n", SM2);
        await c.reviewSession.updateCurrentQuestionTextAndCards("Q2::A2");
        expect(c.text).toBe("#flashcards Q2::A2\n");
        expect(c.front).toBe("Q2");
        expect(c.reviewSession.currentCard.back).toBe("A2");
    });
});

describe("D3 #9: the card just answered is not shown again while another card can be", () => {
    test("an SM-2 Again waits behind the other cards", async () => {
        const c = await open(
            "#flashcards Q1::A1\n#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->\n#flashcards Q3::A3\n",
            SM2,
        );
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.front).toBe("Q1");
        expect(c.queueFronts()).toEqual(["Q2", "Q1", "Q3"]);
        await c.reviewSession.processReview(ReviewResponse.Easy);
        expect(c.front).toBe("Q2");
    });

    test("a card alone comes straight back", async () => {
        const c = await open("#flashcards Q1::A1\n", SM2);
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.front).toBe("Q1");
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.front).toBe("Q1");
    });

    test("of the cards woken by learn ahead, the one just answered goes second", async () => {
        const c = await open("#flashcards A::a\n#flashcards B::b\n");
        await c.reviewSession.processReview(ReviewResponse.Good); // A waits 10 minutes
        await c.reviewSession.processReview(ReviewResponse.Again); // B waits 1 minute
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(true);
        expect(c.front).toBe("A");
        c.reviewSession.skipCurrentCard();
        expect(c.front).toBe("B");
    });

    test("in cram, a card sent to the back waits behind the others", async () => {
        const c = await open(
            "#flashcards Q1::A1 <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z-->\n#flashcards Q2::A2\n",
            { mode: FlashcardReviewMode.Cram },
        );
        expect(c.front).toBe("Q1");
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.front).toBe("Q2");
        await c.reviewSession.processReview(ReviewResponse.Easy);
        expect(c.front).toBe("Q1");
    });

    test("undo shows the undone card even though it was just answered", async () => {
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", SM2);
        await c.reviewSession.processReview(ReviewResponse.Again);
        expect(c.front).toBe("Q2");
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
        expect(c.front).toBe("Q1");
    });
});

describe("D5b: undo takes the answer's buried siblings back off the buried-cards list", () => {
    test("the list is as before the answer, and is saved", async () => {
        const c = await open(
            "#flashcards This single ==question== turns into ==3 separate== ==cards==\n\n#flashcards Q1::A1\n",
            { ...SM2, settings: { burySiblingCards: true } },
        );
        const write = jest.spyOn(c.buriedCards, "write");
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.buriedCards.list).toHaveLength(1);
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
        expect(c.buriedCards.list).toEqual([]);
        expect(write).toHaveBeenCalledTimes(2);
    });

    test("a question already on the list before the answer stays on it", async () => {
        const c = await open(
            "#flashcards This single ==question== turns into ==3 separate== ==cards==\n\n#flashcards Q1::A1\n",
            { ...SM2, settings: { burySiblingCards: true } },
        );
        await c.reviewSession.processReview(ReviewResponse.Again); // buries the siblings, the card comes back later
        expect(c.buriedCards.list).toHaveLength(1);
        expect(c.front).toBe("Q1");
        c.reviewSession.skipCurrentCard();
        await c.reviewSession.processReview(ReviewResponse.Good); // the same cloze again, its question already listed
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
        expect(c.buriedCards.list).toHaveLength(1);
    });
});

describe("P3-R6 and the histogram hand-off: SM-2 days follow the study day", () => {
    const FOUR_AM = { hour: 4, minute: 0, second: 0 };

    test("at 02:00 with a day that starts at 04:00, a card due that date is not due yet", async () => {
        clockAt("2023-09-07T02:00:00.000Z");
        globalDateProvider.setDayBoundary(FOUR_AM);
        const c = await open("#flashcards Q1::A1 <!--SR:!2023-09-07,4,270-->\n", SM2);
        expect(c.reviewSession.hasCurrentCard).toBe(false);

        clockAt("2023-09-07T04:00:00.000Z");
        globalDateProvider.setDayBoundary(FOUR_AM);
        await c.reopen();
        expect(c.front).toBe("Q1");
    });

    test("an answer moves the card's histogram day counted from the start of the study day", async () => {
        clockAt("2023-09-07T02:00:00.000Z");
        globalDateProvider.setDayBoundary(FOUR_AM);
        const c = await open("#flashcards Q1::A1 <!--SR:!2023-09-06,4,270-->\n", SM2);
        expect(Object.fromEntries(c.histogram.dueDatesMap)).toEqual({ 0: 1 });
        await c.reviewSession.processReview(ReviewResponse.Good);
        // Due 2023-09-17: 11 days from the study day of 6 September; counted from now it would be day 10
        expect(c.text).toContain("!2023-09-17,11,270");
        expect(Object.fromEntries(c.histogram.dueDatesMap)).toEqual({ 0: 0, 11: 1 });
    });
});

describe("deck stats: what today's limits hold back (for the 'hidden by today's limit' message)", () => {
    test("the cards over each allowance are counted, and are not in the new and due counts", async () => {
        const c = await open(
            "#flashcards Q1::A1\n#flashcards Q2::A2\n#flashcards Q3::A3\n" +
                "#flashcards R1::A <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z-->\n" +
                "#flashcards R2::A <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z-->\n" +
                "#flashcards L1::A <!--SR:!fsrs,2023-09-05T00:00:00.000Z,0,0.4,5.5,1,1,0,1,2023-09-05T00:00:00.000Z-->\n",
            { limits: { newCardsPerDay: 1, reviewsPerDay: 1 } },
        );
        const stats = c.reviewSession.getDeckStats(c.topicPath);
        expect(stats).toMatchObject({
            newCount: 1,
            newHiddenByLimitCount: 2,
            dueCount: 2, // the learning card and one review
            dueHiddenByLimitCount: 1,
            cardsInQueueCount: 3,
        });
    });

    test("without limits nothing is held back", async () => {
        const c = await open("#flashcards Q1::A1\n");
        expect(c.reviewSession.getDeckStats(c.topicPath)).toMatchObject({
            newHiddenByLimitCount: 0,
            dueHiddenByLimitCount: 0,
        });
    });
});

describe("§10.7: a learning card whose step has no readable due time stays pending", () => {
    function learningWithout(due: Moment | null): FsrsState {
        return new FsrsState(due, 0, 5, 1, State.Learning, 1, 0, 1, null);
    }

    // A step with no due time is written as "-"; an invalid one cannot be written at all, so it never gets this far
    test("pending with a NaN next time, never woken, nothing to learn ahead", async () => {
        const c = await open("#flashcards A::a\n#flashcards B::b\n");
        jest.spyOn(c.reviewSession, "determineCardSchedule").mockReturnValueOnce(
            learningWithout(null),
        );
        await c.reviewSession.processReview(ReviewResponse.Good);

        expect(c.text).toContain("A::a\n<!--SR:!fsrs,-,0,1,5,1,1,0,1,-,id=");
        expect(c.reviewSession.hasPendingCards).toBe(true);
        expect(c.reviewSession.nextPendingDueUnix).toBeNaN();
        expect(c.reviewSession.hasDuePendingCards).toBe(false);
        // No day to count it on: the histogram is left as it was, and undo has nothing to take back there
        expect(Object.fromEntries(c.histogram.dueDatesMap)).toEqual({});
        expect(c.front).toBe("B");
        c.reviewSession.skipCurrentCard();
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(false);
        clockAt("2023-09-08T00:00:00.000Z");
        c.reviewSession.refreshCurrentDeck();
        expect(c.reviewSession.hasCurrentCard).toBe(false);
        expect(c.reviewSession.hasPendingCards).toBe(true);
    });

    test("a dated card waiting beside it is still learned ahead", async () => {
        const c = await open("#flashcards A::a\n#flashcards B::b\n");
        jest.spyOn(c.reviewSession, "determineCardSchedule").mockReturnValueOnce(
            learningWithout(null),
        );
        await c.reviewSession.processReview(ReviewResponse.Good); // A, undated
        await c.reviewSession.processReview(ReviewResponse.Good); // B, due in 10 minutes
        expect(c.reviewSession.learnAhead(20 * 60 * 1000)).toBe(true);
        expect(c.front).toBe("B");
        expect(c.reviewSession.nextPendingDueUnix).toBeNaN();
    });
});

describe("final review: undo reads and writes the note in one step", () => {
    const noReadWrite = (c: Session) => {
        const boom = () => {
            throw new Error("a separate read or write is not atomic");
        };
        (c.vault.vault as unknown as Record<string, unknown>).read = boom;
        (c.vault.vault as unknown as Record<string, unknown>).modify = boom;
    };

    test("the note is restored through one edit, with no separate read and write", async () => {
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", SM2);
        await c.reviewSession.processReview(ReviewResponse.Good);
        noReadWrite(c);
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
        expect(c.text).toBe("#flashcards Q1::A1\n#flashcards Q2::A2\n");
    });

    test("the questions after an undone answer are still found, and written in the right place", async () => {
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n#flashcards Q3::A3\n", SM2);
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
        c.reviewSession.skipCurrentCard();
        await c.reviewSession.processReview(ReviewResponse.Good);
        expect(c.text).toMatch(
            /^#flashcards Q1::A1\n#flashcards Q2::A2\n<!--SR:![\d-]+,\d+,\d+,id=\w+-->\n#flashcards Q3::A3\n$/,
        );
    });

    test("a note that no longer holds the question: the notice, nothing written, no crash", async () => {
        quietly();
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", SM2);
        await c.reviewSession.processReview(ReviewResponse.Good);
        c.text = "#flashcards Q1 edited::A1\n#flashcards Q2::A2\n";
        notices.mockClear();
        expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Failed);
        expect(c.text).toBe("#flashcards Q1 edited::A1\n#flashcards Q2::A2\n");
        expect(notices.mock.calls).toEqual([[t("UNDO_FAILED_NOTE_CHANGED")]]);
    });
});

describe("final review: removing a card", () => {
    test("a note that changed since the card was read: the notice, and the card stays in the session", async () => {
        quietly();
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", SM2);
        c.text = "#flashcards Q1 edited::A1\n#flashcards Q2::A2\n";
        notices.mockClear();

        expect(await c.reviewSession.deleteCurrentCardFromNote()).toBe(false);

        expect(notices.mock.calls).toEqual([[t("CHANGE_NOT_SAVED_NOTE_CHANGED")]]);
        expect(c.text).toBe("#flashcards Q1 edited::A1\n#flashcards Q2::A2\n");
        expect(c.front).toBe("Q1");
        expect(c.queueFronts()).toEqual(["Q1", "Q2"]);
    });

    test("a removed card goes from the note and the session, and says so", async () => {
        const c = await open("#flashcards Q1::A1\n#flashcards Q2::A2\n", SM2);
        expect(await c.reviewSession.deleteCurrentCardFromNote()).toBe(true);
        expect(c.text).toBe("\n#flashcards Q2::A2\n");
        expect(c.front).toBe("Q2");
    });

    test("the confirmation names the whole question when it has more than one card", async () => {
        const c = await open("#flashcards The ==alpha== and ==beta== cards\n", SM2);
        expect(removalConfirmation(c.reviewSession.currentQuestion)).toBe(
            t("DELETE_QUESTION_CONFIRMATION", { count: 2 }),
        );
        expect(t("DELETE_QUESTION_CONFIRMATION", { count: 2 })).toContain("2 cards");
        const single = await open("#flashcards Q1::A1\n", SM2);
        expect(removalConfirmation(single.reviewSession.currentQuestion)).toBe(
            t("DELETE_CARD_CONFIRMATION"),
        );
    });
});
