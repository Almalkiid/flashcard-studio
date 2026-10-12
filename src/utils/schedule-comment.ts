import { State } from "ts-fsrs";

import { PREFERRED_DATE_FORMAT } from "src/data/formats";
import {
    FSRS_COMMENT_PREFIX,
    FsrsState,
    parseFsrsTimestamp,
} from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { DateUtil, formatDate } from "src/utils/clock";

/**
 * Reads the text of a `<!--SR:...-->` comment: one segment per card of a question, each starting with `!`, in the
 * order of the cards. Anything after the fields a segment needs (`id=...`, `susp`, ...) is not part of the schedule.
 *
 * Where a segment holds no schedule (a card not reviewed yet) the reader gives null for that card, so the other cards
 * keep their places. A segment that cannot be read is dropped the same way, with a warning in the console.
 */
export class CommentParser {
    /** One entry per segment, in order; null where a segment has no schedule. */
    static parseMultiScheduleComment(comment: string): ScheduleState[] {
        return CommentParser.splitSegments(comment).map((piece) =>
            CommentParser.parseScheduleSegment(piece),
        );
    }

    /** The pieces of a comment's text between its `!`, trimmed, with the empty ones dropped. */
    static splitSegments(comment: string): string[] {
        const pieces: string[] = [];
        for (const raw of comment.split("!")) {
            const piece = raw.trim();
            if (piece) pieces.push(piece);
        }
        return pieces;
    }

    /**
     * One segment: `fsrs,due,interval,stability,difficulty,state,reps,lapses,learningSteps,lastReview` or SM-2's
     * `due,interval,ease`.
     *
     * @returns The schedule, or null for an unreviewed card or text that is not a schedule.
     */
    static parseScheduleSegment(segment: string): ScheduleState | null {
        const fields = segment.split(",");
        return segment.startsWith(`${FSRS_COMMENT_PREFIX},`)
            ? CommentParser.parseFsrsFields(fields)
            : CommentParser.parseSM2Schedule(
                  fields[0],
                  parseFloat(fields[1]),
                  parseInt(fields[2]),
                  segment,
              );
    }

    /**
     * An SM-2 schedule from a due date in any of the accepted formats, an interval and an ease. The interval may have
     * a fraction (written when load balancing is off), and is read as written; the ease is a whole number.
     *
     * The delay is the start of today minus the due date, so it is positive for an overdue card, which then gets the
     * overdue bonus, and negative for a card reviewed early. Notes are read the same way.
     *
     * @param segment - The text the warning shows when the schedule cannot be read; the three values as numbers if left
     *                  out.
     * @returns The schedule, or null for the date that marks a card never reviewed, or (with a warning) when the date
     *          or either number cannot be read.
     */
    static parseSM2Schedule(
        dueDateStr: string,
        interval: number,
        ease: number,
        segment = `${dueDateStr},${interval},${ease}`,
    ): ScheduleState | null {
        const dueDate = DateUtil.dateStrToMoment(dueDateStr);
        if (!dueDate.isValid() || !Number.isFinite(interval) || !Number.isFinite(ease)) {
            CommentParser.warnUnreadable(segment);
            return null;
        }
        if (
            formatDate(dueDate.valueOf(), PREFERRED_DATE_FORMAT) === Sm2State.dummyDueDateForNewCard
        ) {
            return null;
        }
        return new Sm2State(dueDate, interval, ease);
    }

    /**
     * An FSRS schedule needs the word `fsrs` and eight values, nine fields (due, interval, stability, difficulty,
     * state, reps, lapses, learning steps); the last review is a tenth field and optional. Fewer than nine fields, or a
     * value that is no number or a state outside 0 to 3, is no schedule. A dash for the due date is the placeholder of
     * a card not reviewed yet; a last review that is a dash, missing or no time means none.
     */
    private static parseFsrsFields(fields: string[]): FsrsState | null {
        const [, due, interval, stability, difficulty, state, reps, lapses, steps, lastReview] =
            fields;
        if (due === "-") return null;

        const dueDate = parseFsrsTimestamp(due);
        const numbers = {
            interval: parseFloat(interval),
            stability: parseFloat(stability),
            difficulty: parseFloat(difficulty),
            state: parseInt(state),
            reps: parseInt(reps),
            lapses: parseInt(lapses),
            steps: parseInt(steps),
        };
        if (
            !dueDate.isValid() ||
            !Object.values(numbers).every(Number.isFinite) ||
            State[numbers.state] === undefined
        ) {
            CommentParser.warnUnreadable(fields.join(","));
            return null;
        }

        const last = lastReview === undefined ? null : parseFsrsTimestamp(lastReview);
        return new FsrsState(
            dueDate,
            numbers.interval,
            numbers.difficulty,
            numbers.stability,
            numbers.state,
            numbers.reps,
            numbers.lapses,
            numbers.steps,
            last?.isValid() ? last : null,
        );
    }

    private static warnUnreadable(segment: string): void {
        console.warn(`Flashcard Studio: ignored a schedule that cannot be read: "${segment}"`);
    }
}
