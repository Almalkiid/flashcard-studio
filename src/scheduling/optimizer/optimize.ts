import { computeParameters } from "ts-fsrs-optimizer";

import { evaluateParameters, FitMetrics } from "src/scheduling/optimizer/evaluate";
import {
    buildTrainingSet,
    CardHistory,
    countTrainingReviews,
} from "src/scheduling/optimizer/training-set";

/**
 * The fewest reviews the optimizer will run on. Anki's manual says the optimizer needs "a few hundred" reviews and
 * warns that FSRS cannot learn from fewer; below that the fit is mostly chance, and it can make the schedule worse
 * than the defaults.
 */
export const MIN_REVIEWS_TO_OPTIMIZE = 400;

/**
 * The optimizer's input has no same-day reviews (only the first answer of each day is kept), so the short-term
 * parameters have nothing to learn from and stay at their defaults.
 */
const ENABLE_SHORT_TERM = false;

export interface OptimizeResult {
    /** The 21 optimized weights. */
    weights: number[];
    /** Reviews the optimizer learned from, and the cards they belong to. */
    reviewsUsed: number;
    cardCount: number;
    /** How the weights in use now, and the optimized ones, score on the same reviews. */
    current: FitMetrics;
    optimized: FitMetrics;
    elapsedMs: number;
}

/**
 * Fits FSRS weights to the review histories. This is one synchronous call that keeps the thread busy for the whole
 * run, so callers show a message and let the screen paint before calling it.
 *
 * @param currentWeights - The weights in use now, to compare the result against.
 * @param numRelearningSteps - The number of relearning steps, which limits two of the weights.
 * @throws When there are fewer than {@link MIN_REVIEWS_TO_OPTIMIZE} reviews.
 */
export function optimizeParameters(
    histories: readonly CardHistory[],
    currentWeights: readonly number[],
    numRelearningSteps: number,
): OptimizeResult {
    const reviewsUsed = countTrainingReviews(histories);
    if (reviewsUsed < MIN_REVIEWS_TO_OPTIMIZE) {
        throw new Error(
            `${reviewsUsed} reviews is fewer than the ${MIN_REVIEWS_TO_OPTIMIZE} needed to optimize`,
        );
    }

    const started = Date.now();
    const { trainSet, cardIds } = buildTrainingSet(histories);
    const weights = computeParameters({
        trainSet,
        cardIds,
        enableShortTerm: ENABLE_SHORT_TERM,
        numRelearningSteps: Math.max(1, numRelearningSteps),
    });

    return {
        weights,
        reviewsUsed,
        cardCount: histories.filter((history) => history.reviews.length > 1).length,
        current: evaluateParameters(histories, currentWeights),
        optimized: evaluateParameters(histories, weights),
        elapsedMs: Date.now() - started,
    };
}
