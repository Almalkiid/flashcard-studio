import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import type { StudioSettings } from "src/data/settings-model";
import { NextNoteReviewHandler } from "src/note-review/next-note-review-handler";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { REVIEW_QUEUE_VIEW_TYPE, ReviewQueueListView } from "src/ui/note-review-pane";
import { SidebarManager } from "src/ui/sidebar-manager";
import { setupStaticRandomNumberProvider, staticRandomNumberProvider } from "src/utils/random";

import { WORDING } from "./helpers/pane-changes";
import { expectParity, loadGolden } from "./helpers/parity";
import { freezeAt, settingsWith } from "./helpers/scenario";

jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

interface MockLog {
    notices: string[];
    modals: {
        deckKeys: string[];
        opened: boolean;
        closed: boolean;
        close(): void;
        onChooseItem(deck: string): void;
    }[];
}

const mock = (require("obsidian") as { __log: MockLog }).__log;

const day = (s: string) => new Date(s + "T00:00:00").getTime();
const fileOf = (p: string) =>
    ({ path: p, basename: p, tfile: { path: p } }) as unknown as IVaultNoteFile;
const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

afterEach(() => jest.useRealTimers());

describe("NextNoteReviewHandler", () => {
    function makeDeck(name: string, news: string[], sched: [string, string][]) {
        const d = new NoteReviewDeck(name);
        news.forEach((p) => d.newNotes.push(fileOf(p)));
        sched.forEach(([p, due]) => d.scheduledNotes.push(new SchedNote(fileOf(p), day(due))));
        return d;
    }
    function setup(
        decks: [string, string[], [string, string][]][],
        over: Partial<StudioSettings> = {},
    ) {
        const queue = new NoteReviewQueue();
        decks.forEach(([n, a, b]) => queue.reviewDecks.set(n, makeDeck(n, a, b)));
        queue.reviewDecks.forEach((d) => d.sortNotesByDateAndImportance({}));
        const settings = settingsWith(over);
        const opened: string[] = [];
        const app = {
            workspace: {
                getLeaf: () => ({
                    openFile: (f: { path: string }) => {
                        opened.push(f.path);
                        return Promise.resolve();
                    },
                }),
            },
        };
        const handler = new NextNoteReviewHandler(app as never, settings, queue);
        mock.notices.length = 0;
        mock.modals.length = 0;
        return { handler, opened, queue };
    }
    const TWO: [string, string[], [string, string][]][] = [
        ["#review", ["n1"], [["due-a", "2023-09-05"]]],
        ["#review-2", ["m1"], [["far", "2023-09-30"]]],
    ];

    function mulberry(seed: number) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    test("next-note-handler.json (bugs 6 and 7: no decks says so; a vanished deck falls back)", async () => {
        freezeAt("2023-09-06T12:00:00");
        const g = loadGolden("next-note-handler") as { note: string; steps: { label: string }[] };
        const log: unknown[] = [];
        let n = 0;
        const rec = (t: ReturnType<typeof setup>, extra: object = {}) =>
            log.push({
                label: g.steps[n++].label,
                opened: [...t.opened],
                notices: [...mock.notices],
                modalsOpened: mock.modals.map((m) => ({ deckKeys: m.deckKeys, opened: m.opened })),
                lastSelectedReviewDeck: t.handler.lastSelectedReviewDeck,
                ...extra,
            });
        let t = setup(TWO.slice(0, 1));
        await t.handler.reviewNextNoteModal();
        rec(t);
        t = setup(TWO);
        await t.handler.reviewNextNoteModal();
        rec(t);
        // Obsidian closes a suggest modal itself before it hands over the chosen item
        mock.modals[0].close();
        mock.modals[0].onChooseItem("#review-2");
        await flush();
        rec(t, { modalClosed: mock.modals[0].closed });
        t = setup([]);
        await t.handler.reviewNextNoteModal();
        rec(t);
        t = setup(TWO);
        await t.handler.reviewNextNote("#nope");
        rec(t);
        t = setup([["#review", [], [["f", "2023-09-30"]]]]);
        await t.handler.reviewNextNote("#review");
        rec(t);
        t = setup(TWO, { autoNextNote: false });
        await t.handler.autoReviewNextNote();
        rec(t);
        t = setup(TWO, { autoNextNote: true });
        await t.handler.autoReviewNextNote();
        rec(t);
        t = setup([], { autoNextNote: true });
        await t.handler.autoReviewNextNote();
        rec(t);
        t = setup(TWO, { autoNextNote: true });
        await t.handler.openNote("#review-2", { path: "clicked.md" } as never);
        await t.handler.autoReviewNextNote();
        rec(t);
        t = setup(TWO, { autoNextNote: true });
        await t.handler.reviewNextNote("#review");
        t.queue.reviewDecks.delete("#review");
        await t.handler.autoReviewNextNote();
        rec(t);
        t = setup(TWO, { openRandomNote: true });
        const calls: number[][] = [];
        const rnd = mulberry(7);
        staticRandomNumberProvider.getInteger = (lo: number, hi: number) => {
            const v = Math.floor(rnd() * (hi - lo + 1)) + lo;
            calls.push([lo, hi, v]);
            return v;
        };
        setupStaticRandomNumberProvider();
        await t.handler.reviewNextNote("#review");
        rec(t, { providerCalls: calls });

        expectParity("next-note-handler", { note: g.note, steps: log }, [
            WORDING,
            {
                fix: "bug 6: Review a note with no decks says all caught up instead of opening an empty chooser",
                paths: /^steps\[3\]\.(notices|modalsOpened)/,
            },
            {
                fix: "bug 7: auto-next with a deck that vanished after a rescan falls back to the first deck",
                paths: /^steps\[10\]\.(opened|notices|lastSelectedReviewDeck)/,
            },
        ]);
    });

    test("the fall back lands on the first deck of the new queue", async () => {
        freezeAt("2023-09-06T12:00:00");
        const t = setup(TWO, { autoNextNote: true });
        await t.handler.reviewNextNote("#review");
        t.queue.reviewDecks.delete("#review");
        mock.notices.length = 0;
        await t.handler.autoReviewNextNote();
        expect(t.opened).toEqual(["due-a", "m1"]);
        expect(t.handler.lastSelectedReviewDeck).toBe("#review-2");
        expect(mock.notices).toEqual([]);
    });

    test("no decks: the chooser stays closed and the notice says so", async () => {
        const t = setup([]);
        await t.handler.reviewNextNoteModal();
        expect(mock.modals).toEqual([]);
        expect(mock.notices).toEqual(["Nothing left to review right now."]);
    });
});

