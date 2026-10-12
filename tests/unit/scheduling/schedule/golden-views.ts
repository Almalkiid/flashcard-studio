import type { Moment } from "moment";
import { State } from "ts-fsrs";
import { isDeepStrictEqual } from "util";

import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { DateUtil, formatDate } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

/** A schedule as plain data, the shape the golden files use (golden/README.md, "Reading the files"). */
export type Slot = Record<string, unknown>;

/** JSON cannot hold NaN, the infinities or -0, so the golden files spell them as text. */
export function encodeNumber(n: number): number | string {
    if (Number.isNaN(n)) return "@NaN";
    if (n === Infinity) return "@Infinity";
    if (n === -Infinity) return "@-Infinity";
    return Object.is(n, -0) ? "@-0" : n;
}

function isoOf(time: Moment | null | undefined): string | null {
    if (!time) return null;
    return time.isValid() ? time.toDate().toISOString() : "@invalid";
}

/** What the golden files record for a schedule; null for a card with no schedule. */
export function view(schedule: ScheduleState | null | undefined): Slot | null {
    if (!schedule) return null;
    let text: string;
    try {
        text = schedule.formatScheduleAsComment();
    } catch (error) {
        text = `@throws: ${(error as Error).message}`;
    }
    const slot: Slot = {
        algorithm: schedule.algorithmType,
        dueIso: isoOf(schedule.dueDate),
        dueDay: formatDate(schedule.dueDate.valueOf()),
        interval: encodeNumber(schedule.interval),
        ease: encodeNumber(schedule.latestEase),
        delayTicks: encodeNumber(schedule.delayedBeforeReviewTicks),
    };
    if (schedule instanceof FsrsState) {
        Object.assign(slot, {
            difficulty: encodeNumber(schedule.difficulty),
            stability: encodeNumber(schedule.stability),
            state: encodeNumber(schedule.state),
            reps: encodeNumber(schedule.reps),
            lapses: encodeNumber(schedule.lapses),
            learningSteps: encodeNumber(schedule.learningSteps),
            lastReviewIso: isoOf(schedule.lastReview),
        });
    }
    return Object.assign(slot, { isDue: schedule.isDue(), text });
}

/** An SM-2 schedule from a golden `dueDay` (local `YYYY-MM-DD`). */
export function sm2Step(dueDay: string, interval: number, ease: number): Sm2State {
    return new Sm2State(DateUtil.dateStrToMoment(dueDay), interval, ease);
}

/** The ten FSRS numbers and times as the golden inputs list them. */
export interface FsrsInput {
    dueIso: string;
    interval: number;
    difficulty: number;
    stability: number;
    state: State;
    reps: number;
    lapses: number;
    learningSteps: number;
    lastReviewIso: string | null;
}

export function fsrsSchedule(input: FsrsInput): FsrsState {
    return new FsrsState(
        moment(input.dueIso),
        input.interval,
        input.difficulty,
        input.stability,
        input.state,
        input.reps,
        input.lapses,
        input.learningSteps,
        input.lastReviewIso ? moment(input.lastReviewIso) : null,
    );
}

/** One row that did not come out as the golden file says. */
export interface Mismatch {
    id: string;
    expected: unknown;
    actual: unknown;
}

/**
 * Runs `check` on every row and returns the ones whose actual value differs from the expected one. Asserting
 * `ids(result)` equals `[]` names every bad row at once, and the first few mismatches show their values.
 */
export function mismatches<R extends { id: string }>(
    rows: R[],
    check: (row: R) => { expected: unknown; actual: unknown },
): Mismatch[] {
    const bad: Mismatch[] = [];
    for (const row of rows) {
        const { expected, actual } = check(row);
        if (!isDeepStrictEqual(actual, expected)) bad.push({ id: row.id, expected, actual });
    }
    return bad;
}

export const ids = (bad: Mismatch[]): string[] => bad.map((m) => m.id);
