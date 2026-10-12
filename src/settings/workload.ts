import { clamp, computeDecayFactor, default_w as defaultWeights } from "ts-fsrs";

import type { StudioSettings } from "src/data/settings-model";
import {
    DEFAULT_RELEARNING_STEPS,
    parseFsrsSteps,
    parseFsrsWeights,
} from "src/scheduling/fsrs/fsrs-settings";
import { RETENTION_MAX_PERCENT, RETENTION_MIN_PERCENT } from "src/settings/validators";

/** Fewer FSRS cards than this say too little about a collection to estimate its workload. */
export const MIN_CARDS_FOR_WORKLOAD = 20;

/** How far from the chosen retention, in percentage points, the text compares. */
const COMPARE_POINTS = 5;

/**
 * The reviews a day these cards settle at: each card comes back once per interval, and the interval ts-fsrs gives a
 * card of stability S at retention r is S × (r^(1/decay) − 1) / factor, rounded and kept between a day and the
 * maximum interval. ts-fsrs's decay is negative, so at r = 0.9 the interval is S itself.
 *
 * @param weights - The 21 FSRS parameters in use, or null for the defaults.
 * @returns null when there are too few cards, or retention or the maximum interval cannot be used.
 */
export function estimateDailyReviews(
    stabilities: readonly number[],
    retention: number,
    weights: readonly number[] | null,
    maximumInterval: number,
): number | null {
    if (
        stabilities.length < MIN_CARDS_FOR_WORKLOAD ||
        !(retention > 0 && retention < 1) ||
        !(maximumInterval >= 1)
    )
        return null;
    const { decay, factor } = computeDecayFactor(weights ?? defaultWeights);
    const modifier = (Math.pow(retention, 1 / decay) - 1) / factor;
    let perDay = 0;
    for (const stability of stabilities) {
        const interval = Math.min(maximumInterval, Math.max(1, Math.round(stability * modifier)));
        perDay += 1 / interval;
    }
    return perDay;
}

/** The number of cards in words: "1 card", "20 cards", "1,500 cards". */
export function cardsText(count: number): string {
    return count === 1 ? "1 card" : `${count.toLocaleString()} cards`;
}

/** The settings the estimate depends on. */
export type WorkloadSettings = Pick<
    StudioSettings,
    "fsrsDesiredRetention" | "fsrsWeights" | "fsrsRelearningSteps" | "maximumInterval"
>;

/**
 * One line on what the chosen retention costs in reviews a day, and what 5 points less and more would cost.
 * Parameters are read as the scheduler reads them, so text that is not parameters means the defaults.
 *
 * @param stabilities - The stability in days of every FSRS card in use.
 * @returns null when there is nothing to estimate yet.
 */
export function workloadText(
    stabilities: readonly number[],
    settings: WorkloadSettings,
): string | null {
    const relearningSteps =
        parseFsrsSteps(settings.fsrsRelearningSteps) ?? DEFAULT_RELEARNING_STEPS;
    const { weights } = parseFsrsWeights(settings.fsrsWeights, relearningSteps.length);
    const reviewsAt = (retention: number) =>
        estimateDailyReviews(stabilities, retention, weights, settings.maximumInterval);

    const now = reviewsAt(settings.fsrsDesiredRetention);
    if (now === null) return null;

    const percent = Math.round(settings.fsrsDesiredRetention * 100);
    const lower = clamp(percent - COMPARE_POINTS, RETENTION_MIN_PERCENT, RETENTION_MAX_PERCENT);
    const higher = clamp(percent + COMPARE_POINTS, RETENTION_MIN_PERCENT, RETENTION_MAX_PERCENT);
    const compared: number[] = [];
    if (lower < percent) compared.push(lower);
    if (higher > percent) compared.push(higher);

    const sentences = compared.flatMap((target) => {
        const reviews = reviewsAt(target / 100);
        if (reviews === null) return [];
        const rounded = Math.round(reviews);
        return [`At ${target}%: ${rounded === 0 ? "less than 1" : "about " + rounded}.`];
    });
    const main = Math.round(now);
    const reviewsADay =
        main === 0
            ? "Less than 1 review a day"
            : `About ${main === 1 ? "1 review" : `${main} reviews`} a day`;
    return [`${reviewsADay} for your ${cardsText(stabilities.length)}.`, ...sentences].join(" ");
}
