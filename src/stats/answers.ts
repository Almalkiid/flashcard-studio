import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { isReview } from "src/stats/activity";
import { addDays, DayKeyFn } from "src/stats/day-keys";
import { MATURE_INTERVAL_DAYS } from "src/stats/types";

export interface AnswerGroup {
    /** Answers per button: Again, Hard, Good, Easy. */
    counts: number[];
    total: number;
    /** Share of the answers that were not Again; null without answers. */
    correct: number | null;
}

export interface AnswerButtons {
    /** New cards and cards being relearned. */
    learning: AnswerGroup;
    /** Review cards whose interval before the answer was under 21 days. */
    young: AnswerGroup;
    /** Review cards whose interval before the answer was 21 days or more. */
    mature: AnswerGroup;
}

function emptyGroup(): AnswerGroup {
    return { counts: [0, 0, 0, 0], total: 0, correct: null };
}

/**
 * How often each answer button was pressed, for learning, young and mature cards. Cram answers and manual resets are
 * not counted.
 */
export function answerButtons(entries: ReviewLogEntry[]): AnswerButtons {
    const result: AnswerButtons = {
        learning: emptyGroup(),
        young: emptyGroup(),
        mature: emptyGroup(),
    };
    for (const entry of entries) {
        if (!isReview(entry) || entry.k === 3) continue;
        const group =
            entry.k === 1
                ? entry.li >= MATURE_INTERVAL_DAYS
                    ? result.mature
                    : result.young
                : result.learning;
        group.counts[entry.r - 1]++;
        group.total++;
    }
    for (const group of [result.learning, result.young, result.mature]) {
        if (group.total > 0) group.correct = (group.total - group.counts[0]) / group.total;
    }
    return result;
}

export interface RetentionCell {
    passed: number;
    total: number;
    rate: number | null;
}

export type RetentionRowId = "today" | "yesterday" | "last7" | "last30" | "last365";

export interface RetentionRow {
    id: RetentionRowId;
    young: RetentionCell;
    mature: RetentionCell;
    all: RetentionCell;
}

const ROW_DAYS: { id: RetentionRowId; first: number; last: number }[] = [
    { id: "today", first: 0, last: 0 },
    { id: "yesterday", first: -1, last: -1 },
    { id: "last7", first: -6, last: 0 },
    { id: "last30", first: -29, last: 0 },
    { id: "last365", first: -364, last: 0 },
];

function emptyCell(): RetentionCell {
    return { passed: 0, total: 0, rate: null };
}

function addAnswer(cell: RetentionCell, passed: boolean): void {
    cell.total++;
    if (passed) cell.passed++;
}

/**
 * Anki's "True retention" table: how often review cards were remembered, for young and mature cards over several
 * periods. Only answers to review cards count (not learning, relearning, cram or manual), and only the first answer
 * to a card on a day. Again is a fail; Hard, Good and Easy pass.
 */
export function trueRetention(
    entries: ReviewLogEntry[],
    todayKey: string,
    dayKeyOf: DayKeyFn,
): RetentionRow[] {
    // The first review answer of each card on each study day
    const firstOfDay = new Map<string, { entry: ReviewLogEntry; day: string }>();
    const unmerged: { entry: ReviewLogEntry; day: string }[] = [];
    for (const entry of entries) {
        if (!isReview(entry) || entry.k !== 1) continue;
        const day = dayKeyOf(entry.t);
        if (entry.c === "") {
            unmerged.push({ entry, day });
            continue;
        }
        const key = `${entry.c}|${day}`;
        const existing = firstOfDay.get(key);
        if (existing === undefined || entry.t < existing.entry.t)
            firstOfDay.set(key, { entry, day });
    }

    const rows: RetentionRow[] = ROW_DAYS.map(({ id }): RetentionRow => ({
        id,
        young: emptyCell(),
        mature: emptyCell(),
        all: emptyCell(),
    }));
    const bounds = ROW_DAYS.map(({ first, last }) => ({
        from: addDays(todayKey, first),
        to: addDays(todayKey, last),
    }));

    for (const { entry, day } of [...firstOfDay.values(), ...unmerged]) {
        const passed = entry.r > 1;
        const mature = entry.li >= MATURE_INTERVAL_DAYS;
        rows.forEach((row, index) => {
            if (day < bounds[index].from || day > bounds[index].to) return;
            addAnswer(mature ? row.mature : row.young, passed);
            addAnswer(row.all, passed);
        });
    }

    for (const row of rows) {
        for (const cell of [row.young, row.mature, row.all]) {
            if (cell.total > 0) cell.rate = cell.passed / cell.total;
        }
    }
    return rows;
}
