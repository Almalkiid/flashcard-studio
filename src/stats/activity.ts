import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { addDays, DayKeyFn, dayKeyRange, diffDays, weekdayOf } from "src/stats/day-keys";

/**
 * Whether an entry is an answer to a card. Manual resets and reschedules are recorded in the log too but are not
 * reviews. Cram answers are reviews: the user studied the card.
 */
export function isReview(entry: ReviewLogEntry): boolean {
    return entry.r !== 0 && entry.k !== 4;
}

/**
 * Whether the answer introduced a new card. Same definition as the daily limits (`countToday`): learning steps, cram
 * answers and manual resets do not count.
 */
function introducedNewCard(entry: ReviewLogEntry): boolean {
    return entry.n === 1 && entry.r !== 0 && entry.k !== 3;
}

/**
 * @property {number} reviews - Answers given, of any kind.
 * @property {number} newLearned - New cards introduced.
 * @property {number} timeMs - Time spent answering.
 * @property {number} again - Answers that were Again.
 * @property {number | null} retention - Share of answers to review cards that were not Again, null without any.
 * @property {number[]} ratings - Answers per button: Again, Hard, Good, Easy.
 */
export interface ActivitySummary {
    reviews: number;
    newLearned: number;
    timeMs: number;
    again: number;
    retention: number | null;
    ratings: number[];
}

/**
 * Summarizes a set of entries. Used for one day and for one review session.
 */
export function summarizeEntries(entries: ReviewLogEntry[]): ActivitySummary {
    const summary: ActivitySummary = {
        reviews: 0,
        newLearned: 0,
        timeMs: 0,
        again: 0,
        retention: null,
        ratings: [0, 0, 0, 0],
    };
    let reviewAnswers = 0;
    let reviewPasses = 0;

    for (const entry of entries) {
        if (!isReview(entry)) continue;
        summary.reviews++;
        summary.timeMs += entry.ms;
        summary.ratings[entry.r - 1]++;
        if (entry.r === 1) summary.again++;
        if (introducedNewCard(entry)) summary.newLearned++;
        if (entry.k === 1) {
            reviewAnswers++;
            if (entry.r > 1) reviewPasses++;
        }
    }
    if (reviewAnswers > 0) summary.retention = reviewPasses / reviewAnswers;
    return summary;
}

/**
 * The summary of the answers given on the current study day.
 */
export function todaySummary(
    entries: ReviewLogEntry[],
    todayKey: string,
    dayKeyOf: DayKeyFn,
): ActivitySummary {
    return summarizeEntries(entries.filter((entry) => dayKeyOf(entry.t) === todayKey));
}

export interface StreakInfo {
    /** Consecutive study days up to today, or up to yesterday when today has no answer yet. */
    current: number;
    longest: number;
    /** Study days with at least one answer. */
    activeDays: number;
}

/**
 * Streaks of consecutive study days with at least one answer. Today is counted when it has an answer, and does not
 * break the streak while it has none.
 */
export function streaks(
    entries: ReviewLogEntry[],
    todayKey: string,
    dayKeyOf: DayKeyFn,
): StreakInfo {
    const active = new Set<string>();
    for (const entry of entries) {
        if (isReview(entry)) active.add(dayKeyOf(entry.t));
    }

    let cursor = active.has(todayKey) ? todayKey : addDays(todayKey, -1);
    let current = 0;
    while (active.has(cursor)) {
        current++;
        cursor = addDays(cursor, -1);
    }

    let longest = 0;
    let run = 0;
    let previous: string | null = null;
    for (const day of Array.from(active).sort()) {
        run = previous !== null && diffDays(previous, day) === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
        previous = day;
    }
    return { current, longest, activeDays: active.size };
}

export interface DailyCount {
    day: string;
    learn: number;
    review: number;
    relearn: number;
    cram: number;
    total: number;
    timeMs: number;
}

const KIND_FIELD: readonly ("learn" | "review" | "relearn" | "cram")[] = [
    "learn",
    "review",
    "relearn",
    "cram",
];

/**
 * Answers per study day by kind, with a row for every day from `startKey` to `endKey` (empty days included).
 */
export function dailyCounts(
    entries: ReviewLogEntry[],
    startKey: string,
    endKey: string,
    dayKeyOf: DayKeyFn,
): DailyCount[] {
    const rows = new Map<string, DailyCount>();
    for (const day of dayKeyRange(startKey, endKey)) {
        rows.set(day, { day, learn: 0, review: 0, relearn: 0, cram: 0, total: 0, timeMs: 0 });
    }
    for (const entry of entries) {
        if (!isReview(entry)) continue;
        const row = rows.get(dayKeyOf(entry.t));
        if (row === undefined) continue;
        row[KIND_FIELD[entry.k]]++;
        row.total++;
        row.timeMs += entry.ms;
    }
    return Array.from(rows.values());
}

export type Granularity = "day" | "week" | "month";

/**
 * Merges daily rows into weeks or months so that a long history stays readable in a bar chart. The `day` of a merged
 * row is the first day of its week or month.
 *
 * @param weekStart - The first day of the week: 0 for Sunday, 1 for Monday.
 */
