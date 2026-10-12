import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { DueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { IScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { NoteLinkGraph } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

import { loadGolden } from "../golden/load-golden";
import { ids, mismatches, Slot, view } from "../schedule/golden-views";
import { Frontmatter, noteWith, Pairs } from "../schedule/note-with";
import { RESPONSE, ResponseName } from "./grid";
import { ScriptedLinks } from "./scripted-links";

// moment warns on stderr when it falls back to Date for text that is not ISO
(moment as unknown as { suppressDeprecationWarnings: boolean }).suppressDeprecationWarnings = true;

interface FlowRow {
    id: string;
    input: {
        algorithmSetting: SchedulerKind;
        frontmatterBefore: Frontmatter | "@undefined";
        response: ResponseName;
    };
    readSchedule: Slot | null;
    newSchedule: Slot;
    frontmatterAfter: Pairs;
    scheduleClass: string;
}
const rows = loadGolden<{ reviewFlows: FlowRow[] }>("frontmatter").reviewFlows;

beforeEach(() => {
    setupStaticDateProvider("2023-09-06");
});

describe("reviewing a note: read its frontmatter, work out the next schedule, write it back", () => {
    test("the 48 golden flows, under the SM-2 and the FSRS setting alike (notes are always SM-2)", async () => {
        const actual = new Map<
            string,
            { read: Slot | null; next: Slot | null; after: Pairs; cls: string }
        >();
        for (const row of rows) {
            const settings = { ...DEFAULT_SETTINGS, algorithm: row.input.algorithmSetting };
            const algorithm: IScheduler =
                row.input.algorithmSetting === SchedulerKind.FSRS
                    ? new FsrsCardScheduler(settings)
                    : new Sm2Scheduler(settings);
            const before = row.input.frontmatterBefore;
            const { note, current } = noteWith(before === "@undefined" ? undefined : before);
            const graph = new NoteLinkGraph(new ScriptedLinks({ "note.md": {} }));
            graph.processLinks("note.md");
            graph.generatePageRanks();

            // What VaultIndex.saveNoteReviewResponse does
            const read = await note.getNoteSchedule();
            const response = RESPONSE[row.input.response];
            const next =
                read === null
                    ? algorithm.noteCalcNewSchedule(
                          "note.md",
                          graph,
                          response,
                          new DueDateHistogram(),
                      )
                    : algorithm.noteCalcUpdatedSchedule(
                          "note.md",
                          read,
                          response,
                          new DueDateHistogram(),
                      );
            await note.setNoteSchedule(next);
            actual.set(row.id, {
                read: view(read),
                next: view(next),
                after: current(),
                cls: next.constructor.name,
            });
        }
        const bad = mismatches(rows, (row) => ({
            expected: {
                read: row.readSchedule,
                next: row.newSchedule,
                after: row.frontmatterAfter,
                cls: row.scheduleClass,
            },
            actual: actual.get(row.id),
        }));
        expect(rows).toHaveLength(48);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});
