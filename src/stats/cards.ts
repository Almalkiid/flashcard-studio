import { default_w as DEFAULT_WEIGHTS, forgetting_curve as forgettingCurve } from "ts-fsrs";

import { DayKeyFn, diffDays, MS_PER_DAY } from "src/stats/day-keys";
import { MATURE_INTERVAL_DAYS, StatsCard } from "src/stats/types";

/**
 * Every card in exactly one bucket. Suspended and buried cards are counted as such whatever their state, as in
 * Anki's card counts pie.
 */
export interface CardCounts {
    new: number;
    learning: number;
    relearning: number;
    young: number;
    mature: number;
    suspended: number;
    buried: number;
    total: number;
}

export function cardCounts(cards: StatsCard[]): CardCounts {
    const counts: CardCounts = {
        new: 0,
        learning: 0,
        relearning: 0,
        young: 0,
        mature: 0,
        suspended: 0,
        buried: 0,
        total: cards.length,
    };
    for (const card of cards) {
        if (card.suspended) counts.suspended++;
        else if (card.buried) counts.buried++;
        else if (card.state === "new") counts.new++;
        else if (card.state === "learning") counts.learning++;
        else if (card.state === "relearning") counts.relearning++;
        else if (card.intervalDays >= MATURE_INTERVAL_DAYS) counts.mature++;
        else counts.young++;
    }
    return counts;
}

export interface Forecast {
    /** Review cards that were due on an earlier day and have not been answered. */
    overdue: number;
    /** Cards due on each study day; index 0 is today. Learning cards due today or earlier are counted in it. */
    days: number[];
    /** Cards due after the last day shown. */
    beyond: number;
    total: number;
}

export interface ForecastOptions {
    todayKey: string;
    dayKeyOf: DayKeyFn;
    /** How many days to count, starting with today. */
    days: number;
}

/**
 * How many reviews will be due on each coming day, if nothing is answered before then. New and suspended cards are
 * not counted; buried cards are, because they come back.
 */
export function forecast(cards: StatsCard[], options: ForecastOptions): Forecast {
    const result: Forecast = {
        overdue: 0,
        days: new Array<number>(options.days).fill(0),
        beyond: 0,
        total: 0,
    };
    for (const card of cards) {
        if (card.state === "new" || card.suspended || card.dueMs === null) continue;
        result.total++;
        const offset = diffDays(options.todayKey, options.dayKeyOf(card.dueMs));
        if (offset < 0) {
            if (card.state === "review") result.overdue++;
            else result.days[0]++;
        } else if (offset < options.days) {
            result.days[offset]++;
        } else {
            result.beyond++;
        }
    }
    return result;
}

export interface HistogramBin {
    from: number;
    /** Exclusive upper edge, null for an open ended last bin. */
    to: number | null;
    count: number;
}

export interface Histogram {
    bins: HistogramBin[];
    total: number;
    mean: number | null;
    median: number | null;
    max: number | null;
}

/**
 * Counts values into bins that are closed on the left: bin i covers `[edges[i], edges[i + 1])`.
 *
 * @param openEnded - When true the last edge starts a bin without an upper edge; when false the last edge closes the
 *   last bin, and values on or above it fall in that bin. Values below the first edge fall in the first bin.
 */
export function histogram(values: number[], edges: number[], openEnded: boolean): Histogram {
    const binCount = openEnded ? edges.length : edges.length - 1;
    const bins: HistogramBin[] = [];
    for (let i = 0; i < binCount; i++) {
        bins.push({ from: edges[i], to: i + 1 < edges.length ? edges[i + 1] : null, count: 0 });
    }

    let sum = 0;
    let max: number | null = null;
    for (const value of values) {
        let index = binCount - 1;
        for (let i = 0; i < binCount - 1; i++) {
            if (value < edges[i + 1]) {
                index = i;
                break;
            }
        }
        bins[index].count++;
        sum += value;
        if (max === null || value > max) max = value;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
        sorted.length === 0
            ? null
            : sorted.length % 2 === 1
              ? sorted[middle]
              : (sorted[middle - 1] + sorted[middle]) / 2;

    return {
        bins,
        total: values.length,
        mean: values.length === 0 ? null : sum / values.length,
        median,
        max,
    };
}

/**
 * Text for the axis under a bin: `3`, `7-9`, `730+`, or `95%` for percentages (labelled by the lower edge).
 */
export function binLabel(bin: HistogramBin, style: "int" | "percent"): string {
    if (style === "percent") return `${bin.from}%`;
    if (bin.to === null) return `${bin.from}+`;
    return bin.to - bin.from <= 1 ? String(bin.from) : `${bin.from}-${bin.to - 1}`;
}

const INTERVAL_EDGES = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365, 730];
const STABILITY_EDGES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365, 730];
const DIFFICULTY_EDGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const RETRIEVABILITY_EDGES = Array.from({ length: 21 }, (_, i) => i * 5);

