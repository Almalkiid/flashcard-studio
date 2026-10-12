/**
 * Validation gate for the in-plugin optimizer (dev only, not shipped, not run by jest).
 *
 * Simulates learners with known FSRS weights, turns their review logs into optimizer input with the plugin's own code,
 * fits weights with both `ts-fsrs-optimizer` (what the plugin ships) and `@open-spaced-repetition/binding` (fsrs-rs, the
 * reference), and scores every set of weights on reviews neither optimizer saw. The plugin's optimizer passes when its
 * held-out log loss is within 2% of the binding's in every scenario.
 *
 * Run with: pnpm validate:optimizer
 */
import {
    computeParameters as bindingComputeParameters,
    FSRSBinding,
    FSRSBindingItem,
    FSRSBindingReview,
} from "@open-spaced-repetition/binding";
import { default_w as defaultWeights } from "ts-fsrs";
import { computeParameters as tsComputeParameters } from "ts-fsrs-optimizer";

import { evaluateParameters } from "src/scheduling/optimizer/evaluate";
import { optimizeParameters } from "src/scheduling/optimizer/optimize";
import {
    buildCardHistories,
    buildTrainingSet,
    CardHistory,
    countTrainingReviews,
} from "src/scheduling/optimizer/training-set";

import {
    FAR_FROM_DEFAULT_WEIGHTS,
    generateReviewLog,
    NEAR_DEFAULT_WEIGHTS,
    SyntheticOptions,
} from "./synthetic";

const TOLERANCE = 0.02;
const NUM_RELEARNING_STEPS = 1;

interface Scenario {
    name: string;
    options: SyntheticOptions;
}

const SCENARIOS: Scenario[] = [
    {
        name: "near defaults, small",
        options: { cards: 120, days: 260, trueWeights: NEAR_DEFAULT_WEIGHTS, seed: 1 },
    },
    {
        name: "far from defaults, small",
        options: { cards: 120, days: 260, trueWeights: FAR_FROM_DEFAULT_WEIGHTS, seed: 2 },
    },
    {
        name: "near defaults, medium",
        options: { cards: 900, days: 320, trueWeights: NEAR_DEFAULT_WEIGHTS, seed: 3 },
    },
    {
        name: "far from defaults, medium",
        options: { cards: 900, days: 320, trueWeights: FAR_FROM_DEFAULT_WEIGHTS, seed: 4 },
    },
    {
        name: "far from defaults, 50k",
        options: { cards: 2150, days: 480, trueWeights: FAR_FROM_DEFAULT_WEIGHTS, seed: 5 },
    },
];

function toBindingItem(reviews: { rating: number; deltaT: number }[]): FSRSBindingItem {
    return new FSRSBindingItem(
        reviews.map((review) => new FSRSBindingReview(review.rating, review.deltaT)),
    );
}

/** The prefix items whose last review is at or after `from`, as binding items. */
function bindingItemsFrom(histories: readonly CardHistory[], from: number): FSRSBindingItem[] {
    const items: FSRSBindingItem[] = [];
    for (const history of histories) {
        for (let length = 2; length <= history.reviews.length; length++) {
            if (history.reviews[length - 1].t >= from) {
                items.push(toBindingItem(history.reviews.slice(0, length)));
            }
        }
    }
    return items;
}

/** Cuts every card's history off after `until`, dropping cards left with nothing. */
function truncate(histories: readonly CardHistory[], until: number): CardHistory[] {
    return histories
        .map((history) => ({
            cardId: history.cardId,
            reviews: history.reviews.filter((review) => review.t < until),
        }))
        .filter((history) => history.reviews.length > 0);
}

function pct(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
}

interface Row {
    scenario: string;
    reviews: number;
    trainReviews: number;
    tsMs: number;
    tsShortMs: number;
    bindingMs: number;
    lossDefault: number;
    lossTs: number;
    lossTsShort: number;
    lossBinding: number;
    lossTruth: number;
    refDefault: number;
    refTs: number;
    refTsShort: number;
    refBinding: number;
    refTruth: number;
    rmseTs: number;
    rmseBinding: number;
}

