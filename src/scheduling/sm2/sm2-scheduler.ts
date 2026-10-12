import type { Moment } from "moment";

import type { Question } from "src/data/data-structures/card/question";
import type { StudioSettings } from "src/data/settings-model";
import type { Note } from "src/note-review/note";
import { INoteEaseList, NoteEaseList } from "src/note-review/note-ease-list";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import type { ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { IScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import type { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { sm2Step } from "src/scheduling/sm2/sm2-schedule";
import { globalDateProvider } from "src/utils/clock";

/**
 * SM-2 for cards and notes. It keeps the ease the notes had when they were scanned or last reviewed (the note ease
 * list), so a note's new cards and the notes it is linked with start from a fitting ease. The settings are read when
 * an answer is worked out, so a changed setting counts from the next answer.
 */
export class Sm2Scheduler implements IScheduler {
    readonly algorithmType = SchedulerKind.SM2;
    private readonly noteEaseList: INoteEaseList;

    constructor(private readonly settings: StudioSettings) {
        this.noteEaseList = new NoteEaseList(settings);
    }

    /**
     * What a scan of the vault teaches about a note: its flashcards' average ease and the ease of its own schedule,
     * halfway between them when it has both. A note with neither teaches nothing.
     */
    noteOnLoadedNote(path: string, note: Note | null, noteEase: number | null): void {
        const flashcardAverage = note
            ? Sm2Scheduler.calculateFlashcardAvgEase(note.questionList, this.settings)
            : null;
        const ease =
            flashcardAverage && noteEase
                ? (flashcardAverage + noteEase) / 2
                : flashcardAverage || noteEase;
        if (ease) this.noteEaseList.setEaseForPath(path, ease);
    }

    /**
     * The mean ease of the scheduled cards of the questions, pulled towards the base ease when there are few of them:
     * one card counts for a tenth, 64 or more for all of it. 0 when no card has a schedule.
     */
    static calculateFlashcardAvgEase(questionList: Question[], settings: StudioSettings): number {
        let total = 0;
        let count = 0;
        for (const question of questionList) {
            for (const card of question.cards) {
                if (!card.hasSchedule) continue;
                total += card.scheduleInfo.latestEase;
                count++;
            }
        }
        if (count === 0) return 0;

        const weight = Math.min(1, Math.log(count + 0.5) / Math.log(64));
        return (total / count) * weight + settings.baseEase * (1 - weight);
    }

    noteStats(): INoteEaseList {
        return this.noteEaseList;
    }

    /**
     * A note's first review. Its ease starts from the base ease, drawn towards the eases of the notes it is linked
     * with (more the more of them there are, up to `maxLinkFactor`), and towards the ease its own flashcards taught.
     */
    noteCalcNewSchedule(
        notePath: string,
        graph: NoteLinkGraph,
        response: ReviewResponse,
        noteHistogram: DueDateHistogram,
    ): ScheduleState {
        const { baseEase, maxLinkFactor } = this.settings;
        const stat = graph.calcNoteLinkStat(notePath, this.noteEaseList);
        const linkContribution =
            maxLinkFactor * Math.min(1, Math.log(stat.totalLinkCount + 0.5) / Math.log(64));
        let ease =
            (1 - linkContribution) * baseEase +
            (stat.totalLinkCount > 0
                ? (linkContribution * stat.linkTotal) / stat.linkPGTotal
                : linkContribution * baseEase);

        const known = this.noteEaseList.getEaseByPath(notePath);
        if (known) ease = (ease + known) / 2;

        const { interval, ease: newEase } = sm2Step(
            response,
            Sm2State.initialInterval,
            Math.round(ease),
            0,
            this.settings,
            noteHistogram,
        );
        return this.scheduleFor(interval, newEase);
    }

    /** A note's later review. The new ease is recorded for the notes linked with it. */
    noteCalcUpdatedSchedule(
        notePath: string,
        previous: ScheduleState,
        response: ReviewResponse,
        noteHistogram: DueDateHistogram,
    ): ScheduleState {
        const { interval, ease } = sm2Step(
            response,
            previous.interval,
            previous.latestEase,
            previous.delayedBeforeReviewTicks,
            this.settings,
            noteHistogram,
        );
        this.noteEaseList.setEaseForPath(notePath, ease);
        return this.scheduleFor(interval, ease, null);
    }

    /** The schedule of a card the Reset button was pressed on: due today, one day, the base ease. */
    cardGetResetSchedule(): ScheduleState {
        return new Sm2State(this.today(), Sm2State.initialInterval, this.settings.baseEase, 0);
    }

    /** A card's first answer. It starts from the ease its note has, if the note has one. */
    cardGetNewSchedule(
        response: ReviewResponse,
        notePath: string,
        cardHistogram: DueDateHistogram,
    ): ScheduleState {
        const { interval, ease } = sm2Step(
            response,
            Sm2State.initialInterval,
            this.noteEaseList.getEaseByPath(notePath) ?? this.settings.baseEase,
            0,
            this.settings,
            cardHistogram,
        );
        return this.scheduleFor(interval, ease);
    }

    /** A card's later answer. It reads only the interval, ease and lateness, so an FSRS schedule works too. */
    cardCalcUpdatedSchedule(
        response: ReviewResponse,
        schedule: ScheduleState,
        cardHistogram: DueDateHistogram,
    ): ScheduleState {
        const { interval, ease } = sm2Step(
            response,
            schedule.interval,
            schedule.latestEase,
            schedule.delayedBeforeReviewTicks,
            this.settings,
            cardHistogram,
        );
        return this.scheduleFor(interval, ease);
    }

    private today(): Moment {
        return globalDateProvider.today;
    }

    /**
     * The schedule for an answer: due that many days after today (half a day rounds up). Its lateness is 0, or null
     * to work it out from the due date as a schedule read from a note's frontmatter has it (negative: not due yet).
     */
    private scheduleFor(
        interval: number,
        ease: number,
        delayedBeforeReviewTicks: number | null = 0,
    ): ScheduleState {
        return new Sm2State(
            this.today().add(interval, "d"),
            interval,
            ease,
            delayedBeforeReviewTicks,
        );
    }
}