export function bucketDailyCounts(
    rows: DailyCount[],
    granularity: Granularity,
    weekStart: number,
): DailyCount[] {
    if (granularity === "day") return rows;
    const buckets = new Map<string, DailyCount>();
    for (const row of rows) {
        const key =
            granularity === "month"
                ? `${row.day.slice(0, 7)}-01`
                : addDays(row.day, -((weekdayOf(row.day) - weekStart + 7) % 7));
        let bucket = buckets.get(key);
        if (bucket === undefined) {
            bucket = { day: key, learn: 0, review: 0, relearn: 0, cram: 0, total: 0, timeMs: 0 };
            buckets.set(key, bucket);
        }
        bucket.learn += row.learn;
        bucket.review += row.review;
        bucket.relearn += row.relearn;
        bucket.cram += row.cram;
        bucket.total += row.total;
        bucket.timeMs += row.timeMs;
    }
    return Array.from(buckets.values());
}

export interface HeatmapCell {
    day: string;
    count: number;
    /** 0 for no answers, 1 to 4 from faint to strong. */
    level: number;
    /** Column, counted from the oldest week. */
    week: number;
    /** Row, counted from the first day of the week. */
    row: number;
}

export interface Heatmap {
    cells: HeatmapCell[];
    /** The counts at the 25th, 50th and 75th percentile of the active days; a day at or above one moves up a level. */
    thresholds: [number, number, number];
    /** Columns that start a new month, for the labels above the grid; `month` is 0 for January. */
    monthLabels: { week: number; month: number }[];
    total: number;
    maxCount: number;
    activeDays: number;
}

export interface HeatmapOptions {
    todayKey: string;
    dayKeyOf: DayKeyFn;
    /** Number of week columns, the last one holding today. */
    weeks?: number;
    /** The first day of the week: 0 for Sunday, 1 for Monday. */
    weekStart?: number;
}

/** Linear interpolation between the closest ranks (the common "type 7" quantile). */
function quantile(sorted: number[], q: number): number {
    const position = q * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, sorted.length - 1);
    return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * A calendar heatmap of answers per study day for the last `weeks` weeks, GitHub style.
 */
export function heatmap(entries: ReviewLogEntry[], options: HeatmapOptions): Heatmap {
    const weeks = options.weeks ?? 53;
    const weekStart = options.weekStart ?? 0;
    const { todayKey, dayKeyOf } = options;

    const todayRow = (weekdayOf(todayKey) - weekStart + 7) % 7;
    const firstKey = addDays(todayKey, -todayRow - (weeks - 1) * 7);

    const perDay = new Map<string, number>();
    for (const entry of entries) {
        if (!isReview(entry)) continue;
        const day = dayKeyOf(entry.t);
        if (day < firstKey || day > todayKey) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    const active = Array.from(perDay.values()).sort((a, b) => a - b);
    const thresholds: [number, number, number] =
        active.length === 0
            ? [0, 0, 0]
            : [quantile(active, 0.25), quantile(active, 0.5), quantile(active, 0.75)];

    const cells: HeatmapCell[] = [];
    const monthLabels: { week: number; month: number }[] = [];
    for (let i = 0; i < weeks * 7; i++) {
        const day = addDays(firstKey, i);
        if (day > todayKey) break;
        const count = perDay.get(day) ?? 0;
        const level =
            count === 0
                ? 0
                : 1 +
                  (count >= thresholds[0] ? 1 : 0) +
                  (count >= thresholds[1] ? 1 : 0) +
                  (count >= thresholds[2] ? 1 : 0);
        const week = Math.floor(i / 7);
        cells.push({ day, count, level, week, row: i % 7 });
        if (day.endsWith("-01")) monthLabels.push({ week, month: Number(day.slice(5, 7)) - 1 });
    }

    // Label the first column too, unless a month starts within the first few columns and would collide with it
    if (cells.length > 0 && !monthLabels.some((label) => label.week < 3)) {
        monthLabels.unshift({ week: 0, month: Number(cells[0].day.slice(5, 7)) - 1 });
    }

    return {
        cells,
        thresholds,
        monthLabels,
        total: active.reduce((sum, count) => sum + count, 0),
        maxCount: active.length === 0 ? 0 : active[active.length - 1],
        activeDays: active.length,
    };
}

export interface HourlyBucket {
    hour: number;
    reviews: number;
    passed: number;
    /** Share of the hour's answers that were not Again; null without answers. */
    successRate: number | null;
}

/**
 * Answers and success rate for each hour of the day, by the wall clock time of the answer.
 */
export function hourly(entries: ReviewLogEntry[]): HourlyBucket[] {
    const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, hour): HourlyBucket => ({
        hour,
        reviews: 0,
        passed: 0,
        successRate: null,
    }));
    for (const entry of entries) {
        if (!isReview(entry)) continue;
        const bucket = buckets[new Date(entry.t).getHours()];
        bucket.reviews++;
        if (entry.r > 1) bucket.passed++;
    }
    for (const bucket of buckets) {
        if (bucket.reviews > 0) bucket.successRate = bucket.passed / bucket.reviews;
    }
    return buckets;
}