async function runScenario(scenario: Scenario): Promise<Row> {
    const log = generateReviewLog(scenario.options);
    const histories = buildCardHistories(log, { dayStartOffsetMs: 0 });
    const reviews = countTrainingReviews(histories);

    // Fit on the first 80% of the time, score on the last 20%
    const times = histories
        .flatMap((history) => history.reviews.map((review) => review.t))
        .sort((a, b) => a - b);
    const split = times[Math.floor(times.length * 0.8)];
    const train = truncate(histories, split);
    const { trainSet, cardIds } = buildTrainingSet(train);

    let started = performance.now();
    const tsWeights = tsComputeParameters({
        trainSet,
        cardIds,
        enableShortTerm: false,
        numRelearningSteps: NUM_RELEARNING_STEPS,
    });
    const tsMs = performance.now() - started;

    started = performance.now();
    const tsShortWeights = tsComputeParameters({
        trainSet,
        cardIds,
        enableShortTerm: true,
        numRelearningSteps: NUM_RELEARNING_STEPS,
    });
    const tsShortMs = performance.now() - started;

    started = performance.now();
    const bindingWeights = await bindingComputeParameters(
        trainSet.map((item) => toBindingItem(item.reviews)),
        { enableShortTerm: false, numRelearningSteps: NUM_RELEARNING_STEPS },
    );
    const bindingMs = performance.now() - started;

    const heldOut = bindingItemsFrom(histories, split);
    const refLoss = (weights: readonly number[]) =>
        new FSRSBinding([...weights]).evaluate(heldOut).logLoss;
    const ourLoss = (weights: readonly number[]) =>
        evaluateParameters(histories, weights, split).logLoss;

    return {
        scenario: scenario.name,
        reviews,
        trainReviews: trainSet.length,
        tsMs,
        tsShortMs,
        bindingMs,
        lossDefault: ourLoss(defaultWeights),
        lossTs: ourLoss(tsWeights),
        lossTsShort: ourLoss(tsShortWeights),
        lossBinding: ourLoss(bindingWeights),
        lossTruth: ourLoss(scenario.options.trueWeights),
        refDefault: refLoss(defaultWeights),
        refTs: refLoss(tsWeights),
        refTsShort: refLoss(tsShortWeights),
        refBinding: refLoss(bindingWeights),
        refTruth: refLoss(scenario.options.trueWeights),
        rmseTs: evaluateParameters(histories, tsWeights, split).rmse,
        rmseBinding: evaluateParameters(histories, bindingWeights, split).rmse,
    };
}

async function main(): Promise<void> {
    const rows: Row[] = [];
    for (const scenario of SCENARIOS) {
        console.log(`Running: ${scenario.name}`);
        rows.push(await runScenario(scenario));
    }

    console.log("\nHeld-out log loss (lower is better), scored by the plugin's ts-fsrs code:");
    console.table(
        rows.map((row) => ({
            scenario: row.scenario,
            "reviews (all)": row.reviews,
            "reviews (fit)": row.trainReviews,
            defaults: row.lossDefault.toFixed(4),
            "ts-fsrs-optimizer": row.lossTs.toFixed(4),
            "ts-fsrs-optimizer +short": row.lossTsShort.toFixed(4),
            binding: row.lossBinding.toFixed(4),
            "true weights": row.lossTruth.toFixed(4),
            "ts vs binding": pct(row.lossTs / row.lossBinding - 1),
        })),
    );

    console.log("Held-out log loss, scored by fsrs-rs itself (binding evaluate):");
    console.table(
        rows.map((row) => ({
            scenario: row.scenario,
            defaults: row.refDefault.toFixed(4),
            "ts-fsrs-optimizer": row.refTs.toFixed(4),
            "ts-fsrs-optimizer +short": row.refTsShort.toFixed(4),
            binding: row.refBinding.toFixed(4),
            "true weights": row.refTruth.toFixed(4),
            "ts vs binding": pct(row.refTs / row.refBinding - 1),
        })),
    );

    console.log("Held-out RMSE (bins), plugin metric, and optimizer time in ms:");
    console.table(
        rows.map((row) => ({
            scenario: row.scenario,
            "rmse ts": pct(row.rmseTs),
            "rmse binding": pct(row.rmseBinding),
            "ts ms": Math.round(row.tsMs),
            "ts +short ms": Math.round(row.tsShortMs),
            "binding ms": Math.round(row.bindingMs),
        })),
    );

    // What the plugin itself does on the largest history (builds the input, fits, scores both weight sets), in one
    // synchronous call: this is how long the screen is busy
    const largest = SCENARIOS[SCENARIOS.length - 1];
    const histories = buildCardHistories(generateReviewLog(largest.options), {
        dayStartOffsetMs: 0,
    });
    const started = performance.now();
    const result = optimizeParameters(histories, defaultWeights, NUM_RELEARNING_STEPS);
    console.log(
        `Plugin optimizeParameters on ${countTrainingReviews(histories)} reviews (${histories.length} cards): ` +
            `${Math.round(performance.now() - started)} ms in total, ${result.elapsedMs} ms reported`,
    );

    const failures = rows.filter(
        (row) =>
            row.lossTs > row.lossBinding * (1 + TOLERANCE) ||
            row.refTs > row.refBinding * (1 + TOLERANCE),
    );
    if (failures.length > 0) {
        console.log(
            `\nFAIL: ts-fsrs-optimizer is more than ${pct(TOLERANCE)} worse than the binding in: ` +
                failures.map((row) => row.scenario).join("; "),
        );
        process.exitCode = 1;
    } else {
        console.log(
            `\nPASS: ts-fsrs-optimizer's held-out log loss is within ${pct(TOLERANCE)} of the binding's in all ${rows.length} scenarios.`,
        );
    }
}

void main();
