import { appendFileSync } from "fs";

import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { NoteDueDateHistogram } from "src/scheduling/due-histogram";
import { Sm2State } from "src/scheduling/schedule/sm2-state";

import { fileOf, makeView } from "./helpers/pane-scenarios";
import { loadGolden } from "./helpers/parity";
import { freezeAt } from "./helpers/scenario";

jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

// timings.json holds how long the queue and the pane took before the rewrite (jsdom, one machine). The numbers vary
// by machine, so this checks the same operations with room to spare, and the size of what the pane builds, which does
// not vary. Set PERF_REPORT to a file to collect the measured numbers.

const ms = (f: () => void) => {
    const t = performance.now();
    f();
    return Math.round((performance.now() - t) * 100) / 100;
};

interface Row {
    notes: number;
    msPerOperation: Record<string, number>;
}

afterEach(() => jest.useRealTimers());

test.each([1000, 5000])("timings.json: a queue of %i notes", (n) => {
    freezeAt("2023-09-06T12:00:00");
    const golden = (loadGolden("timings") as { rows: Row[] }).rows.find((r) => r.notes === n);
    const queue = new NoteReviewQueue();
    const ranks: Record<string, number> = {};
    const t: Record<string, number> = {};
    t.addNoteToQueue = ms(() => {
        for (let i = 0; i < n; i++) {
            const p = `folder${i % 50}/note-${i}.md`;
            ranks[p] = (i * 7919) % 1000;
            const sched = i % 3 === 0 ? null : Sm2State.fromDueDateStr("2023-09-06", 1, 250);
            if (sched !== null)
                sched.dueDate = sched.dueDate.clone().add(((i * 7) % 400) - 20, "d");
            queue.addNoteToQueue(fileOf(p), sched, ["#review"]);
        }
    });
    const deck = queue.reviewDecks.get("#review");
    if (!deck) throw new Error("no deck");
    t.calcDueNotesCount = ms(() =>
        queue.calcDueNotesCount(new Date("2023-09-06T00:00:00").getTime()),
    );
    t.sortNotesByDateAndImportance = ms(() => deck.sortNotesByDateAndImportance(ranks));
    t.histogramPlusSort = ms(() =>
        new NoteDueDateHistogram().calculateFromReviewDecksAndSort(queue.reviewDecks, {
            pageranks: ranks,
        } as never),
    );
    const target = deck.scheduledNotes[Math.floor(deck.scheduledNotes.length / 2)].note;
    t.updateScheduleInfoOneRating = ms(() =>
        queue.updateScheduleInfo(target, Sm2State.fromDueDateStr("2023-12-01", 30, 250)),
    );
    const view = makeView(queue, {});
    t.paneRedraw = ms(() => view.view.redraw());
    const rows = view.view.contentEl.querySelectorAll(".nav-file").length;
    const elements = view.view.contentEl.querySelectorAll("*").length;

    if (process.env.PERF_REPORT)
        appendFileSync(
            process.env.PERF_REPORT,
            JSON.stringify({ notes: n, before: golden.msPerOperation, after: t, rows, elements }) +
                "\n",
        );
    // the pane draws every note that is new or due within the cap, as before
    expect(deck.newNotes.length + deck.scheduledNotes.length).toBe(n);
    expect(rows).toBeGreaterThan(n * 0.9);
    expect(t.addNoteToQueue).toBeLessThan(2000);
    expect(t.paneRedraw).toBeLessThan(10000);
    expect(t.histogramPlusSort).toBeLessThan(2000);
});
