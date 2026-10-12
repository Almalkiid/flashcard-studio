import type { Moment } from "moment";
import { Card, CardInput, clamp, State } from "ts-fsrs";

import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { globalDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

/** The word that starts an FSRS segment of a schedule comment (`!fsrs,...`). */
export const FSRS_COMMENT_PREFIX = "fsrs";

/** The segment for a card never reviewed, in FSRS's format: ten fields, a dash for each time. */
export const FSRS_EMPTY_SCHEDULE_COMMENT = `!${FSRS_COMMENT_PREFIX},-,0,0,0,0,0,0,0,-`;

/** A time as the comment stores it: UTC ISO with milliseconds, or a dash for none. Throws for an invalid time. */
export function formatFsrsTimestamp(date: Moment | null): string {
    return date === null ? "-" : date.toDate().toISOString();
}

/** The time a comment field holds; a dash is none. Text that is no time gives an invalid moment. */
export function parseFsrsTimestamp(input: string): Moment | null {
    return input === "-" ? null : moment(input);
}

// SM-2's usual ease range and FSRS's difficulty range, which the two conversions below map onto each other
const EASE = { min: 130, max: 370 };
const DIFFICULTY = { min: 1, max: 10 };
const NEUTRAL_DIFFICULTY = 5.5;

/** An SM-2 ease (130 to 370, clamped) as a difficulty from 10 down to 1; no ease is a middling difficulty. */
export function easeToDifficulty(ease: number | null | undefined): number {
    if (ease === null || ease === undefined) return NEUTRAL_DIFFICULTY;
    const share = (clamp(ease, EASE.min, EASE.max) - EASE.min) / (EASE.max - EASE.min);
    const difficulty = DIFFICULTY.max - share * (DIFFICULTY.max - DIFFICULTY.min);
    return clamp(difficulty, DIFFICULTY.min, DIFFICULTY.max);
}

/** A difficulty (1 to 10, clamped) as an ease from 370 down to 130. */
export function difficultyToEase(difficulty: number): number {
    const share =
        (DIFFICULTY.max - clamp(difficulty, DIFFICULTY.min, DIFFICULTY.max)) /
        (DIFFICULTY.max - DIFFICULTY.min);
    return Math.round(EASE.min + share * (EASE.max - EASE.min));
}

/**
 * The FSRS schedule of a card: ts-fsrs's ten fields. `interval` is ts-fsrs's `scheduled_days`, and the ease is worked
 * out from the difficulty once, when the schedule is built.
 *
 * The delay is `now - due` at that moment (positive when overdue); SM-2 measures it from the start of today.
 */
export class FsrsState extends ScheduleState {
    // The argument order is the one the comment stores, not ts-fsrs's field order
    constructor(
        dueDate: Moment,
        interval: number,
        public difficulty: number,
        public stability: number,
        public state: State,
        public reps: number,
        public lapses: number,
        /** The index of the next learning step. */
        public learningSteps: number,
        public lastReview: Moment | null,
    ) {
        const overdueMs = dueDate ? globalDateProvider.now.valueOf() - dueDate.valueOf() : 0;
        super(SchedulerKind.FSRS, dueDate, interval, difficultyToEase(difficulty), overdueMs);
    }

    /** The schedule of a ts-fsrs card; times may be dates or text. */
    static fromFsrsCard(card: Card | CardInput): FsrsState {
        const { difficulty, stability, reps, lapses } = card;
        return new FsrsState(
            moment(card.due),
            card.scheduled_days,
            difficulty,
            stability,
            card.state as State,
            reps,
            lapses,
            card.learning_steps,
            card.last_review ? moment(card.last_review) : null,
        );
    }

    /** The card for ts-fsrs. ts-fsrs works the elapsed days out from the last review itself and ignores this value. */
    toFsrsCardInput(now: Moment = globalDateProvider.now): CardInput {
        /* eslint-disable camelcase -- ts-fsrs's card fields are snake_case */
        return {
            due: this.dueDate.toDate(),
            stability: this.stability,
            difficulty: this.difficulty,
            elapsed_days: Math.max(0, now.diff(this.lastReview ?? now, "days")),
            scheduled_days: this.interval,
            learning_steps: this.learningSteps,
            reps: this.reps,
            lapses: this.lapses,
            state: this.state,
            last_review: this.lastReview?.toDate() ?? null,
        };
        /* eslint-enable camelcase -- the snake_case card fields end here */
    }

    /** `!fsrs,due,interval,stability,difficulty,state,reps,lapses,learningSteps,lastReview` (see `CommentParser`). */
    formatScheduleAsComment(): string {
        return [
            `!${FSRS_COMMENT_PREFIX}`,
            formatFsrsTimestamp(this.dueDate),
            this.interval,
            this.stability,
            this.difficulty,
            this.state,
            this.reps,
            this.lapses,
            this.learningSteps,
            formatFsrsTimestamp(this.lastReview),
        ].join(",");
    }
}

/**
 * Whether a schedule is a review card, as opposed to a new card or one still being learned: any SM-2 schedule, or an
 * FSRS schedule in the Review state (not New, Learning or Relearning).
 */
export function isReviewCard(schedule: ScheduleState | null): boolean {
    if (schedule === null) return false;
    return schedule instanceof FsrsState ? schedule.state === State.Review : true;
}
