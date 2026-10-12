import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import type { StudioSettings } from "src/data/settings-model";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { REVIEW_QUEUE_VIEW_TYPE, ReviewQueueListView } from "src/ui/note-review-pane";
import { DateUtil, globalDateProvider } from "src/utils/clock";

import { freezeAt, settingsWith } from "./scenario";

// The scenarios that produced the pane-*.json golden files, run on the rewritten pane. They need the obsidian mock
// of helpers/obsidian-dom-mock.cjs, which each test file installs.

export interface MockLog {
    notices: string[];
    menus: {
        items: {
            title: string;
            icon: string;
            warning: boolean;
            click: () => void;
            separator?: boolean;
        }[];
        shown: number;
    }[];
    modals: unknown[];
}

const mock = (require("obsidian") as { __log: MockLog }).__log;

const day = (s: string) => new Date(s + "T00:00:00").getTime(); // local midnight

export function fileOf(p: string): IVaultNoteFile {
    const base = p.replace(/^.*\//, "").replace(/\.md$/, "");
    return {
        path: p,
        basename: base,
        tfile: { path: p, basename: base },
    } as unknown as IVaultNoteFile;
}

export interface DeckSpec {
    name: string;
    newNotes: string[];
    sched: [string, string][];
}

export function buildQueue(spec: DeckSpec[]): NoteReviewQueue {
    const q = new NoteReviewQueue();
    q.init();
    for (const d of spec) {
        const deck = new NoteReviewDeck(d.name);
        d.newNotes.forEach((p) => deck.newNotes.push(fileOf(p)));
        d.sched.forEach(([p, due]) => deck.scheduledNotes.push(new SchedNote(fileOf(p), day(due))));
        deck.sortNotesByDateAndImportance({});
        q.reviewDecks.set(d.name, deck);
    }
    return q;
}

export interface Opts {
    settings?: Partial<StudioSettings>;
    active?: string | null;
}

export function makeView(queue: NoteReviewQueue, opts: Opts = {}) {
    const settings = settingsWith(opts.settings ?? {});
    const opened: unknown[] = [];
    const saved: unknown[] = [];
    const events: string[] = [];
    const handlers = new Map<string, (arg?: unknown) => void>();
    let active = opts.active ?? null;
    const app = {
        workspace: {
            on: (n: string, cb: () => void) => {
                events.push("workspace:" + n);
                handlers.set("workspace:" + n, cb);
                return { n };
            },
            getActiveFile: () => (active === null ? null : { path: active }),
            detachLeavesOfType: jest.fn(),
        },
        vault: {
            on: (n: string, cb: () => void) => {
                events.push("vault:" + n);
                handlers.set("vault:" + n, cb);
                return { n };
            },
        },
    };
    const handler = {
        noteReviewQueue: queue,
        openNote: (deckName: string, file: { path: string }) => {
            opened.push([deckName, file.path]);
            return Promise.resolve();
        },
    };
    const plugin = {
        app,
        dataManager: {
            data: { settings },
            saveNoteReviewResponse: (file: { path: string }, r: ReviewResponse) => {
                saved.push([file.path, ReviewResponse[r]]);
                return Promise.resolve();
            },
            sync: jest.fn(() => Promise.resolve()),
        },
    };
    const view = new ReviewQueueListView(
        { app } as never,
        handler as never,
        settings,
        plugin as never,
    );
    return {
        view,
        settings,
        opened,
        saved,
        events,
        handlers,
        queue,
        plugin,
        setActive: (p: string | null) => {
            active = p;
        },
    };
}

type View = ReturnType<typeof makeView>;

const directKids = (el: Element, sel: string): HTMLElement[] =>
    [...el.children].filter((c) => c.matches(sel)) as HTMLElement[];

function dumpFolder(folderEl: HTMLElement): unknown {
    const titleEl = directKids(folderEl, ".nav-folder-title")[0];
    const childrenEl = directKids(folderEl, ".nav-folder-children")[0];
    const icon = titleEl.querySelector(".collapse-icon");
    return {
        title: titleEl.querySelector(".nav-folder-title-content").textContent,
        classCollapsed: folderEl.classList.contains("is-collapsed"),
        iconCollapsed: icon.classList.contains("is-collapsed"),
        folderInlineDisplay: folderEl.style.display || null,
        childrenInlineDisplay: childrenEl.style.display || null,
        folders: directKids(childrenEl, ".nav-folder").map(dumpFolder),
        files: directKids(childrenEl, ".nav-file").map((f) => {
            const t = directKids(f, ".nav-file-title")[0];
            return {
                name: t.querySelector(".nav-file-title-content").textContent,
                active: t.classList.contains("is-active"),
                hasContextButton: t.querySelector(".fs-review-context-btn") !== null,
            };
        }),
    };
}

export function dumpView(t: Pick<View, "view" | "queue">) {
    const el = t.view.contentEl;
    const tree = el.querySelector(".mod-root");
    const rootChildren = directKids(tree, ".nav-folder-children")[0];
    return {
        contentClasses: el.className,
        title: el.querySelector(".fs-note-review-header-title").textContent,
        subtitle: el.querySelector(".fs-note-review-header-subtitle").textContent,
        decks: rootChildren ? directKids(rootChildren, ".nav-folder").map(dumpFolder) : [],
        activeFoldersByDeck: Object.fromEntries(
            [...t.queue.reviewDecks.values()].map((d) => [d.deckName, [...d.activeFolders]]),
        ),
    };
}

export const SPEC_TWO_DECKS: DeckSpec[] = [
    {
        name: "#review",
        newNotes: ["n/new-1.md", "n/new-2.md"],
        sched: [
            ["s/overdue-3d.md", "2023-09-03"],
            ["s/overdue-1d.md", "2023-09-05"],
            ["s/today-a.md", "2023-09-06"],
            ["s/today-b.md", "2023-09-06"],
            ["s/tomorrow.md", "2023-09-07"],
            ["s/in-2d.md", "2023-09-08"],
            ["s/in-30d.md", "2023-10-06"],
            ["s/in-365d.md", "2024-09-05"],
            ["s/in-366d.md", "2024-09-06"],
            ["s/in-800d.md", "2025-11-14"],
        ],
    },
    { name: "#review-2", newNotes: [], sched: [["s/two-today.md", "2023-09-06"]] },
];

const one = (name: string, newNotes: string[], sched: [string, string][]): DeckSpec[] => [
    { name, newNotes, sched },
];

const click = (el: Element) =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const titleOf = (view: ReviewQueueListView, title: string) =>
    [...view.contentEl.querySelectorAll(".nav-folder-title")].find(
        (e) => e.textContent === title,
    ) as HTMLElement;

const zoneSuffix = (tz: string) =>
    tz === "UTC" ? "" : "-" + tz.replace(/\W+/g, "-").toLowerCase();
export const goldenName = (base: string, tz: string) => base + zoneSuffix(tz);

export function paneGroups(tz: string) {
    const out: unknown[] = [];
    const run = (id: string, clock: string, spec: DeckSpec[], opts: Opts, note = "") => {
        freezeAt(clock);
        const queue = buildQueue(spec);
        const t = makeView(queue, opts);
        void t.view.onOpen();
        out.push({
            id,
            note,
            clock,
            tz,
            settingsOverrides: opts.settings ?? {},
            activeFile: opts.active ?? null,
            subscribedEvents: t.events,
            ...dumpView(t),
        });
        jest.useRealTimers();
    };
    run("empty-queue", "2023-09-06T12:00:00", [], {});
    run(
        "two-decks-default",
        "2023-09-06T12:00:00",
        SPEC_TWO_DECKS,
        {},
        "default maxNDays 365, format MMM DD YYYY",
    );
    run(
        "two-decks-evening",
        "2023-09-06T23:30:00",
        SPEC_TWO_DECKS,
        {},
        "same data 23:30 the same day: group labels must not change",
    );
    run(
        "two-decks-just-after-midnight",
        "2023-09-07T00:10:00",
        SPEC_TWO_DECKS,
        {},
        "00:10 the next day: everything shifts one label",
    );
    run(
        "max-days-7",
        "2023-09-06T12:00:00",
        SPEC_TWO_DECKS,
        { settings: { maxNDaysNotesReviewQueue: 7 } },
        "notes more than 7 days ahead are cut",
    );
    run(
        "max-days-2",
        "2023-09-06T12:00:00",
        SPEC_TWO_DECKS,
        { settings: { maxNDaysNotesReviewQueue: 2 } },
        "boundary: the group exactly 2 days ahead stays",
    );
    run(
        "max-days-0",
        "2023-09-06T12:00:00",
        SPEC_TWO_DECKS,
        { settings: { maxNDaysNotesReviewQueue: 0 } },
        "0 days: overdue and today only",
    );
    run("date-format-iso", "2023-09-06T12:00:00", SPEC_TWO_DECKS, {
        settings: { preferredDateFormatForNoteReviewQueue: "YYYY-MM-DD (ddd)" },
    });
    run(
        "active-file-in-far-group",
        "2023-09-06T12:00:00",
        SPEC_TWO_DECKS,
        { active: "s/in-30d.md" },
        "the group of the open note opens, its deck opens",
    );
    run("active-file-in-new", "2023-09-06T12:00:00", SPEC_TWO_DECKS, { active: "n/new-2.md" });
    run(
        "active-file-in-second-deck",
        "2023-09-06T12:00:00",
        [
            { name: "#review", newNotes: [], sched: [["s/a.md", "2023-09-06"]] },
            { name: "#review-2", newNotes: ["n/x.md"], sched: [["s/b.md", "2023-09-09"]] },
        ],
        { active: "s/b.md" },
    );
    run(
        "note-in-two-decks-active",
        "2023-09-06T12:00:00",
        [
            { name: "#a", newNotes: [], sched: [["s/shared.md", "2023-09-08"]] },
            { name: "#b", newNotes: [], sched: [["s/shared.md", "2023-09-08"]] },
        ],
        { active: "s/shared.md" },
        "an open note in two decks opens both decks",
    );
    run("new-only", "2023-09-06T12:00:00", one("#review", ["n/only.md"], []), {});
    run(
        "scheduled-only-far",
        "2023-09-06T12:00:00",
        one("#review", [], [["s/far.md", "2030-01-01"]]),
        {},
        "all notes beyond maxNDays: deck folder stays, no group",
    );
    run(
        "two-groups-same-label",
        "2023-09-06T12:00:00",
        one(
            "#review",
            [],
            [
                ["s/a.md", "2023-09-09"],
                ["s/b.md", "2023-09-09"],
                ["s/c.md", "2023-09-10"],
            ],
        ),
        { settings: { preferredDateFormatForNoteReviewQueue: "MMM" } },
        "format that hides the day: two groups with the same title, one folder state",
    );
    return {
        note: "DOM dump of ReviewQueueListView.redraw() run on the real code with an Obsidian DOM-helper mock. Dates are local midnight in tz.",
        cases: out,
    };
}

export function paneBoundary(tz: string) {
    void tz;
    const spec = one(
        "#review",
        [],
        [
            ["s/d-0.md", "2023-09-06"],
            ["s/d-1.md", "2023-09-07"],
            ["s/d-2.md", "2023-09-08"],
        ],
    );
    freezeAt("2023-09-07T02:00:00");
    const q = buildQueue(spec);
    const boundary = DateUtil.strToDayBoundary("04:00:00");
    globalDateProvider.setDayBoundary(boundary);
    try {
        q.calcDueNotesCount(globalDateProvider.today.valueOf());
        const t = makeView(q, { settings: { startOfDay: "04:00:00" } });
        void t.view.onOpen();
        const dump = dumpView(t);
        jest.useRealTimers();
        return {
            cases: [
                {
                    id: "boundary-0400-at-0200",
                    note: "study day 2023-09-06 (due count uses it); pane labels use the calendar clock",
                    dueCountComputedWithTodayEquals: "2023-09-06",
                    queueDueNotesCount: q.dueNotesCount,
                    ...dump,
                },
            ],
        };
    } finally {
        globalDateProvider.setDayBoundary(null);
    }
}

export function paneDst(tz: string) {
    const out: unknown[] = [];
    const spec = (base: string) => {
        const add = (n: number) => {
            const d = new Date(base + "T00:00:00");
            d.setDate(d.getDate() + n);
            const p = (x: number) => String(x).padStart(2, "0");
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        return one(
            "#review",
            [],
            [
                ["s/m1.md", add(-1)],
                ["s/d0.md", add(0)],
                ["s/d1.md", add(1)],
                ["s/d2.md", add(2)],
            ],
        );
    };
    const runs: [string, string, string[]][] = [
        [
            "fall-back-eve-2026-11-01",
            "2026-11-01",
            ["00:00:00", "00:30:00", "00:59:00", "01:00:00", "12:00:00", "23:59:00"],
        ],
        [
            "spring-forward-2026-03-08",
            "2026-03-08",
            ["00:00:00", "00:30:00", "03:30:00", "12:00:00"],
        ],
        ["plain-day-2026-06-15", "2026-06-15", ["00:00:00", "00:30:00", "12:00:00"]],
    ];
    for (const [id, base, times] of runs) {
        for (const time of times) {
            freezeAt(`${base}T${time}`);
            const t = makeView(buildQueue(spec(base)), {});
            void t.view.onOpen();
            const dump = dumpView(t) as {
                decks: { folders: { title: string; files: { name: string }[] }[] }[];
            };
            out.push({
                id,
                time,
                tz,
                labels: dump.decks[0].folders.map((f) => [
                    f.files.map((x) => x.name).join(","),
                    f.title,
                ]),
            });
            jest.useRealTimers();
        }
    }
    return {
        note: "label given to the notes due the day before, on, one and two days after the base date, at several clock times",
        cases: out,
    };
}

export function paneInteractions() {
    freezeAt("2023-09-06T12:00:00");
    const queue = buildQueue(SPEC_TWO_DECKS);
    const t = makeView(queue, { settings: { showDeleteButtonInFileMenu: true } });
    void t.view.onOpen();
    const log: unknown[] = [];
    const rec = (label: string) => log.push({ label, ...dumpView(t) });
    rec("initial");
    click(titleOf(t.view, "New"));
    rec("after clicking New (was collapsed)");
    click(titleOf(t.view, "New"));
    rec("after clicking New again");
    click(titleOf(t.view, "Today"));
    rec("after clicking Today (was expanded)");
    click(titleOf(t.view, "#review"));
    rec("after clicking the #review deck folder");
    t.view.redraw();
    rec("after a redraw: collapse state comes from deck.activeFolders");
    const nameEl = [...t.view.contentEl.querySelectorAll(".nav-file-title-content")].find(
        (e) => e.textContent === "tomorrow",
    ) as HTMLElement;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    nameEl.dispatchEvent(ev);
    log.push({
        label: "clicked file 'tomorrow'",
        defaultPrevented: ev.defaultPrevented,
        handlerOpenNoteCalls: t.opened,
    });
    const btn = nameEl.parentElement?.querySelector(".fs-review-context-btn");
    click(btn);
    const menu = mock.menus[mock.menus.length - 1];
    log.push({
        label: "context button menu (showDeleteButtonInFileMenu true)",
        items: menu.items.map((i) =>
            i.separator ? "---" : { title: i.title, icon: i.icon, warning: i.warning },
        ),
    });
    menu.items.filter((i) => !i.separator).forEach((i) => i.click());
    log.push({
        label: "menu item clicks routed to plugin.dataManager.saveNoteReviewResponse / confirmation modal",
        saveCalls: t.saved,
        modalsOpened: mock.modals.length,
    });
    const t2 = makeView(queue, { settings: { showDeleteButtonInFileMenu: false } });
    void t2.view.onOpen();
    const nameEl2 = t2.view.contentEl.querySelector(".nav-file-title-content");
    click(nameEl2.parentElement?.querySelector(".fs-review-context-btn"));
    const menu2 = mock.menus[mock.menus.length - 1];
    log.push({
        label: "context button menu (showDeleteButtonInFileMenu false)",
        items: menu2.items.map((i) => (i.separator ? "---" : i.title)),
    });
    const on = makeView(queue, { settings: { enableNoteReviewPaneOnStartup: true } });
    const off = makeView(queue, { settings: { enableNoteReviewPaneOnStartup: false } });
    log.push({
        label: "events subscribed at construction",
        whenSettingOn: on.events,
        whenSettingOff: off.events,
    });
    log.push({
        label: "view identity",
        viewType: t.view.getViewType(),
        constant: REVIEW_QUEUE_VIEW_TYPE,
        displayText: t.view.getDisplayText(),
        icon: t.view.getIcon(),
    });
    jest.useRealTimers();
    return {
        note: "icons/classes as produced by the real code against the DOM-helper mock",
        steps: log,
    };
}

export function paneActiveFileExpansion() {
    freezeAt("2023-09-06T12:00:00");
    const spec = one(
        "#review",
        ["n/a.md", "n/b.md", "n/c.md"],
        [
            ["s/x.md", "2023-09-08"],
            ["s/y.md", "2023-09-08"],
            ["s/z.md", "2023-09-08"],
        ],
    );
    const out: unknown[] = [];
    for (const [id, active] of [
        ["active-is-first-in-collapsed-group", "n/a.md"],
        ["active-is-third-in-collapsed-group", "n/c.md"],
        ["active-is-second-in-collapsed-dated-group", "s/y.md"],
    ]) {
        const queue = buildQueue(spec);
        const t = makeView(queue, { active });
        void t.view.onOpen();
        const first = dumpView(t);
        t.view.redraw();
        const second = dumpView(t);
        out.push({
            id,
            activeFile: active,
            firstRedraw: first.decks,
            secondRedraw: second.decks,
            activeFoldersAfterFirst: first.activeFoldersByDeck,
        });
    }
    const queue = buildQueue(spec);
    queue.reviewDecks.get("#review")?.activeFolders.delete("#review");
    const t = makeView(queue, { active: "s/x.md" });
    void t.view.onOpen();
    const a = dumpView(t);
    t.view.redraw();
    const b = dumpView(t);
    out.push({
        id: "deck-folder-collapsed-active-file-inside",
        activeFile: "s/x.md",
        firstRedraw: a.decks,
        secondRedraw: b.decks,
    });
    jest.useRealTimers();
    return { note: "first redraw vs the next one", cases: out };
}

export function paneUserFlow() {
    freezeAt("2023-09-06T12:00:00");
    const queue = buildQueue(one("#review", ["n/a.md", "n/b.md", "n/c.md"], []));
    const t = makeView(queue, {});
    void t.view.onOpen();
    const steps: unknown[] = [];
    const snap = (label: string) => steps.push({ label, ...dumpView(t) });
    snap("initial: New is collapsed");
    click(titleOf(t.view, "New"));
    snap("user clicked New: expanded");
    t.setActive("n/c.md");
    t.view.redraw();
    snap("file-open redraw with c active");
    t.view.redraw();
    snap("any later redraw");
    jest.useRealTimers();
    return { steps };
}

export { click, titleOf };
