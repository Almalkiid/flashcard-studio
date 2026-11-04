import { ReviewLogEntry } from "src/data/review-log/review-log-entry";

export interface TodayCounts {
    newDone: number;
    reviewsDone: number;
    /**
     * The cards counted as a review today, each with the time of the answer that counted. A card counts once a day
     * however often it is answered (D2 #4: an SM-2 card answered Again stays due and would count again).
     */
    reviewed?: Map<string, number>;
    /**
     * The cards introduced today, each with the time of its first answer as a new card. Answering such a card again
     * today is a learning step and spends no review, also when its schedule is a review one (D2 #4: an SM-2 card
     * answered Again on its first answer stays due today).
     */
    introduced?: Map<string, number>;
}

export interface DailyLimitSettings {
    dailyLimitsEnabled: boolean;
    newCardsPerDay: number;
    reviewsPerDay: number;
}

/**
 * Extra allowance granted for today by custom study's "increase today's limit".
 */
export interface ExtraAllowance {
    extraNew: number;
    extraReviews: number;
}

function countsAsNew(entry: ReviewLogEntry): boolean {
    return entry.n === 1 && entry.r !== 0 && entry.k !== 3;
}

function countsAsReview(entry: ReviewLogEntry): boolean {
    return entry.k === 1 && entry.r !== 0;
}

/**
 * Counts the new cards introduced and the reviews done since the start of today, from the review log of every
 * device. Learning and relearning steps, cram answers and manual resets do not count, as in Anki; nor does a review
 * answer to a card introduced earlier today.
 */
export function countToday(entries: ReviewLogEntry[], dayStartMs: number): TodayCounts {
    const counts: TodayCounts = {
        newDone: 0,
        reviewsDone: 0,
        reviewed: new Map(),
        introduced: new Map(),
    };
    // The new cards come first: the logs of several devices are not in time order, and a review answer given after
    // the card was introduced today is one of its learning steps, which is free
    const today = entries.filter((entry) => entry.t >= dayStartMs);
    for (const entry of today) {
        if (!countsAsNew(entry)) continue;
        counts.newDone++;
        const earlier = counts.introduced.get(entry.c);
        if (entry.c) counts.introduced.set(entry.c, Math.min(earlier ?? entry.t, entry.t));
    }
    for (const entry of today) {
        if (!countsAsReview(entry)) continue;
        const introduced = counts.introduced.get(entry.c);
        if (introduced !== undefined && introduced <= entry.t) continue;
        const counted = counts.reviewed.get(entry.c);
        // The logs of several devices are not in time order: the earliest answer is the one that counted
        if (counted !== undefined) counts.reviewed.set(entry.c, Math.min(counted, entry.t));
        else {
            counts.reviewsDone++;
            if (entry.c) counts.reviewed.set(entry.c, entry.t);
        }
    }
    return counts;
}

function monthKey(epochMs: number): string {
    const date = new Date(epochMs);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The review log months (`YYYY-MM`) that can hold entries for today. Two months when the day boundary means
 * "today" started in the previous month, e.g. at 02:00 on the 1st with the day starting at 04:00.
 */
export function monthsCovering(dayStartMs: number, nowMs: number): string[] {
    const first = monthKey(dayStartMs);
    const last = monthKey(nowMs);
    return first === last ? [first] : [first, last];
}

/**
 * Anki-style daily limits for new cards and reviews, shared by every deck.
 */
export class DailyLimits {
    private readonly settings: DailyLimitSettings;
    private counts: TodayCounts;
    private readonly extra: ExtraAllowance;
    private readonly reviewed: Map<string, number>;
    private readonly introduced: Map<string, number>;

    constructor(
        settings: DailyLimitSettings,
        counts: TodayCounts,
        extra: ExtraAllowance = { extraNew: 0, extraReviews: 0 },
    ) {
        this.settings = settings;
        this.counts = { newDone: counts.newDone, reviewsDone: counts.reviewsDone };
        this.reviewed = new Map(counts.reviewed);
        this.introduced = new Map(counts.introduced);
        this.extra = { ...extra };
    }

    /**
     * Whether the card has already been paid for today, by a review or by its introduction as a new card; answering it
     * again costs nothing.
     */
    countedToday(cardId: string | null): boolean {
        return !!cardId && (this.reviewed.has(cardId) || this.introduced.has(cardId));
    }

    remainingNew(): number {
        if (!this.settings.dailyLimitsEnabled) return Infinity;
        return Math.max(
            0,
            this.settings.newCardsPerDay + this.extra.extraNew - this.counts.newDone,
        );
    }

    remainingReviews(): number {
        if (!this.settings.dailyLimitsEnabled) return Infinity;
        return Math.max(
            0,
            this.settings.reviewsPerDay + this.extra.extraReviews - this.counts.reviewsDone,
        );
    }

    record(entry: ReviewLogEntry): void {
        if (countsAsNew(entry)) {
            this.counts.newDone++;
            if (entry.c && !this.introduced.has(entry.c)) this.introduced.set(entry.c, entry.t);
        } else if (countsAsReview(entry) && !this.countedToday(entry.c)) {
            this.counts.reviewsDone++;
            if (entry.c) this.reviewed.set(entry.c, entry.t);
        }
    }

    /** Takes back an answer that was undone; a repeat that did not count gives nothing back. */
    unrecord(entry: ReviewLogEntry): void {
        if (countsAsNew(entry)) {
            this.counts.newDone = Math.max(0, this.counts.newDone - 1);
            if (this.introduced.get(entry.c) === entry.t) this.introduced.delete(entry.c);
        } else if (countsAsReview(entry) && (!entry.c || this.reviewed.get(entry.c) === entry.t)) {
            this.counts.reviewsDone = Math.max(0, this.counts.reviewsDone - 1);
            this.reviewed.delete(entry.c);
        }
    }
}
