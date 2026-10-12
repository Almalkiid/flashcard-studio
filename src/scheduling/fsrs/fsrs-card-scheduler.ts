import type { StudioSettings } from "src/data/settings-model";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsScheduler } from "src/scheduling/fsrs/fsrs-scheduler";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { IScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { globalDateProvider } from "src/utils/clock";

/**
 * FSRS for cards. Notes are always scheduled with SM-2 (a note has no review history for FSRS to work from), so the
 * note methods are those of an SM-2 helper, which also keeps the note ease list.
 */
export class FsrsCardScheduler implements IScheduler {
    readonly algorithmType = SchedulerKind.FSRS;
    readonly noteOnLoadedNote: IScheduler["noteOnLoadedNote"];
    readonly noteCalcNewSchedule: IScheduler["noteCalcNewSchedule"];
    readonly noteCalcUpdatedSchedule: IScheduler["noteCalcUpdatedSchedule"];
    readonly noteStats: IScheduler["noteStats"];
    private scheduler: FsrsScheduler;

    constructor(settings: StudioSettings) {
        const notes = new Sm2Scheduler(settings);
        this.noteOnLoadedNote = notes.noteOnLoadedNote.bind(notes);
        this.noteCalcNewSchedule = notes.noteCalcNewSchedule.bind(notes);
        this.noteCalcUpdatedSchedule = notes.noteCalcUpdatedSchedule.bind(notes);
        this.noteStats = notes.noteStats.bind(notes);
        this.scheduler = new FsrsScheduler(settings);
    }

    /** Applies changed settings (ts-fsrs freezes its parameters); the note helper and its ease list stay. */
    updateParameters(settings: StudioSettings): void {
        this.scheduler = new FsrsScheduler(settings);
    }

    cardGetResetSchedule(): ScheduleState {
        return this.scheduler.reset(globalDateProvider.now);
    }

    cardGetNewSchedule(
        response: ReviewResponse,
        notePath: string,
        cardHistogram: DueDateHistogram,
    ): ScheduleState {
        return this.scheduler.scheduleNew(
            response,
            globalDateProvider.now,
            cardHistogram,
            notePath,
        );
    }

    cardCalcUpdatedSchedule(
        response: ReviewResponse,
        schedule: ScheduleState,
        cardHistogram: DueDateHistogram,
    ): ScheduleState {
        return this.scheduler.schedule(schedule, response, globalDateProvider.now, cardHistogram);
    }
}
