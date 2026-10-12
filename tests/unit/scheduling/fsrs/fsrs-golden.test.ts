/* eslint-disable camelcase -- ts-fsrs's card fields are snake_case */
import { clamp, fsrs, Rating, State } from "ts-fsrs";

import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { reviewResponseToFsrsGrade } from "src/scheduling/fsrs/fsrs-scheduler";
import {
    buildFsrsParameters,
    parseFsrsWeights,
    relearningStepCount,
} from "src/scheduling/fsrs/fsrs-settings";
import { sm2ScheduleToFsrsCard } from "src/scheduling/fsrs/sm2-to-fsrs-card";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { CommentParser } from "src/utils/schedule-comment";

import { loadGolden } from "../golden/load-golden";
import { ids, mismatches, Slot, sm2Step, view } from "../schedule/golden-views";
import { clockAt, DEFAULT_CLOCK, iso } from "./clock-at";

/**
 * The FSRS half of the golden vectors (golden/fsrs.json): what the old scheduler gave for the same cards, settings and
 * clock. Every row must come out exactly, except the sixteen the golden file lists as a bug found while capturing
 * (decision D5a): there the old code threw and the new one schedules the card as a review.
 */

type GradeName = "Again" | "Hard" | "Good" | "Easy";
const RESPONSE: Record<GradeName, ReviewResponse> = {
    Again: ReviewResponse.Again,
    Hard: ReviewResponse.Hard,
    Good: ReviewResponse.Good,
    Easy: ReviewResponse.Easy,
};

interface AnswerRow {
    id: string;
    config: string;
    grade: GradeName;
    input?: { text?: string; comment?: string };
    out: Slot & { throws?: string };
}

interface Golden {
    configs: Record<string, Partial<StudioSettings>>;
    parameters: {
        id: string;
        settings: Partial<StudioSettings>;
        out: Record<string, unknown>;
        parsedWeights: unknown;
    }[];
    newCardAnswers: (AnswerRow & { clock: string })[];
    reviewCardAnswers: AnswerRow[];
    fuzzRepeatChecks: { id: string; first: string; second: string; same: boolean }[];
    learningRelearningAnswers: AnswerRow[];
    resetSchedules: {
        id: string;
        clock: string;
        grade?: GradeName;
        input?: { text: string };
        out: Slot;
        toFsrsCardInput?: Record<string, unknown>;
    }[];
    sequences: {
        id: string;
        config: string;
        steps: { clock: string; grade: GradeName; before: string | null; after: string }[];
    }[];
    frozenParameters: { input: { card: string }; goodAfterEachStep: Record<string, string> }[];
    sm2ToFsrsCardConversion: {
        id: string;
        input: { dueDay?: string | null; interval?: number; ease?: number; clock?: string };
        out: Record<string, unknown>;
    }[];
    easeDifficultyHelpers: { id: string; fn: string; input: unknown[]; out: unknown }[];
    gradeMapping: { id: string; input: number; out: number | string }[];
    sm2SchedulesAnsweredUnderFsrs: AnswerRow[];
    knownBugs: { bug: number | null; title: string; entries: string[] }[];
}

const golden = loadGolden<Golden>("fsrs");

const settingsOf = (config: string): StudioSettings => ({
    ...DEFAULT_SETTINGS,
    ...golden.configs[config],
});

/** One algorithm per configuration, like the plugin keeps one for its settings. */
const algorithms = new Map<string, FsrsCardScheduler>();
function algorithmOf(config: string): FsrsCardScheduler {
    if (!algorithms.has(config)) algorithms.set(config, new FsrsCardScheduler(settingsOf(config)));
    return algorithms.get(config);
}

const histogram = new CardDueDateHistogram();

/** The schedule a golden `text` stands for. */
const scheduleOf = (text: string): ScheduleState =>
    CommentParser.parseMultiScheduleComment(text)[0];

beforeEach(() => {
    clockAt(DEFAULT_CLOCK);
});

describe("settings to ts-fsrs parameters", () => {
    test("buildFsrsParameters gives the golden object for all 28 settings", () => {
        const bad = mismatches(golden.parameters, (row) => ({
            expected: row.out,
            actual: JSON.parse(JSON.stringify(buildFsrsParameters(settingsOf(row.id.slice(7))))),
        }));
        expect(bad).toEqual([]);
    });

    test("the weight parser (the owner's, moved) still gives the golden weights", () => {
        const bad = mismatches(golden.parameters, (row) => {
            const settings = settingsOf(row.id.slice(7));
            return {
                expected: row.parsedWeights,
                actual: parseFsrsWeights(settings.fsrsWeights, relearningStepCount(settings)),
            };
        });
        expect(bad).toEqual([]);
    });
});