describe("SidebarManager", () => {
    function world(
        opts: {
            existing?: "none" | "review" | "deferred";
            setting?: boolean;
            fresh?: "typed" | "empty";
        } = {},
    ) {
        const calls: string[] = [];
        const settings = settingsWith({ enableNoteReviewPaneOnStartup: opts.setting ?? true });
        const mkLeaf = (name: string, viewType: string, isReview = false) => {
            const view: { getViewType: () => string } = isReview
                ? Object.assign(Object.create(ReviewQueueListView.prototype) as object, {
                      redraw: () => calls.push(`${name}.view.redraw()`),
                      getViewType: () => viewType,
                  })
                : { getViewType: () => viewType };
            return {
                name,
                view,
                setViewState: (s: { type: string }) => {
                    calls.push(`${name}.setViewState(${JSON.stringify(s)})`);
                    view.getViewType = () => s.type;
                    return Promise.resolve();
                },
            };
        };
        const review = mkLeaf("reviewLeaf", REVIEW_QUEUE_VIEW_TYPE, true);
        const deferred = mkLeaf("deferredLeaf", REVIEW_QUEUE_VIEW_TYPE);
        const fresh = mkLeaf(
            "freshRightLeaf",
            opts.fresh === "empty" ? "empty" : REVIEW_QUEUE_VIEW_TYPE,
        );
        const leaves =
            opts.existing === "review" ? [review] : opts.existing === "deferred" ? [deferred] : [];
        const app = {
            workspace: {
                getLeavesOfType: (t: string) => {
                    calls.push(`getLeavesOfType(${t})`);
                    return leaves;
                },
                ensureSideLeaf: (t: string, side: string, o: object) => {
                    calls.push(`ensureSideLeaf(${t},${side},${JSON.stringify(o)})`);
                    return Promise.resolve(leaves[0] ?? fresh);
                },
                revealLeaf: (l: { name: string }) => {
                    calls.push(`revealLeaf(${l.name})`);
                    return Promise.resolve();
                },
            },
        };
        const plugin = {
            app,
            factory: undefined as undefined | ((leaf: unknown) => unknown),
            registerView: (type: string, f: (leaf: unknown) => unknown) => {
                calls.push(`registerView(${type})`);
                plugin.factory = f;
            },
            get nextNoteReviewHandler() {
                calls.push("plugin.nextNoteReviewHandler read");
                return { noteReviewQueue: { reviewDecks: new Map() } };
            },
        };
        const sm = new SidebarManager(plugin as never, { settings } as never);
        return { sm, calls, plugin };
    }

    const ENSURE =
        'ensureSideLeaf(flashcard-studio-note-queue,right,{"active":true,"reveal":false})';

    test("sidebar-manager-traces.json (the side leaf comes from ensureSideLeaf)", async () => {
        const g = loadGolden("sidebar-manager-traces") as {
            note: string;
            traces: { label: string }[];
        };
        const traces: unknown[] = [];
        let n = 0;
        const run = async (
            opts: Parameters<typeof world>[0],
            fn: (w: ReturnType<typeof world>) => Promise<void> | void,
        ) => {
            const w = world(opts);
            await fn(w);
            traces.push({ label: g.traces[n++].label, calls: w.calls });
        };
        await run({ existing: "review" }, (w) => w.sm.redraw());
        await run({ existing: "deferred" }, (w) => w.sm.redraw());
        await run({ existing: "none" }, (w) => w.sm.redraw());
        await run({}, (w) => {
            w.sm.init();
            w.plugin.factory?.({
                app: { workspace: { on: () => ({}) }, vault: { on: () => ({}) } },
            });
        });
        await run({ setting: true, existing: "none" }, (w) => w.sm.activateReviewQueueViewPanel());
        await run({ setting: true, existing: "review" }, (w) =>
            w.sm.activateReviewQueueViewPanel(),
        );
        await run({ setting: false, existing: "none" }, (w) => w.sm.activateReviewQueueViewPanel());
        // the "occupied right leaf" and "no leaf" what-ifs of getRightLeaf do not exist with ensureSideLeaf
        traces.push({ ...(g.traces[7] as object) }, { ...(g.traces[8] as object) });
        n = 9;
        await run({ existing: "none" }, (w) => w.sm.openReviewQueueView());
        await run({ existing: "review" }, (w) => w.sm.openReviewQueueView());
        await run({ existing: "deferred" }, (w) => w.sm.openReviewQueueView());
        traces.push({ ...(g.traces[12] as object) }, { ...(g.traces[13] as object) });
        expectParity("sidebar-manager-traces", { note: g.note, traces }, [
            {
                fix: "ensureSideLeaf gets or creates the leaf in one call instead of getLeavesOfType + getRightLeaf(false)",
                paths: /^traces\[(4|5|9|10|11)\]\.calls/,
            },
            {
                fix: "init is called before the panel is made, so the view type is registered first",
                paths: /^traces\[(4|5)\]\.calls/,
            },
        ]);
    });

    test("startup: registers the view type, then takes the sidebar leaf and does not reveal", async () => {
        const w = world({ existing: "none" });
        await w.sm.activateReviewQueueViewPanel();
        expect(w.calls).toEqual([`registerView(${REVIEW_QUEUE_VIEW_TYPE})`, ENSURE]);
        w.sm.init();
        expect(w.calls.filter((c) => c.startsWith("registerView"))).toHaveLength(1);
    });

    test("startup with the setting off does nothing", async () => {
        const w = world({ setting: false });
        await w.sm.activateReviewQueueViewPanel();
        expect(w.calls).toEqual([]);
    });

    test("the open command makes the leaf and reveals it", async () => {
        const w = world({ existing: "none" });
        await w.sm.openReviewQueueView();
        expect(w.calls).toEqual([ENSURE, "revealLeaf(freshRightLeaf)"]);
    });

    test("a leaf that is still empty is given the view", async () => {
        const w = world({ existing: "none", fresh: "empty" });
        await w.sm.openReviewQueueView();
        expect(w.calls).toEqual([
            ENSURE,
            `freshRightLeaf.setViewState({"type":"${REVIEW_QUEUE_VIEW_TYPE}","active":true})`,
            "revealLeaf(freshRightLeaf)",
        ]);
    });
});
