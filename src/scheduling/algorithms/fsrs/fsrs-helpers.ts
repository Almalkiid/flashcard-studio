import type { Moment } from "moment";
import {
    AbstractScheduler,
    Card,
    CardInput,
    checkParameters,
    DefaultInitSeedStrategy,
    FSRSParameters,
    Grade,
    migrateParameters,
    Rating,
    State,
    StepUnit,
} from "ts-fsrs";

import { SRSettings } from "src/data/settings";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { moment } from "src/utils/dates";

export const FSRS_COMMENT_PREFIX = "fsrs";

/**
 * Placeholder comment segment for an unreviewed sibling card. Field count matches a real FSRS
 * entry, but the "-" due date makes the parser read the slot as empty.
 */
export const FSRS_EMPTY_SCHEDULE_COMMENT = `!${FSRS_COMMENT_PREFIX},-,0,0,0,0,0,0,0,-`;

const LEGACY_MIN_EASE = 130;
const LEGACY_MAX_EASE = 370;

/**
 * Builds the FSRS parameters object.
 *
 * @param {SRSettings} settings - The settings object.
 * @returns {Partial<FSRSParameters>} - The FSRS parameters object.
 */
export function buildFsrsParameters(settings: SRSettings): Partial<FSRSParameters> {
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

// M3a: scheduling

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

function relearningStepCount(settings: SRSettings): number {
    return (parseFsrsSteps(settings.fsrsRelearningSteps) ?? DEFAULT_RELEARNING_STEPS).length;
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

/**
 * Converts a review response to a FSRS grade.
 *
 * @param {ReviewResponse} response - The review response.
 * @returns {Grade} - The FSRS grade.
 */
export function reviewResponseToFsrsGrade(response: ReviewResponse): Grade {
    switch (response) {
        case ReviewResponse.Again:
            return Rating.Again;
        case ReviewResponse.Hard:
            return Rating.Hard;
        case ReviewResponse.Good:
            return Rating.Good;
        case ReviewResponse.Easy:
            return Rating.Easy;
        default:
            throw new Error(`Unsupported FSRS response: ${response}`);
    }
}

/**
 * Converts an ease to a difficulty.
 *
 * @param {number} ease - The ease.
 * @returns {number} - The difficulty.
 */
export function easeToDifficulty(ease: number): number {
    if (ease === null || ease === undefined) {
        return 5.5;
    }

    const clampedEase = clamp(ease, LEGACY_MIN_EASE, LEGACY_MAX_EASE);
    const normalized = (clampedEase - LEGACY_MIN_EASE) / (LEGACY_MAX_EASE - LEGACY_MIN_EASE);
    return clamp(10 - normalized * 9, 1, 10);
}

/**
 * Converts a difficulty to an ease.
 *
 * @param {number} difficulty - The difficulty.
 * @returns {number} - The ease.
 */
export function difficultyToEase(difficulty: number): number {
    const clampedDifficulty = clamp(difficulty, 1, 10);
    const normalized = (10 - clampedDifficulty) / 9;
    return Math.round(LEGACY_MIN_EASE + normalized * (LEGACY_MAX_EASE - LEGACY_MIN_EASE));
}

/**
 * Converts a legacy schedule to an FSRS card.
 *
 * @param {RepItemScheduleInfo} schedule - The legacy schedule.
 * @param {Moment} now - The current time.
 * @returns {CardInput} - The FSRS card.
 */
export function sm2ScheduleToFsrsCard(schedule: RepItemScheduleInfo, now: Moment): CardInput {
    const interval = Math.max(1, Math.round(schedule?.interval ?? 1));
    const due = schedule?.dueDate ? schedule.dueDate.clone() : now.clone();
    const lastReview = due.clone().subtract(interval, "d");

    return {
        due: due.toDate(),
        stability: Math.max(0.1, interval),
        difficulty: easeToDifficulty(schedule?.latestEase),
        ["elapsed_days"]: Math.max(0, now.diff(lastReview, "days")),
        ["scheduled_days"]: interval,
        ["learning_steps"]: 0,
        reps: Math.max(1, Math.round(Math.log2(interval + 1))),
        lapses: 0,
        state: State.Review,
        ["last_review"]: lastReview.toDate(),
    };
}

/**
 * Formats a FSRS timestamp.
 *
 * @param {Moment | null} date - The FSRS timestamp.
 * @returns {string} - The formatted FSRS timestamp.
 */
export function formatFsrsTimestamp(date: Moment | null): string {
    return date ? date.toDate().toISOString() : "-";
}

/**
 * Parses a FSRS timestamp.
 *
 * @param {string} input - The FSRS timestamp.
 * @returns {Moment|null} - The parsed FSRS timestamp.
 */
export function parseFsrsTimestamp(input: string): Moment | null {
    return input === "-" ? null : moment(input);
}

/**
 * Clamps a value between a minimum and maximum.
 *
 * @param {number} value - The value to clamp.
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 * @returns {number} - The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
