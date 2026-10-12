import {
    forgetting_curve as forgettingCurve,
    FSRSAlgorithm,
    FSRSState,
    generatorParameters,
} from "ts-fsrs";

import { CardHistory } from "src/scheduling/optimizer/training-set";

export interface FitMetrics {
    /** Average log loss of the recall predictions (lower is better). */
    logLoss: number;
    /** Calibration error over bins of interval, review count and lapses, as a fraction (lower is better). */
    rmse: number;
    /** How many predictions were scored. */
    count: number;
}

// Predictions are kept off 0 and 1 so one confident miss does not give an infinite loss
const MIN_PROBABILITY = 0.0001;

/**
 * The FSRS benchmark's bins, so that errors are judged where predictions are made: intervals grow by 3.62, review
 * counts by 1.99 and lapses by 1.65 from one bin to the next.
 */
function binKey(deltaT: number, reviewCount: number, lapses: number): string {
    const deltaBin = Math.round(
        2.48 * 3.62 ** Math.floor(Math.log(Math.max(1, deltaT)) / Math.log(3.62)) * 100,
    );
    const countBin = Math.round(2.48 * 1.99 ** Math.floor(Math.log(reviewCount) / Math.log(1.99)));
    const lapseBin =
        lapses === 0 ? 0 : Math.round(1.65 ** Math.floor(Math.log(lapses) / Math.log(1.65)));
    return `${deltaBin}|${countBin}|${lapseBin}`;
}

/**
 * Scores FSRS weights against review histories: for every review after a card's first, the weights predict the
 * chance of recalling it from the card's earlier reviews, and the prediction is compared with what happened
 * (anything but Again counts as recalled).
 *
 * Uses the same ts-fsrs code that schedules the cards, so the score is about the parameters as they will be used.
 *
 * @param scoreFrom - Only reviews at or after this time are scored (earlier ones still build each card's memory),
 * which scores the later part of a history when the earlier part was used to fit the weights.
 */
export function evaluateParameters(
    histories: readonly CardHistory[],
    weights: readonly number[],
    scoreFrom: number = -Infinity,
): FitMetrics {
    const algorithm = new FSRSAlgorithm(
        generatorParameters({ w: [...weights], ["enable_short_term"]: true }),
    );
    const w = [...weights];

    let lossSum = 0;
    let count = 0;
    const bins = new Map<string, { predicted: number; actual: number; n: number }>();

    for (const history of histories) {
        let state: FSRSState | null = null;
        let lapses = 0;
        history.reviews.forEach((review, index) => {
            if (state !== null && index > 0 && review.t >= scoreFrom) {
                const p = Math.min(
                    1 - MIN_PROBABILITY,
                    Math.max(MIN_PROBABILITY, forgettingCurve(w, review.deltaT, state.stability)),
                );
                const recalled = review.rating > 1 ? 1 : 0;
                lossSum -= recalled * Math.log(p) + (1 - recalled) * Math.log(1 - p);
                count++;

                const key = binKey(review.deltaT, index + 1, lapses);
                const bin = bins.get(key) ?? { predicted: 0, actual: 0, n: 0 };
                bin.predicted += p;
                bin.actual += recalled;
                bin.n++;
                bins.set(key, bin);
            }
            if (review.rating === 1 && index > 0) lapses++;
            state = algorithm.next_state(state, review.deltaT, review.rating);
        });
    }

    let squaredError = 0;
    for (const bin of bins.values()) {
        squaredError += bin.n * (bin.predicted / bin.n - bin.actual / bin.n) ** 2;
    }
    return {
        logLoss: count > 0 ? lossSum / count : 0,
        rmse: count > 0 ? Math.sqrt(squaredError / count) : 0,
        count,
    };
}
