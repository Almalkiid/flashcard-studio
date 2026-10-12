import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { ActivitySummary, streaks, summarizeEntries } from "src/stats/activity";
import { DayKeyFn } from "src/stats/day-keys";

export interface SessionSummary extends ActivitySummary {
    /** Consecutive study days up to today. */
    streak: number;
}

/**
 * What to show when a review session ends: the answers given since it started, and the streak they extend.
 *
 * @param entries - The review log, from every device.
 * @param sessionStartMs - When the session started; answers before that belong to earlier sessions.
 */
export function buildSessionSummary(
    entries: ReviewLogEntry[],
    sessionStartMs: number,
    todayKey: string,
    dayKeyOf: DayKeyFn,
): SessionSummary {
    const answered = entries.filter((entry) => entry.t >= sessionStartMs);
    return {
        ...summarizeEntries(answered),
        streak: streaks(entries, todayKey, dayKeyOf).current,
    };
}
