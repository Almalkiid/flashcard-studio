import { Card } from "src/data/data-structures/card/flashcard";
import { Question } from "src/data/data-structures/card/question";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import type { Note } from "src/note-review/note";
import { DueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { sm2Step } from "src/scheduling/sm2/sm2-schedule";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { DateUtil, formatDate, globalDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { CommentParser } from "src/utils/schedule-comment";

import { loadGolden } from "../golden/load-golden";
import { ids, mismatches, Slot, view } from "../schedule/golden-views";
import { histogramOf, Outcome, RESPONSE, ResponseName, settingsOf, sm2Golden } from "./grid";
import { ScriptedLinks } from "./scripted-links";

beforeEach(() => {
    setupStaticDateProvider("2023-09-06");
});

/** What the golden files record of a schedule that is written to a note. */
const outcome = (schedule: ScheduleState): Outcome => ({
    text: schedule.formatScheduleAsComment(),
    interval: schedule.interval,
    ease: schedule.latestEase,
    dueDay: formatDate(schedule.dueDateAsUnix),
});

interface CardUpdateRow {
    id: string;
    config: string;
    histogram: string;
    response: ResponseName;
    input: { comment: string; overdueDays: number };
    read: { interval: number; ease: number; delayTicks: number };
    out: Outcome;
    ifBug1Fixed?: Outcome;
}
interface CardConstructedRow {
    id: string;
    response: ResponseName;
    input: { dueDay: string; interval: number; ease: number; overdueDays: number };
    delayTicks: number;
    out: Outcome;
}
interface CardNewRow {
    id: string;
    config: string;
    histogram: string;
    noteEaseInList: number | null;
    response: ResponseName;
    out: Outcome;
    delayTicks: number;
}
interface NoteGraphRow {
    id: string;
    links: Record<string, Record<string, number>>;
    eases: Record<string, number>;
    linkStats: Record<string, { linkTotal: number; linkPGTotal: number; totalLinkCount: number }>;
}
interface NoteNewRow {
    id: string;
    graph: string;
    maxLinkFactor: number;
    note: string;
    ownEaseInList: number | null;
    linkStat: { linkTotal: number; linkPGTotal: number; totalLinkCount: number };
    response: ResponseName;
    out: Outcome;
}
interface NoteUpdateRow {
    id: string;
    config?: string;
    histogram?: string;
    response: ResponseName;
    input: { dueDay: string; interval: number; ease: number; overdueDays: number };
    delayTicksIn: number;
    out: Outcome;
    easeListAfter: number;
}

const golden = sm2Golden as unknown as {
    cardUpdates: CardUpdateRow[];
    cardConstructed: CardConstructedRow[];
    cardNew: CardNewRow[];
    cardReset: { id: string; baseEase: number; out: Slot }[];
    noteGraphs: NoteGraphRow[];
    noteNew: NoteNewRow[];
    noteUpdates: NoteUpdateRow[];
    flashcardAverageEase: {
        id: string;
        baseEase: number;
        cards: number;
        averageEase: number;
        out: number;
    }[];
    noteOnLoadedNote: {
        id: string;
        input: { flashcardEases: number[] | null; noteEase: number | null };
        storedRaw: number | null;
        getEaseByPath: number | null;
    }[];
} & typeof sm2Golden;

const DAY = 86_400_000;

const algorithmOf = (config: string): Sm2Scheduler => new Sm2Scheduler(settingsOf(config));

describe("SM-2 cards", () => {
    // The oracle for rows the golden file cannot state: the same inputs through the pure arithmetic rows
    const pure = new Map(
        sm2Golden.sm2Step.map((row) => [
            [row.config, row.histogram, row.response, row.interval, row.ease, row.delayDays].join(
                "|",
            ),
            row.out,
        ]),
    );

    test("answers to cards read from comments (2,264 rows): overdue cards get their bonus, fractions are kept", () => {
        const classes = { sameAsBefore: 0, signFixed: 0, fractionKept: 0, fractionInGrid: 0 };
        const bad = mismatches(golden.cardUpdates, (row) => {
            const schedule = CommentParser.parseMultiScheduleComment(row.input.comment)[0];
            const actual = outcome(
                algorithmOf(row.config).cardCalcUpdatedSchedule(
                    RESPONSE[row.response],
                    schedule,
                    histogramOf(row.histogram),
                ),
            );

            const interval = parseFloat(row.input.comment.split(",")[1]);
            if (Number.isInteger(interval)) {
                // Whole intervals: the golden answer, or the answer with the corrected delay where that differs
                if (row.ifBug1Fixed) classes.signFixed++;
                else classes.sameAsBefore++;
                return { expected: row.ifBug1Fixed ?? row.out, actual };
            }

            // Fractional intervals are read as written now, so the answer starts from 10.8 and not from 10. Where the
            // grid has a row for the very same inputs (200 of the 216), that row says what the answer must be; for the
            // other 16 the pure arithmetic does (it is checked against the whole grid in sm2-schedule.test.ts)
            classes.fractionKept++;
            const key = [
                row.config,
                row.histogram,
                row.response,
                interval,
                schedule.latestEase,
                row.input.overdueDays,
            ].join("|");
            const gridRow = pure.get(key);
            if (gridRow) classes.fractionInGrid++;
            const wanted =
                gridRow ??
                sm2Step(
                    RESPONSE[row.response],
                    interval,
                    schedule.latestEase,
                    row.input.overdueDays * DAY,
                    settingsOf(row.config),
                    histogramOf(row.histogram),
                );
            const due = formatDate(globalDateProvider.today.add(wanted.interval, "d").valueOf());
            return {
                expected: {
                    text: `!${due},${wanted.interval},${wanted.ease}`,
                    interval: wanted.interval,
                    ease: wanted.ease,
                    dueDay: due,
                },
                actual,
            };
        });
        expect(golden.cardUpdates).toHaveLength(2264);
        expect(bad.slice(0, 3)).toEqual([]);
        expect(ids(bad)).toEqual([]);
        // Each class of change, by rule: 1,140 + 908 whole-interval rows, 216 fractional-interval rows
        expect(classes).toEqual({
            sameAsBefore: 1140,
            signFixed: 908,
            fractionKept: 216,
            fractionInGrid: 200,
        });
    });

    test("cards built with the schedule class (delay today minus due) give the golden answers (240 rows)", () => {
        const bad = mismatches(golden.cardConstructed, (row) => {
            const { dueDay, interval, ease } = row.input;
            const schedule = Sm2State.fromDueDateStr(dueDay, interval, ease);
            const answered = algorithmOf("defaults").cardCalcUpdatedSchedule(
                RESPONSE[row.response],
                schedule,
                histogramOf("empty"),
            );
            return {
                expected: { delay: row.delayTicks, out: row.out },
                actual: { delay: schedule.delayedBeforeReviewTicks, out: outcome(answered) },
            };
        });
        expect(golden.cardConstructed).toHaveLength(240);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("the first answer of a new card, with and without an ease from the note (360 rows)", () => {
        const bad = mismatches(golden.cardNew, (row) => {
            const algorithm = algorithmOf(row.config);
            if (row.noteEaseInList !== null) {
                algorithm.noteStats().setEaseForPath("n.md", row.noteEaseInList);
            }
            const schedule = algorithm.cardGetNewSchedule(
                RESPONSE[row.response],
                "n.md",
                histogramOf(row.histogram),
            );
            return {
                expected: { out: row.out, delay: row.delayTicks },
                actual: { out: outcome(schedule), delay: schedule.delayedBeforeReviewTicks },
            };
        });
        expect(golden.cardNew).toHaveLength(360);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("Reset gives a card due today with interval 1 and the base ease (4 rows)", () => {
        const bad = mismatches(golden.cardReset, (row) => ({
            expected: row.out,
            actual: view(
                new Sm2Scheduler({
                    ...DEFAULT_SETTINGS,
                    baseEase: row.baseEase,
                }).cardGetResetSchedule(),
            ),
        }));
        expect(golden.cardReset).toHaveLength(4);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("an FSRS schedule answered with SM-2 starts from its pseudo-ease and its lateness (72 rows)", () => {
        const rows = loadGolden<{
            fsrsSchedulesAnsweredUnderSm2: {
                id: string;
                config: string;
                response: ResponseName;
                input: { text: string; easeSeenBySm2: number; delayTicksSeenBySm2: number };
                out: { text: string; interval: number; ease: number };
            }[];
        }>("fsrs").fsrsSchedulesAnsweredUnderSm2;
        const bad = mismatches(rows, (row) => {
            const schedule = CommentParser.parseMultiScheduleComment(row.input.text)[0];
            const answered = algorithmOf(row.config).cardCalcUpdatedSchedule(
                RESPONSE[row.response],
                schedule,
                new DueDateHistogram(),
            );
            return {
                expected: [row.input.easeSeenBySm2, row.input.delayTicksSeenBySm2, row.out],
                actual: [
                    schedule.latestEase,
                    schedule.delayedBeforeReviewTicks,
                    {
                        text: answered.formatScheduleAsComment(),
                        interval: answered.interval,
                        ease: answered.latestEase,
                    },
                ],
            };
        });
        expect(rows).toHaveLength(72);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("it reads its settings when it answers, not when it was built", () => {
        const settings = settingsOf("defaults");
        const algorithm = new Sm2Scheduler(settings);
        const card = Sm2State.fromDueDateStr("2023-09-06", 10, 250);
        const before = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Easy, card, undefined);
        settings.easyBonus = 2;
        settings.baseEase = 300;
        const after = algorithm.cardCalcUpdatedSchedule(ReviewResponse.Easy, card, undefined);
        expect(after.interval).toBeGreaterThan(before.interval);
        expect(algorithm.cardGetResetSchedule().latestEase).toBe(300);
    });

    test("an answer leaves the schedule it was given alone", () => {
        const card = Sm2State.fromDueDateStr("2023-09-02", 4, 270);
        const snapshot = JSON.stringify(card);
        algorithmOf("defaults").cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            card,
            new DueDateHistogram(),
        );
        expect(JSON.stringify(card)).toBe(snapshot);
    });
});

describe("SM-2 notes", () => {
    /** A graph over the golden links, and a scheduler whose ease list holds the golden eases. */
    function setup(row: NoteGraphRow, maxLinkFactor: number) {
        const graph = new NoteLinkGraph(new ScriptedLinks(row.links));
        for (const path of Object.keys(row.linkStats)) graph.processLinks(path);
        graph.generatePageRanks();
        const algorithm = new Sm2Scheduler({ ...settingsOf("defaults"), maxLinkFactor });
        for (const [path, ease] of Object.entries(row.eases)) {
            algorithm.noteStats().setEaseForPath(path, ease);
        }
        return { graph, algorithm };
    }
    const graphs = new Map(golden.noteGraphs.map((row) => [row.id.slice(6), row]));
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

    test("a note's first review from its links, 684 rows over 11 graphs and 3 link factors", () => {
        const bad = mismatches(golden.noteNew, (row) => {
            const { graph, algorithm } = setup(graphs.get(row.graph), row.maxLinkFactor);
            const stat = graph.calcNoteLinkStat(row.note, algorithm.noteStats());
            const schedule = algorithm.noteCalcNewSchedule(
                row.note,
                graph,
                RESPONSE[row.response],
                new DueDateHistogram(),
            );
            return {
                expected: [true, row.out],
                actual: [
                    close(stat.linkTotal, row.linkStat.linkTotal) &&
                        close(stat.linkPGTotal, row.linkStat.linkPGTotal) &&
                        stat.totalLinkCount === row.linkStat.totalLinkCount,
                    outcome(schedule),
                ],
            };
        });
        expect(golden.noteNew).toHaveLength(684);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a later review, with the sign notes always had (768 rows), records the new ease", () => {
        const bad = mismatches(golden.noteUpdates, (row) => {
            const algorithm = algorithmOf(row.config ?? "defaults");
            const { dueDay, interval, ease } = row.input;
            const schedule = Sm2State.fromDueDateStr(dueDay, interval, ease);
            const answered = algorithm.noteCalcUpdatedSchedule(
                "n.md",
                schedule,
                RESPONSE[row.response],
                histogramOf(row.histogram ?? "empty"),
            );
            // The 48 rows over a busy histogram only record the answer
            const easeAfter = algorithm.noteStats().dict["n.md"];
            return {
                expected: [
                    row.delayTicksIn ?? schedule.delayedBeforeReviewTicks,
                    row.out,
                    row.easeListAfter ?? easeAfter,
                ],
                actual: [schedule.delayedBeforeReviewTicks, outcome(answered), easeAfter],
            };
        });
        expect(golden.noteUpdates).toHaveLength(768);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("a first review does not touch the ease list", () => {
        const { graph, algorithm } = setup(graphs.get("g-isolated"), 1);
        algorithm.noteCalcNewSchedule("A.md", graph, ReviewResponse.Easy, new DueDateHistogram());
        expect(algorithm.noteStats().dict).toEqual({});
    });

    test("the average ease of a note's cards (89 rows)", () => {
        const questionOf = (count: number, ease: number): Question =>
            ({
                cards: Array.from(
                    { length: count },
                    () =>
                        new Card({
                            scheduleInfo: new Sm2State(
                                DateUtil.dateStrToMoment("2023-09-10"),
                                4,
                                ease,
                            ),
                        }),
                ),
            }) as unknown as Question;
        const bad = mismatches(golden.flashcardAverageEase, (row) => {
            const settings = { ...DEFAULT_SETTINGS, baseEase: row.baseEase };
            // One row mixes two questions: [300, unscheduled] and [200], an average of 250
            const questions =
                row.id === "avgEase/mixed"
                    ? [{ cards: [questionOf(1, 300).cards[0], new Card()] }, questionOf(1, 200)]
                    : [questionOf(row.cards, row.averageEase)];
            return {
                expected: row.out,
                actual: Sm2Scheduler.calculateFlashcardAvgEase(questions as Question[], settings),
            };
        });
        expect(golden.flashcardAverageEase).toHaveLength(89);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });

    test("cards without a schedule do not count towards the average", () => {
        const scheduled = new Card({
            scheduleInfo: new Sm2State(DateUtil.dateStrToMoment("2023-09-10"), 4, 300),
        });
        const question = { cards: [new Card(), scheduled, new Card()] } as unknown as Question;
        const one = Sm2Scheduler.calculateFlashcardAvgEase([question], DEFAULT_SETTINGS);
        const alone = Sm2Scheduler.calculateFlashcardAvgEase(
            [{ cards: [scheduled] } as unknown as Question],
            DEFAULT_SETTINGS,
        );
        expect(one).toBe(alone);
    });

    test("what a note teaches the ease list when it is loaded (16 rows)", () => {
        const bad = mismatches(golden.noteOnLoadedNote, (row) => {
            const algorithm = algorithmOf("defaults");
            const note =
                row.input.flashcardEases === null
                    ? null
                    : ({
                          questionList: [
                              {
                                  cards: row.input.flashcardEases.map(
                                      (ease) =>
                                          new Card({
                                              scheduleInfo: new Sm2State(
                                                  DateUtil.dateStrToMoment("2023-09-10"),
                                                  4,
                                                  ease,
                                              ),
                                          }),
                                  ),
                              },
                          ],
                      } as unknown as Note);
            algorithm.noteOnLoadedNote("n.md", note, row.input.noteEase);
            return {
                expected: [row.storedRaw, row.getEaseByPath],
                actual: [
                    algorithm.noteStats().dict["n.md"] ?? null,
                    algorithm.noteStats().getEaseByPath("n.md"),
                ],
            };
        });
        expect(golden.noteOnLoadedNote).toHaveLength(16);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

describe("notes under the FSRS setting", () => {
    test("they run on the SM-2 arithmetic and share one ease list (8 rows, in the order the file lists them)", () => {
        const rows = loadGolden<{
            notesUnderFsrsSetting: {
                id: string;
                grade: string;
                out: { class: string; text: string };
            }[];
        }>("fsrs").notesUnderFsrsSetting;
        const algorithm = new FsrsCardScheduler({ ...DEFAULT_SETTINGS });
        const graph = new NoteLinkGraph(new ScriptedLinks({ "n.md": {} }));
        graph.processLinks("n.md");
        graph.generatePageRanks();
        // The file does not record the setups; this one reproduces all 8: a new note with nothing linked, and an
        // update from the inventory's 4-days-overdue note (due 2023-09-02, interval 10, ease 250)
        const bad = mismatches(rows, (row) => {
            const response = RESPONSE[row.grade as ResponseName];
            const schedule = row.id.startsWith("fsrsNoteNew")
                ? algorithm.noteCalcNewSchedule("n.md", graph, response, new DueDateHistogram())
                : algorithm.noteCalcUpdatedSchedule(
                      "n.md",
                      Sm2State.fromDueDateStr("2023-09-02", 10, 250),
                      response,
                      new DueDateHistogram(),
                  );
            return {
                expected: row.out,
                actual: {
                    class: schedule.constructor.name,
                    text: schedule.formatScheduleAsComment(),
                },
            };
        });
        expect(rows).toHaveLength(8);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});
