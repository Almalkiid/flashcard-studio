import { DueDateHistogram } from "src/scheduling/due-histogram";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { setupStaticDateProvider } from "src/utils/clock";
import { CommentParser } from "src/utils/schedule-comment";

import { RESPONSE, ResponseName, settingsOf, sm2Golden } from "./grid";
import { ScriptedLinks } from "./scripted-links";

/**
 * The worked examples of inventory 7.2 and 7.3 (32 of the 73 cross-checks in the golden file; the others are
 * arithmetic and are in sm2-schedule.test.ts), run again. Four of them show the sign bug of D2 #1 and read differently
 * now; each of those says so.
 */

const examples = new Map(
    sm2Golden.inventoryCrossChecks
        .filter((row) => !row.input?.response && typeof row.actual === "string")
        .map((row) => [row.id, row.actual as unknown as string]),
);
const NAMES: ResponseName[] = ["Easy", "Good", "Hard", "Again"];

beforeEach(() => {
    setupStaticDateProvider("2023-09-06");
});

const text = (schedule: ScheduleState): string => schedule.formatScheduleAsComment();
const algorithm = (config = "defaults") => new Sm2Scheduler(settingsOf(config));
const empty = () => new DueDateHistogram();

/** The notes of an inventory graph: the links, the eases the ease list holds, and the scheduler over them. */
function notes(graphId: string) {
    const row = (
        sm2Golden as unknown as {
            noteGraphs: {
                id: string;
                links: Record<string, Record<string, number>>;
                eases: Record<string, number>;
                linkStats: object;
            }[];
        }
    ).noteGraphs.find((candidate) => candidate.id === graphId);
    const graph = new NoteLinkGraph(new ScriptedLinks(row.links));
    for (const path of Object.keys(row.linkStats)) graph.processLinks(path);
    graph.generatePageRanks();
    const scheduler = algorithm();
    for (const [path, ease] of Object.entries(row.eases)) {
        scheduler.noteStats().setEaseForPath(path, ease);
    }
    return { graph, scheduler };
}

describe("inventory 7.2: cards", () => {
    test.each(NAMES)("a new card, %s", (name) => {
        const schedule = algorithm().cardGetNewSchedule(RESPONSE[name], "n.md", empty());
        expect(text(schedule)).toBe(examples.get(`w-cardNew-${name}`));
    });

    test.each(NAMES)("a new card whose note has ease 273.4, %s", (name) => {
        const scheduler = algorithm();
        scheduler.noteStats().setEaseForPath("n.md", 273.4);
        const schedule = scheduler.cardGetNewSchedule(RESPONSE[name], "n.md", empty());
        expect(text(schedule)).toBe(examples.get(`w-cardNew-noteEase273.4-${name}`));
    });

    test.each(NAMES)("a card four days overdue (delay +4 days), %s", (name) => {
        const card = Sm2State.fromDueDateStr("2023-09-02", 4, 270);
        const answered = algorithm().cardCalcUpdatedSchedule(RESPONSE[name], card, empty());
        expect(text(answered)).toBe(examples.get(`w-card-delay-plus4-${name}`));
    });

    // D2 #1: the inventory read this card (!2023-09-02,4,270, four days overdue) with the sign that gave it no bonus
    // (Easy 15, Good 11, Hard 2); it is now read as overdue, which is what the "+4 days" examples above show
    test.each(NAMES)(
        "the same card read from its comment, %s (D2 #1: now with the bonus)",
        (name) => {
            const card = CommentParser.parseMultiScheduleComment("!2023-09-02,4,270")[0];
            const answered = algorithm().cardCalcUpdatedSchedule(RESPONSE[name], card, empty());
            expect(text(answered)).toBe(examples.get(`w-card-delay-plus4-${name}`));
            // Again ignores lateness, so it reads the same as before
            const before = examples.get(`w-card-read-from-comment-${name}`);
            if (name === "Again") expect(text(answered)).toBe(before);
            else expect(text(answered)).not.toBe(before);
        },
    );

    // D2 #1: a card due in four days read from a note's comment counted as four days overdue (Good 16 days); it is
    // early now, so it gets no bonus: Good gives 11 days, as the card due today does
    test("a card due in four days, Good (D2 #1: no bonus for being early)", () => {
        const card = CommentParser.parseMultiScheduleComment("!2023-09-10,4,270")[0];
        const answered = algorithm().cardCalcUpdatedSchedule(ReviewResponse.Good, card, empty());
        expect(text(answered)).toBe("!2023-09-17,11,270");
        expect(examples.get("w-card-not-yet-due-from-note-good")).toBe("!2023-09-22,16,270");
    });

    test("Reset", () => {
        expect(text(algorithm().cardGetResetSchedule())).toBe(examples.get("w-card-reset"));
    });

    test("load balancing off keeps one decimal, and a comment cannot write it back as a whole number", () => {
        const off = algorithm("loadBalanceOff");
        expect(text(off.cardGetNewSchedule(ReviewResponse.Easy, "n.md", empty()))).toBe(
            examples.get("w-lbOff-newEasy"),
        );
        expect(text(off.cardGetNewSchedule(ReviewResponse.Good, "n.md", empty()))).toBe(
            examples.get("w-lbOff-newGood"),
        );
        const card = Sm2State.fromDueDateStr("2023-09-06", 4, 270);
        const answered = off.cardCalcUpdatedSchedule(ReviewResponse.Good, card, empty());
        expect(text(answered)).toBe(examples.get("w-lbOff-good-4-270"));
        // D2 #6: the fraction survives being read back (it read as 10 before)
        expect(CommentParser.parseMultiScheduleComment(text(answered))[0].interval).toBe(10.8);
    });
});

