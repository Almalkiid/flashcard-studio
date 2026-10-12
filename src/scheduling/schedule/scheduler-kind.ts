import type { Note } from "src/note-review/note";
import type { INoteEaseList } from "src/note-review/note-ease-list";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import type { NoteLinkGraph } from "src/scheduling/sm2/note-graph";

/** The two schedulers a setting can pick. The values are what `data.json` stores; "SM-2-OSR" is kept from the Spaced Repetition plugin. */
export enum SchedulerKind {
    SM2 = "SM-2-OSR",
    FSRS = "FSRS",
}

/**
 * What the review and the note scan need from a scheduler. Both implementations return a new schedule and leave the
 * one they are given alone (SM-2 also records the note's new ease in the ease list); neither touches the histograms,
 * the review session does.
 */
export interface IScheduler {
    algorithmType: SchedulerKind;

    /** Teaches the scheduler a note's current ease while the vault is scanned. */
    noteOnLoadedNote(path: string, note: Note | null, noteEase: number | null): void;
    /** The first review of a note. */
    noteCalcNewSchedule(
        notePath: string,
        graph: NoteLinkGraph,
        response: ReviewResponse,
        noteHistogram: DueDateHistogram,
    ): ScheduleState;
    /** A later review of a note. */
    noteCalcUpdatedSchedule(
        notePath: string,
        previous: ScheduleState,
        response: ReviewResponse,
        noteHistogram: DueDateHistogram,
    ): ScheduleState;
    noteStats(): INoteEaseList;

    /** The schedule the Reset button gives a card that has one. */
    cardGetResetSchedule(): ScheduleState;
    /** The first answer of a card with no schedule. */
    cardGetNewSchedule(
        response: ReviewResponse,
        notePath: string,
        cardHistogram: DueDateHistogram,
    ): ScheduleState;
    /** Every later answer. */
    cardCalcUpdatedSchedule(
        response: ReviewResponse,
        schedule: ScheduleState,
        cardHistogram: DueDateHistogram,
    ): ScheduleState;
}

/** Holds the scheduler the plugin runs with; the data manager sets it, and tests assign it directly. */
export class ActiveScheduler {
    static instance: IScheduler;

    static getInstance(): IScheduler {
        if (!ActiveScheduler.instance) throw new Error("there is no scheduler instance.");
        return ActiveScheduler.instance;
    }
}
