import { Card } from "src/data/data-structures/card/flashcard";
import { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { Deck } from "src/data/decks/deck";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import {
    CardDueDateHistogram,
    cardDueDayKey,
    DueDateHistogram,
    NoteDueDateHistogram,
} from "src/scheduling/due-histogram";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { DateUtil, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { clockAt } from "./fsrs/clock-at";
import { settingsOf } from "./sm2/grid";

const DAY = 86_400_000;

/** `YYYY-MM-DD` of the day `count` days after another (calendar arithmetic, the zone does not matter). */
function plusDays(day: string, count: number): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

const keysOf = (histogram: DueDateHistogram): Record<string, number> =>
    Object.fromEntries([...histogram.dueDatesMap].sort((a, b) => a[0] - b[0]));

/**
 * In some zones the clocks skip midnight (Beirut, Cairo, Santiago, Havana, the Azores): on that date the first instant is
 * 01:00. A date counts as a whole day all the same, so an item due on it is as many days away as the calendar says.
 * `skipped` is the date whose midnight does not exist; `today` is two or three days before it.
 */
export function testSkippedMidnight(zone: string, today: string, skipped: string): void {
    const days = Array.from({ length: 6 }, (_, index) => plusDays(today, index));
    const offsets = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };

    test("the environment is " + zone + " and the date really starts at 01:00", () => {
        const [year, month, date] = skipped.split("-").map(Number);
        expect(new Date(year, month - 1, date).getHours()).toBe(1);
        expect(DateUtil.dateStrToMoment(skipped).hour()).toBe(1);
    });

    test("notes due on six dates in a row, one of them without a midnight, fall on days 0 to 5", () => {
        setupStaticDateProvider(today);
        const deck = new NoteReviewDeck("#review");
        days.forEach((day, index) =>
            deck.scheduledNotes.push(
                new SchedNote(
                    { path: `n${index}.md` } as IVaultNoteFile,
                    DateUtil.dateStrToMoment(day).valueOf(),
                ),
            ),
        );
        const histogram = new NoteDueDateHistogram();
        histogram.calculateFromReviewDecksAndSort(new Map([["#review", deck]]), {
            pageranks: {},
        } as unknown as NoteLinkGraph);
        expect(keysOf(histogram)).toEqual(offsets);
    });

    test("SM-2 cards due on the same six dates fall on days 0 to 5", () => {
        setupStaticDateProvider(today);
        const root = new Deck("root", null);
        for (const day of days) {
            root.dueReviewItems.push(
                new Card({ scheduleInfo: Sm2State.fromDueDateStr(day, 1, 250) }),
            );
        }
        const histogram = new CardDueDateHistogram();
        histogram.calculateFromRoot(root);
        expect(keysOf(histogram)).toEqual(offsets);
        expect(days.map((day) => cardDueDayKey(Sm2State.fromDueDateStr(day, 1, 250)))).toEqual([
            0, 1, 2, 3, 4, 5,
        ]);
    });

    test("a card due on the date without a midnight, answered two days later, is two days late", () => {
        setupStaticDateProvider(plusDays(skipped, 2));
        const card = Sm2State.fromDueDateStr(skipped, 4, 270);
        expect(card.delayedBeforeReviewTicks).toBe(2 * DAY);
        // The bonus of two whole days: Good from 4 days, ease 270 gives (4 + 2 / 2) * 2.7 = 13.5, 14 days
        const answered = new Sm2Scheduler(settingsOf("defaults")).cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            card,
            new DueDateHistogram(),
        );
        expect(answered.interval).toBe(14);
    });

    test("an FSRS card due 23 hours later across the missing hour is due tomorrow, a minute more is the day after", () => {
        const [year, month, date] = skipped.split("-").map(Number);
        const evening = new Date(year, month - 1, date - 1, 22, 0).getTime();
        const schedule = (due: number) => new FsrsState(moment(due), 1, 5.5, 3, 2, 2, 0, 0, null);
        clockAt(new Date(evening).toISOString());
        expect(cardDueDayKey(schedule(evening + 23 * 3_600_000))).toBe(1);
        expect(cardDueDayKey(schedule(evening + 23 * 3_600_000 + 60_000))).toBe(2);
    });
}
