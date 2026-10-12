import type { Moment } from "moment";

import type { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { globalDateProvider } from "src/utils/clock";

/**
 * When an item is next due and the numbers its scheduler left behind. The subclasses add what each algorithm keeps and
 * how it is written into a note.
 */
export abstract class ScheduleState {
    constructor(
        readonly algorithmType: SchedulerKind,
        public dueDate: Moment,
        /** Days. */
        public interval: number,
        /** The ease for SM-2; for FSRS one worked out from the difficulty, so the note ease average has a number. */
        public latestEase: number,
        /** Milliseconds the review was late: positive when overdue, negative when early. */
        public delayedBeforeReviewTicks: number,
    ) {}

    /** The due instant in milliseconds; NaN for an invalid date. */
    get dueDateAsUnix(): number {
        return this.dueDate.valueOf();
    }

    /** Whether the due instant has come: at or before the current instant. Never true without a valid due date. */
    isDue(): boolean {
        return !!this.dueDate && this.dueDate.valueOf() <= globalDateProvider.nowMs;
    }

    /** The segment of the `<!--SR:...-->` comment that stores this schedule, with its leading `!`. */
    abstract formatScheduleAsComment(): string;
}
