import type { Moment } from "moment";

import { PREFERRED_DATE_FORMAT } from "src/data/formats";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { DateUtil, formatDate, globalDateProvider, wallClockMs } from "src/utils/clock";

/**
 * Milliseconds a review is late. Given, that value (NaN counts as 0); otherwise the start of today minus the due date:
 * positive when overdue, 0 on the due day, negative when early. Counted on the wall clock, so a card two days overdue
 * is two whole days late also when the clocks changed in between.
 */
function lateness(dueDate: Moment, given: number | null): number {
    if (given !== null) return given || 0;
    return dueDate
        ? wallClockMs(globalDateProvider.today.valueOf()) - wallClockMs(dueDate.valueOf())
        : 0;
}

/** The SM-2 schedule of a card or a note: a due day, an interval in days and an ease. */
export class Sm2State extends ScheduleState {
    /** The due date of a card that was never reviewed; a comment segment with it reads back as no schedule. */
    static readonly dummyDueDateForNewCard = "2000-01-01";
    static readonly initialInterval = 1;

    /** @param delayedBeforeReviewTicks - Left out, worked out from the due date (see `lateness`). */
    constructor(
        dueDate: Moment,
        interval: number,
        latestEase: number,
        delayedBeforeReviewTicks: number | null = null,
    ) {
        const late = lateness(dueDate, delayedBeforeReviewTicks);
        super(SchedulerKind.SM2, dueDate, interval, latestEase, late);
    }

    /**
     * Due on its date: once the study day of that date has begun. With a day that starts at 04:00, a card due on the 7th
     * is not due at 01:00 on the 7th, which still belongs to the 6th. Never true without a valid due date.
     */
    isDue(): boolean {
        return !!this.dueDate && this.dueDate.valueOf() < globalDateProvider.todayEndMs;
    }

    /** `!YYYY-MM-DD,interval,ease`; the due day is the local calendar date. */
    formatScheduleAsComment(): string {
        const day = this.dueDate
            ? formatDate(this.dueDateAsUnix, PREFERRED_DATE_FORMAT)
            : Sm2State.dummyDueDateForNewCard;
        return `!${day},${this.interval},${this.latestEase}`;
    }

    /** A schedule from a due date in any of the accepted formats (`YYYY-MM-DD`, `DD-MM-YYYY`, `ddd MMM DD YYYY`). */
    static fromDueDateStr(
        dueDateStr: string,
        interval: number,
        ease: number,
        delayedBeforeReviewTicks: number | null = null,
    ): Sm2State {
        const due = DateUtil.dateStrToMoment(dueDateStr);
        return new Sm2State(due, interval, ease, delayedBeforeReviewTicks);
    }
}
