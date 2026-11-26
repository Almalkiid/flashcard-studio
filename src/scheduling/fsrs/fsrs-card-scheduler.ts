import type { StudioSettings } from "src/data/settings-model";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsScheduler } from "src/scheduling/fsrs/fsrs-scheduler";
import type { Fsrs7Answer } from "src/scheduling/fsrs7/fsrs7-history";
import { Fsrs7Scheduler } from "src/scheduling/fsrs7/fsrs7-scheduler";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { IScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { globalDateProvider } from "src/utils/clock";

/**
 * FSRS for cards, FSRS-6 or FSRS-7 as the settings choose (issue #27). With FSRS-7, new and reset cards and FSRS-7 cards
 * are answered with FSRS-7, and an FSRS-6 card moves to FSRS-7 when its whole history is in the review log; any other
 * card (SM-2, or FSRS-6 without its history) is answered with FSRS-6 exactly as before. With FSRS-6, every card is.
 * Notes are always scheduled with SM-2 (a note has no review history for FSRS to work from), so the
 * note methods are those of an SM-2 helper, which also keeps the note ease list.
 */
export class FsrsCardScheduler implements IScheduler {
    readonly algorithmType = SchedulerKind.FSRS;
    readonly noteOnLoadedNote: IScheduler["noteOnLoadedNote"];
    readonly noteCalcNewSchedule: IScheduler["noteCalcNewSchedule"];
    readonly noteCalcUpdatedSchedule: IScheduler["noteCalcUpdatedSchedule"];
    readonly noteStats: IScheduler["noteStats"];
    private scheduler: FsrsScheduler;
    private fsrs7: Fsrs7Scheduler | null;
    private history = new Map<string, Fsrs7Answer[]>();

    constructor(settings: StudioSettings) {
        const notes = new Sm2Scheduler(settings);
        this.noteOnLoadedNote = notes.noteOnLoadedNote.bind(notes);
        this.noteCalcNewSchedule = notes.noteCalcNewSchedule.bind(notes);
        this.noteCalcUpdatedSchedule = notes.noteCalcUpdatedSchedule.bind(notes);
        this.noteStats = notes.noteStats.bind(notes);
        this.scheduler = new FsrsScheduler(settings);
        this.fsrs7 = settings.fsrsVersion === 7 ? new Fsrs7Scheduler(settings) : null;
    }

    /** Applies changed settings (ts-fsrs freezes its parameters); the note helper and its ease list stay. */
    updateParameters(settings: StudioSettings): void {
        this.scheduler = new FsrsScheduler(settings);
        this.fsrs7 = settings.fsrsVersion === 7 ? new Fsrs7Scheduler(settings) : null;
    }

    /** Whether new answers use FSRS-7, so a review session should hand over the review history. */
    get usesFsrs7(): boolean {
        return this.fsrs7 !== null;
    }

    /** The complete history of each card (`fsrs7Histories`), read when a review session starts. */
    setReviewHistory(history: Map<string, Fsrs7Answer[]>): void {
        this.history = history;
    }

    cardGetResetSchedule(): ScheduleState {
        return this.scheduler.reset(globalDateProvider.now);
    }

    cardGetNewSchedule(
        response: ReviewResponse,
        notePath: string,
        cardHistogram: DueDateHistogram,
    ): ScheduleState {
        const scheduler = this.fsrs7 ?? this.scheduler;
        return scheduler.scheduleNew(response, globalDateProvider.now, cardHistogram, notePath);
    }

    cardCalcUpdatedSchedule(
        response: ReviewResponse,
        schedule: ScheduleState,
        cardHistogram: DueDateHistogram,
        cardId?: string | null,
    ): ScheduleState {
        const now = globalDateProvider.now;
        const fsrs7 = this.fsrs7;
        if (fsrs7 !== null && schedule instanceof FsrsState) {
            // A reset card is new again
            if (schedule.state === 0)
                return fsrs7.scheduleNew(response, now, cardHistogram, cardId ?? "");
            if (schedule.fsrs7) return fsrs7.schedule(schedule, response, now, cardHistogram);
            const answers = cardId ? this.history.get(cardId) : undefined;
            const moved = answers ? fsrs7.fromHistory(schedule, answers) : null;
            if (moved) return fsrs7.schedule(moved, response, now, cardHistogram);
        }
        return this.scheduler.schedule(schedule, response, now, cardHistogram);
    }
}
