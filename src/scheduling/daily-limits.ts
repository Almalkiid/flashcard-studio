import { ReviewLogEntry } from "src/data/review-log/review-log-entry";

export interface TodayCounts {
    newDone: number;
    reviewsDone: number;
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
 * device. Learning and relearning steps, cram answers and manual resets do not count, as in Anki.
 */
export function countToday(entries: ReviewLogEntry[], dayStartMs: number): TodayCounts {
    const counts: TodayCounts = { newDone: 0, reviewsDone: 0 };
    for (const entry of entries) {
        if (entry.t < dayStartMs) continue;
        if (countsAsNew(entry)) counts.newDone++;
        else if (countsAsReview(entry)) counts.reviewsDone++;
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

    constructor(
        settings: DailyLimitSettings,
        counts: TodayCounts,
        extra: ExtraAllowance = { extraNew: 0, extraReviews: 0 },
    ) {
        this.settings = settings;
        this.counts = { ...counts };
        this.extra = { ...extra };
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
        if (countsAsNew(entry)) this.counts.newDone++;
        else if (countsAsReview(entry)) this.counts.reviewsDone++;
    }

    unrecord(entry: ReviewLogEntry): void {
        if (countsAsNew(entry)) this.counts.newDone = Math.max(0, this.counts.newDone - 1);
        else if (countsAsReview(entry))
            this.counts.reviewsDone = Math.max(0, this.counts.reviewsDone - 1);
    }
}