describe("inventory 7.3: notes", () => {
    test.each(NAMES)("note A of the richer graph, first review, %s", (name) => {
        const { graph, scheduler } = notes("graph/g-inv73-rich");
        const schedule = scheduler.noteCalcNewSchedule("A.md", graph, RESPONSE[name], empty());
        expect(text(schedule)).toBe(examples.get(`w-noteNew-A-${name}`));
    });

    test("note D of the richer graph has no counted links and keeps the base ease", () => {
        const { graph, scheduler } = notes("graph/g-inv73-rich");
        const schedule = scheduler.noteCalcNewSchedule("D.md", graph, ReviewResponse.Good, empty());
        expect(text(schedule)).toBe(examples.get("w-noteNew-D-Good"));
    });

    test("note B of the pinned vault notes4 gets 252 from A's 270, then Easy adds 20", () => {
        const { graph, scheduler } = notes("graph/g-inv73-notes4");
        const schedule = scheduler.noteCalcNewSchedule("B.md", graph, ReviewResponse.Easy, empty());
        expect(text(schedule)).toBe(examples.get("w-noteNew-notes4-B-Easy"));
    });

    test("note A's link totals", () => {
        const { graph, scheduler } = notes("graph/g-inv73-rich");
        const stat = graph.calcNoteLinkStat("A.md", scheduler.noteStats());
        const [total, rankTotal, count] = examples.get("w-noteLinkStat-A").split("|");
        expect(stat.linkTotal.toFixed(3)).toBe(total);
        expect(stat.linkPGTotal.toFixed(3)).toBe(rankTotal);
        expect(String(stat.totalLinkCount)).toBe(count);
    });

    test.each(NAMES)("note A, four days overdue, %s", (name) => {
        const { scheduler } = notes("graph/g-inv73-rich");
        const old = Sm2State.fromDueDateStr("2023-09-02", 10, 250);
        const schedule = scheduler.noteCalcUpdatedSchedule("A.md", old, RESPONSE[name], empty());
        expect(text(schedule)).toBe(examples.get(`w-noteUpdate-A-${name}`));
    });
});

test("all 32 examples are accounted for", () => {
    expect(examples.size).toBe(32);
});
