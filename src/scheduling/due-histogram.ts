import type { Card } from "src/data/data-structures/card/flashcard";
import type { Deck } from "src/data/decks/deck";
import { TICKS_PER_DAY } from "src/data/formats";
import type { NoteReviewDeck } from "src/note-review/note-review-deck";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { globalDateProvider, wallClockMs } from "src/utils/clock";

/**
 * The study day an item falls on, as days from `fromUnix`: whole days, with a part of a day counting as a day, so
 * 0 is due by then and 1 is due by the end of the day after. Counted on the wall clock, so the two nights a year
 * when the clocks change do not move an item to the day before or after, and a date whose midnight the clocks skip
 * still counts as one whole day.
 */
export function dueDayKey(dueUnix: number, fromUnix: number): number {
    // "+ 0" turns the -0 of a due time a little before the start into a plain 0
    return Math.ceil((wallClockMs(dueUnix) - wallClockMs(fromUnix)) / TICKS_PER_DAY) + 0;
}

/**
 * The key of a card's due day. An SM-2 due is a calendar date, so it is counted from the start of today's study day
 * (before the day boundary that is still yesterday); an FSRS due is an instant, counted from now. The review session uses
 * this for the same keys when it moves a card from one day to another.
 */
export function cardDueDayKey(
    schedule: ScheduleState,
    nowUnix: number = globalDateProvider.now.valueOf(),
    todayUnix: number = globalDateProvider.today.valueOf(),
): number {
    const from = schedule.algorithmType === SchedulerKind.SM2 ? todayUnix : nowUnix;
    return dueDayKey(schedule.dueDateAsUnix, from);
}

/**
 * How many items fall due on each day, keyed by days from today (negative: overdue). SM-2 load balancing reads it to
 * find a quiet day for the next review; whoever stores an answer keeps it up to date.
 */
export class DueDateHistogram {
    /** The key of the items that are due now. */
    static readonly dueNowNDays = 0;

    dueDatesMap: Map<number, number> = new Map();

    /** @param counts - Days to counts to start from; keys may be text, as in an object literal. */
    constructor(counts: Record<number, number> | null = null) {
        for (const [days, count] of Object.entries(counts ?? {})) {
            this.dueDatesMap.set(Number(days), count);
        }
    }

    /** How many items are due now. */
    get dueNotesCount(): number {
        return this.dueDatesMap.get(DueDateHistogram.dueNowNDays) ?? 0;
    }

    /** True when the day has an entry, even a count of 0. */
    hasEntryForDays(days: number): boolean {
        return this.dueDatesMap.has(days);
    }

    get(days: number): number | undefined {
        return this.dueDatesMap.get(days);
    }

    increment(days: number): void {
        this.dueDatesMap.set(days, (this.dueDatesMap.get(days) ?? 0) + 1);
    }

    /** One fewer on the day, never below 0, and no entry is made for a day that has none. */
    decrement(days: number): void {
        const count = this.dueDatesMap.get(days);
        if (count !== undefined && count > 0) this.dueDatesMap.set(days, count - 1);
    }

    /**
     * The day within `fuzz` days of `originalInterval` with the fewest items, for spreading reviews. A day with no
     * entry is as quiet as a day can be and is taken at once; otherwise a day wins only by being strictly quieter than
     * the best so far, so the original day wins ties and the day before is tried before the day after. A day with no
     * entry at the original interval is already free and stays.
     */
    findLeastUsedIntervalOverRange(originalInterval: number, fuzz: number): number {
        const original = this.dueDatesMap.get(originalInterval);
        if (original === undefined) return originalInterval;

        let best = originalInterval;
        let bestCount = original;
        for (let i = 1; i <= fuzz; i++) {
            for (const candidate of [originalInterval - i, originalInterval + i]) {
                const count = this.dueDatesMap.get(candidate);
                if (count === undefined) return candidate;
                if (count < bestCount) {
                    best = candidate;
                    bestCount = count;
                }
            }
        }
        return best;
    }
}

/** The notes' due days, counted from the start of today's study day. */
export class NoteDueDateHistogram extends DueDateHistogram {
    /**
     * Counts every scheduled note once per review deck it is in. As a side effect, which the note list depends on, it
     * orders each deck: new notes by page rank, scheduled notes by due time and then page rank, highest rank first.
     */
    calculateFromReviewDecksAndSort(
        reviewDecks: Map<string, NoteReviewDeck>,
        noteLinkGraph: NoteLinkGraph,
    ): void {
        this.dueDatesMap.clear();
        const today = globalDateProvider.today.valueOf();
        for (const reviewDeck of reviewDecks.values()) {
            for (const scheduledNote of reviewDeck.scheduledNotes) {
                this.increment(dueDayKey(scheduledNote.dueUnix, today));
            }
            reviewDeck.sortNotesByDateAndImportance(noteLinkGraph.pageranks);
        }
    }
}

/** The cards' due days, counted as `cardDueDayKey` does. */
export class CardDueDateHistogram extends DueDateHistogram {
    /**
     * Counts every card with a schedule in the tree (suspended, buried and not yet due ones too), once even when it is
     * in several decks. A learning step due in ten minutes is on day 1, not day 0.
     */
    calculateFromRoot(deckRoot: Deck): void {
        this.dueDatesMap.clear();
        const now = globalDateProvider.now.valueOf();
        const today = globalDateProvider.today.valueOf();
        const seen = new Set<Card>();
        const visit = (deck: Deck): void => {
            for (const cards of [deck.newReviewItems, deck.dueReviewItems]) {
                for (const card of cards) {
                    if (seen.has(card) || !card.hasSchedule) continue;
                    seen.add(card);
                    this.increment(cardDueDayKey(card.scheduleInfo, now, today));
                }
            }
            deck.subdecks.forEach(visit);
        };
        visit(deckRoot);
    }
}
