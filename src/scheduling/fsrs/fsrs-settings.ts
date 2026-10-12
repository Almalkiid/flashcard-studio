import {
    AbstractScheduler,
    Card,
    checkParameters,
    DefaultInitSeedStrategy,
    FSRSParameters,
    migrateParameters,
    StepUnit,
} from "ts-fsrs";

import { StudioSettings } from "src/data/settings-model";

/** Number of FSRS-6 weights. */
export const FSRS_WEIGHT_COUNT = 21;

export const DEFAULT_LEARNING_STEPS: StepUnit[] = ["1m", "10m"];
export const DEFAULT_RELEARNING_STEPS: StepUnit[] = ["10m"];

const STEP_PATTERN = /^([1-9]\d{0,5})([mhd])$/;

/**
 * Parses learning steps typed as in Anki's deck options, e.g. `1m 10m` or `10m 1h`: whole numbers followed by m
 * (minutes), h (hours) or d (days), separated by spaces or commas. An empty text is a valid empty list, which lets
 * FSRS decide the short-term schedule.
 *
 * @returns The steps, or null when any step is not valid.
 */
export function parseFsrsSteps(text: string | null | undefined): StepUnit[] | null {
    const tokens = (text ?? "").split(/[\s,]+/).filter((token) => token.length > 0);
    const steps: StepUnit[] = [];
    for (const token of tokens) {
        if (!STEP_PATTERN.test(token)) return null;
        steps.push(token as StepUnit);
    }
    return steps;
}

export function formatFsrsSteps(steps: readonly StepUnit[]): string {
    return steps.join(" ");
}

/**
 * Whether any step is a day or longer. FSRS works best when every step can be finished on the day it starts.
 */
export function hasStepOfADayOrMore(steps: readonly StepUnit[]): boolean {
    return steps.some((step) => step.endsWith("d") || (step.endsWith("h") && parseInt(step) >= 24));
}

export function relearningStepCount(settings: StudioSettings): number {
    return (parseFsrsSteps(settings.fsrsRelearningSteps) ?? DEFAULT_RELEARNING_STEPS).length;
}

/** What the settings ask of ts-fsrs. The scheduler freezes these when it is built. */
export function buildFsrsParameters(settings: StudioSettings): Partial<FSRSParameters> {
    const parameters: Partial<FSRSParameters> = {
        ["request_retention"]: settings.fsrsDesiredRetention,
        ["maximum_interval"]: settings.maximumInterval,
        ["enable_short_term"]: true,
        ["enable_fuzz"]: settings.fsrsEnableFuzz,
        // An unreadable list in data.json (edited by hand) falls back to the defaults instead of breaking review
        ["learning_steps"]:
            parseFsrsSteps(settings.fsrsLearningSteps) ?? DEFAULT_LEARNING_STEPS.slice(),
        ["relearning_steps"]:
            parseFsrsSteps(settings.fsrsRelearningSteps) ?? DEFAULT_RELEARNING_STEPS.slice(),
    };
    const weights = parseFsrsWeights(settings.fsrsWeights, relearningStepCount(settings));
    if (weights.weights !== null) parameters.w = weights.weights;
    return parameters;
}

export interface ParsedFsrsWeights {
    /** The 21 weights, or null when the text is empty (use FSRS's defaults) or invalid. */
    weights: number[] | null;
    /** Set when the text is not a valid list of weights. */
    error: string | null;
    /** How many numbers were typed, before conversion to 21 weights. */
    typedCount: number;
}

/**
 * Parses custom FSRS weights: numbers separated by commas or spaces. Lists of 17 (FSRS-4), 19 (FSRS-5) or 21
 * (FSRS-6) weights are accepted, so an export from Anki or from older tools can be pasted; shorter lists are
 * converted to 21 weights and every weight is limited to its valid range.
 *
 * @param numRelearningSteps - The number of relearning steps, which limits two of the weights.
 */
export function parseFsrsWeights(
    text: string | null | undefined,
    numRelearningSteps: number,
): ParsedFsrsWeights {
    const tokens = (text ?? "")
        .replace(/[[\]()]/g, " ")
        .split(/[\s,;]+/)
        .filter((token) => token.length > 0);
    if (tokens.length === 0) return { weights: null, error: null, typedCount: 0 };

    const numbers = tokens.map((token) => Number(token));
    try {
        checkParameters(numbers);
    } catch (error) {
        return {
            weights: null,
            error: error instanceof Error ? error.message : String(error),
            typedCount: tokens.length,
        };
    }
    return {
        weights: migrateParameters(numbers, numRelearningSteps, true),
        error: null,
        typedCount: tokens.length,
    };
}

export function formatFsrsWeights(weights: readonly number[]): string {
    return weights.map((weight) => String(Number(weight.toFixed(6)))).join(", ");
}

/**
 * The seed ts-fsrs uses to fuzz an interval. ts-fsrs's own seed includes the exact review time, so the interval a
 * button shows would differ from the one applied when it is pressed. This seed only depends on the card's state, so
 * both agree, as in Anki. A card that has never been reviewed has no state to seed from, so it keeps ts-fsrs's seed.
 */
export function stableFuzzSeed(this: AbstractScheduler): string {
    const before = Reflect.get(this, "last") as Card;
    if (!before.last_review) return DefaultInitSeedStrategy.call(this);
    return `${before.last_review.getTime()}_${before.reps}_${before.stability * before.difficulty}`;
}