describe("answers to cards", () => {
    test("first answers of a new card, at three clocks (336 rows)", () => {
        const bad = mismatches(golden.newCardAnswers, (row) => {
            clockAt(row.clock);
            const schedule = algorithmOf(row.config).cardGetNewSchedule(
                RESPONSE[row.grade],
                "note.md",
                histogram,
            );
            return { expected: row.out, actual: view(schedule) };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.newCardAnswers).toHaveLength(336);
    });

    test("answers to review cards over stability, difficulty, elapsed days, grade and settings (3,800 rows)", () => {
        const bad = mismatches(golden.reviewCardAnswers, (row) => ({
            expected: row.out,
            actual: view(
                algorithmOf(row.config).cardCalcUpdatedSchedule(
                    RESPONSE[row.grade],
                    scheduleOf(row.input.text),
                    histogram,
                ),
            ),
        }));
        expect(ids(bad)).toEqual([]);
        expect(golden.reviewCardAnswers).toHaveLength(3800);
    });

    test("answers to learning and relearning cards (480 rows)", () => {
        const bad = mismatches(golden.learningRelearningAnswers, (row) => ({
            expected: row.out,
            actual: view(
                algorithmOf(row.config).cardCalcUpdatedSchedule(
                    RESPONSE[row.grade],
                    scheduleOf(row.input.text),
                    histogram,
                ),
            ),
        }));
        expect(ids(bad)).toEqual([]);
        expect(golden.learningRelearningAnswers).toHaveLength(480);
    });

    test("with fuzz on, asking again gives the same card, and a later time of the same day the same interval", () => {
        const answer = (row: { id: string }, at: string): ScheduleState => {
            const [, s, d, e, grade] = row.id.split("/");
            const source = golden.reviewCardAnswers.find(
                (candidate) => candidate.id === `fsrs/review/fuzzOn/s${s}/d${d}/e${e}/${grade}`,
            );
            expect(source).toBeDefined();
            clockAt(at);
            return algorithmOf("fuzzOn").cardCalcUpdatedSchedule(
                RESPONSE[grade as GradeName],
                scheduleOf(source.input.text),
                histogram,
            );
        };
        const bad = mismatches(golden.fuzzRepeatChecks, (row) => {
            const first = answer(row, DEFAULT_CLOCK).formatScheduleAsComment();
            const second = answer(row, DEFAULT_CLOCK).formatScheduleAsComment();
            const later = answer(row, "2023-09-06T08:00:03.000Z");
            return {
                expected: [row.first, row.second, row.first.split(",")[2]],
                actual: [first, second, String(later.interval)],
            };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.fuzzRepeatChecks).toHaveLength(44);
    });
});

describe("reset", () => {
    test("the reset schedule is an empty ts-fsrs card for now; answering it is a first answer (15 rows)", () => {
        const bad = mismatches(golden.resetSchedules, (row) => {
            clockAt(row.clock);
            const algorithm = algorithmOf("defaults");
            if (row.grade === undefined) {
                const reset = algorithm.cardGetResetSchedule() as FsrsState;
                return {
                    expected: [row.out, row.toFsrsCardInput],
                    actual: [view(reset), JSON.parse(JSON.stringify(reset.toFsrsCardInput()))],
                };
            }
            const answered = algorithm.cardCalcUpdatedSchedule(
                RESPONSE[row.grade],
                scheduleOf(row.input.text),
                histogram,
            );
            return { expected: row.out, actual: view(answered) };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.resetSchedules).toHaveLength(15);
    });
});

describe("25-step sequences", () => {
    test("each answer, with the clock moved to where the old run had it, gives the golden text (18 x 25 steps)", () => {
        const bad = mismatches(golden.sequences, (sequence) => {
            const algorithm = algorithmOf(sequence.config);
            let schedule: ScheduleState | null = null;
            const texts: string[] = [];
            for (const step of sequence.steps) {
                clockAt(step.clock);
                schedule =
                    schedule === null
                        ? algorithm.cardGetNewSchedule(RESPONSE[step.grade], "n.md", histogram)
                        : algorithm.cardCalcUpdatedSchedule(
                              RESPONSE[step.grade],
                              schedule,
                              histogram,
                          );
                // The text is what a note holds: every step starts from what was written and read back
                texts.push(schedule.formatScheduleAsComment());
                schedule = scheduleOf(texts[texts.length - 1]);
            }
            return { expected: sequence.steps.map((step) => step.after), actual: texts };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.sequences).toHaveLength(18);
        expect(golden.sequences.every((sequence) => sequence.steps.length === 25)).toBe(true);
    });
});

describe("parameters are frozen until updateParameters", () => {
    test("a settings change shows only after updateParameters", () => {
        const [row] = golden.frozenParameters;
        const expected = row.goodAfterEachStep;
        const settings: StudioSettings = { ...DEFAULT_SETTINGS };
        const algorithm = new FsrsCardScheduler(settings);
        const good = (): string =>
            algorithm
                .cardCalcUpdatedSchedule(ReviewResponse.Good, scheduleOf(row.input.card), histogram)
                .formatScheduleAsComment();

        const seen = { initial: good() } as Record<string, string>;
        settings.fsrsDesiredRetention = 0.8;
        seen.afterRetentionChangeWithoutRebuild = good();
        algorithm.updateParameters(settings);
        seen.afterUpdateParameters = good();
        settings.maximumInterval = 5;
        seen.afterMaxIntervalChangeWithoutRebuild = good();
        algorithm.updateParameters(settings);
        seen.afterSecondUpdateParameters = good();

        expect(seen).toEqual(expected);
    });
});

describe("SM-2 cards under FSRS", () => {
    const bugRows = new Set(
        golden.knownBugs.find((known) => known.bug === null && known.title.includes("throw"))
            ?.entries,
    );

    /** The golden `Easy`-to-`Again` row for a card reviewed just now with stability 1 and this ease. */
    const justReviewed = (row: AnswerRow, ease: number): string => {
        const difficulty = { 130: "10", 250: "5.5", 370: "1" }[ease];
        if (difficulty !== undefined) {
            const source = golden.reviewCardAnswers.find(
                (candidate) =>
                    candidate.id === `fsrs/review/${row.config}/s1/d${difficulty}/e0/${row.grade}`,
            );
            // The same card in the same state; only its review count (5 there, 1 here) differs
            const fields = (source.out.text as string).split(",");
            fields[6] = String(Number(fields[6]) - 4);
            return fields.join(",");
        }
        // No such row for ease 300: ask ts-fsrs for a card of stability 1 and difficulty 3.625 reviewed just now
        const card = {
            due: new Date("2023-09-07T00:00:00.000Z"),
            stability: 1,
            difficulty: 3.625,
            elapsed_days: 0,
            scheduled_days: 1,
            learning_steps: 0,
            reps: 1,
            lapses: 0,
            state: State.Review,
            last_review: new Date(DEFAULT_CLOCK),
        };
        const next = fsrs(buildFsrsParameters(settingsOf(row.config))).next(
            card,
            new Date(DEFAULT_CLOCK),
            Rating[row.grade],
        );
        return FsrsState.fromFsrsCard(next.card).formatScheduleAsComment();
    };

    test("440 rows; the 16 that used to throw are scheduled as a review that was just done (decision D5a)", () => {
        expect(bugRows.size).toBe(16);
        const bad = mismatches(golden.sm2SchedulesAnsweredUnderFsrs, (row) => {
            const old = scheduleOf(row.input.comment);
            const answered = algorithmOf(row.config).cardCalcUpdatedSchedule(
                RESPONSE[row.grade],
                old,
                histogram,
            );
            if (!bugRows.has(row.id)) return { expected: row.out, actual: view(answered) };
            expect(row.out.throws).toMatch(/Invalid delta_t/);
            expect(old).toBeInstanceOf(Sm2State);
            return {
                expected: justReviewed(row, old.latestEase),
                actual: answered.formatScheduleAsComment(),
            };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.sm2SchedulesAnsweredUnderFsrs).toHaveLength(440);
    });
});

describe("conversions and lookups", () => {
    test("sm2ScheduleToFsrsCard gives the golden card for 142 schedules, a missing one and a missing due date", () => {
        const bad = mismatches(golden.sm2ToFsrsCardConversion, (row) => {
            clockAt(row.input.clock ?? DEFAULT_CLOCK);
            let schedule: Sm2State | null;
            if (row.id === "sm2ToCard/null-schedule") schedule = null;
            else if (row.input.dueDay === null) {
                schedule = new Sm2State(null, row.input.interval, row.input.ease);
            } else {
                schedule = sm2Step(row.input.dueDay, row.input.interval, row.input.ease);
            }
            const card = sm2ScheduleToFsrsCard(schedule, iso(row.input.clock ?? DEFAULT_CLOCK));
            return { expected: row.out, actual: JSON.parse(JSON.stringify(card)) };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.sm2ToFsrsCardConversion).toHaveLength(142);
    });

    test("clamp is ts-fsrs's own and gives the golden answers, NaN included", () => {
        const rows = golden.easeDifficultyHelpers.filter((row) => row.fn === "clamp");
        expect(rows).toHaveLength(8);
        const bad = mismatches(rows, (row) => {
            const [value, min, max] = row.input.map((x) => (x === "@NaN" ? NaN : (x as number)));
            const actual = clamp(value, min, max);
            return { expected: row.out, actual: Number.isNaN(actual) ? "@NaN" : actual };
        });
        expect(ids(bad)).toEqual([]);
    });

    test("reviewResponseToFsrsGrade maps the four buttons and refuses Reset or anything else", () => {
        const bad = mismatches(golden.gradeMapping, (row) => {
            let actual: number | string;
            try {
                actual = reviewResponseToFsrsGrade(row.input);
            } catch (error) {
                actual = `@throws: ${(error as Error).message}`;
            }
            return { expected: row.out, actual };
        });
        expect(ids(bad)).toEqual([]);
        expect(golden.gradeMapping).toHaveLength(8);
    });
});