/** Cards with a memory of their own: reviewed at least once and not suspended. */
function isActive(card: StatsCard): boolean {
    return card.state !== "new" && !card.suspended;
}

/**
 * The scheduled intervals of review cards, in days.
 */
export function intervalHistogram(cards: StatsCard[]): Histogram {
    const intervals = cards
        .filter((card) => card.state === "review" && !card.suspended)
        .map((card) => card.intervalDays);
    return histogram(intervals, INTERVAL_EDGES, true);
}

export interface FsrsHistogram {
    histogram: Histogram;
    /** Reviewed cards that could not be included because they have no FSRS memory state (SM-2 cards). */
    excluded: number;
}

function fsrsHistogram(
    cards: StatsCard[],
    pick: (card: StatsCard) => number | null,
    edges: number[],
    openEnded: boolean,
): FsrsHistogram {
    const values: number[] = [];
    let excluded = 0;
    for (const card of cards) {
        if (!isActive(card)) continue;
        const value = pick(card);
        if (value === null) excluded++;
        else values.push(value);
    }
    return { histogram: histogram(values, edges, openEnded), excluded };
}

/** FSRS stability in days: how long until the chance of recalling the card falls to 90%. */
export function stabilityHistogram(cards: StatsCard[]): FsrsHistogram {
    return fsrsHistogram(
        cards,
        (card) => (card.isFsrs && card.stability > 0 ? card.stability : null),
        STABILITY_EDGES,
        true,
    );
}

/** FSRS difficulty from 1 (easy) to 10 (hard). */
export function difficultyHistogram(cards: StatsCard[]): FsrsHistogram {
    return fsrsHistogram(
        cards,
        (card) => (card.isFsrs && card.difficulty > 0 ? card.difficulty : null),
        DIFFICULTY_EDGES,
        false,
    );
}

/**
 * The chance of recalling a card right now, from its FSRS stability and the time since its last review.
 *
 * @param weights - The FSRS parameters; only the forgetting curve decay is used.
 * @returns A number from 0 to 1, or null when the card has no FSRS memory state or no known last review.
 */
export function retrievability(
    card: StatsCard,
    nowMs: number,
    weights: readonly number[] = DEFAULT_WEIGHTS,
): number | null {
    if (!card.isFsrs || card.state === "new" || card.stability <= 0 || card.lastReviewMs === null) {
        return null;
    }
    const elapsedDays = Math.max(0, (nowMs - card.lastReviewMs) / MS_PER_DAY);
    return forgettingCurve(weights, elapsedDays, card.stability);
}

export interface RetrievabilityResult extends FsrsHistogram {
    /** The expected number of cards remembered right now: the sum of the retrievabilities. */
    expectedKnown: number;
}

/**
 * How likely each card is to be remembered right now, in bins of 5 percent.
 */
export function retrievabilityHistogram(
    cards: StatsCard[],
    nowMs: number,
    weights: readonly number[] = DEFAULT_WEIGHTS,
): RetrievabilityResult {
    let expectedKnown = 0;
    const result = fsrsHistogram(
        cards,
        (card) => {
            const value = retrievability(card, nowMs, weights);
            if (value === null) return null;
            expectedKnown += value;
            return value * 100;
        },
        RETRIEVABILITY_EDGES,
        false,
    );
    return { ...result, expectedKnown };
}
