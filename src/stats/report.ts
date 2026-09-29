import { default_w as DEFAULT_WEIGHTS } from "ts-fsrs";

import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import {
    ActivitySummary,
    bucketDailyCounts,
    DailyCount,
    dailyCounts,
    Granularity,
    Heatmap,
    heatmap,
    hourly,
    HourlyBucket,
    isReview,
    StreakInfo,
    streaks,
    summarizeEntries,
    todaySummary,
} from "src/stats/activity";
import { AnswerButtons, answerButtons, RetentionRow, trueRetention } from "src/stats/answers";
import {
    CardCounts,
    cardCounts,
    difficultyHistogram,
    Forecast,
    forecast,
    FsrsHistogram,
    Histogram,
    intervalHistogram,
    retrievabilityHistogram,
    RetrievabilityResult,
    stabilityHistogram,
} from "src/stats/cards";
import { DayKeyFn, diffDays } from "src/stats/day-keys";
import {
    filterCardsByDeck,
    filterEntriesByDeck,
    filterEntriesByRange,
    rangeStartKey,
} from "src/stats/scope";
import { RANGE_DAYS, StatsCard, TimeRange } from "src/stats/types";

export interface ReportOptions {
    nowMs: number;
    dayKeyOf: DayKeyFn;
    /** The first day of the week for the heatmap and weekly buckets: 0 for Sunday, 1 for Monday. */
    weekStart: number;
    /** The deck scope: a deck path covering its subdecks, or "" for every deck. */
    deck: string;
    range: TimeRange;
    /** FSRS parameters for retrievability; the defaults are used when omitted. */
    weights?: readonly number[];
}

/**
 * Everything the statistics view shows for one scope. Built in one go so a change of deck or range costs one
 * aggregation and the view only draws.
 *
 * Today, the streak, the heatmap and the true retention table always cover their own fixed periods; the deck scope
 * applies to everything, and the time range to the reviews per day, answer buttons, hourly breakdown and forecast.
 */
export interface StatsReport {
    todayKey: string;
    /** Whether the deck scope has any recorded answer at all; false shows the empty state. */
    hasHistory: boolean;
    today: ActivitySummary;
    streak: StreakInfo;
    heatmap: Heatmap;
    daily: DailyCount[];
    dailyGranularity: Granularity;
    /** The summary of everything answered in the time range. */
    rangeSummary: ActivitySummary;
    /** Study days in the time range with at least one answer. */
    rangeActiveDays: number;
    forecast: Forecast;
    cardCounts: CardCounts;
    intervals: Histogram;
    stability: FsrsHistogram;
    difficulty: FsrsHistogram;
    retrievability: RetrievabilityResult;
    answerButtons: AnswerButtons;
    hourly: HourlyBucket[];
    retention: RetentionRow[];
}

/** How many days ahead the forecast looks for each range; the whole history looks a year ahead. */
const FORECAST_DAYS: Record<TimeRange, number> = { "1m": 30, "3m": 90, "1y": 365, all: 365 };

function granularityFor(spanDays: number): Granularity {
    if (spanDays <= 120) return "day";
    return spanDays <= 400 ? "week" : "month";
}

export function buildStatsReport(
    allEntries: ReviewLogEntry[],
    allCards: StatsCard[],
    options: ReportOptions,
): StatsReport {
    const { nowMs, dayKeyOf, weekStart, range } = options;
    const todayKey = dayKeyOf(nowMs);

    const entries = filterEntriesByDeck(allEntries, options.deck);
    const cards = filterCardsByDeck(allCards, options.deck);
    const rangeEntries = filterEntriesByRange(entries, range, todayKey, dayKeyOf);

    // The first day of the daily chart: the start of the range, or the first answer for the whole history
    let startKey = rangeStartKey(range, todayKey);
    if (startKey === null) {
        startKey = todayKey;
        for (const entry of entries) {
            const day = dayKeyOf(entry.t);
            if (day < startKey) startKey = day;
        }
    }
    const spanDays = RANGE_DAYS[range] ?? diffDays(startKey, todayKey) + 1;
    const dailyGranularity = granularityFor(spanDays);
    const weights = options.weights ?? DEFAULT_WEIGHTS;

    return {
        todayKey,
        hasHistory: entries.some(isReview),
        today: todaySummary(entries, todayKey, dayKeyOf),
        streak: streaks(entries, todayKey, dayKeyOf),
        heatmap: heatmap(entries, { todayKey, dayKeyOf, weekStart }),
        daily: bucketDailyCounts(
            dailyCounts(rangeEntries, startKey, todayKey, dayKeyOf),
            dailyGranularity,
            weekStart,
        ),
        dailyGranularity,
        rangeSummary: summarizeEntries(rangeEntries),
        rangeActiveDays: streaks(rangeEntries, todayKey, dayKeyOf).activeDays,
        forecast: forecast(cards, { todayKey, dayKeyOf, days: FORECAST_DAYS[range] }),
        cardCounts: cardCounts(cards),
        intervals: intervalHistogram(cards),
        stability: stabilityHistogram(cards),
        difficulty: difficultyHistogram(cards),
        retrievability: retrievabilityHistogram(cards, nowMs, weights),
        answerButtons: answerButtons(rangeEntries),
        hourly: hourly(rangeEntries),
        retention: trueRetention(entries, todayKey, dayKeyOf),
    };
}
