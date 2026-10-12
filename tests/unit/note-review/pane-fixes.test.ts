import { Menu } from "obsidian";

import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { REVIEW_QUEUE_VIEW_TYPE } from "src/ui/note-review-pane";
import { DateUtil, globalDateProvider } from "src/utils/clock";

import {
    buildQueue,
    click,
    DeckSpec,
    dumpView,
    fileOf,
    makeView,
    MockLog,
    SPEC_TWO_DECKS,
    titleOf,
} from "./helpers/pane-scenarios";
import { freezeAt } from "./helpers/scenario";

jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

// The fixes to the pane (inventory section 12), each shown on its own. The golden files show them as differences
// from the old values (pane-changes.ts); these state what is now true.

const mock = (require("obsidian") as { __log: MockLog }).__log;

const NEW_NOTES: DeckSpec[] = [
    { name: "#review", newNotes: ["n/a.md", "n/b.md", "n/c.md"], sched: [] },
];

type Folder = {
    title: string;
    classCollapsed: boolean;
    childrenInlineDisplay: string | null;
    folders: Folder[];
    files: { name: string; active: boolean }[];
};
const decksOf = (t: Parameters<typeof dumpView>[0]) => dumpView(t).decks as unknown as Folder[];
const newGroup = (t: Parameters<typeof dumpView>[0]) =>
    decksOf(t)[0].folders.find((f) => f.title === "New");

beforeEach(() => freezeAt("2023-09-06T12:00:00"));
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("bug 1: the fold state", () => {
    test("a folder that was opened stays open after a redraw", () => {
        const t = makeView(buildQueue(NEW_NOTES));
        void t.view.onOpen();
        expect(newGroup(t).classCollapsed).toBe(true);
        click(titleOf(t.view, "New"));
        expect(newGroup(t).classCollapsed).toBe(false);
        t.view.redraw();
        expect(newGroup(t).classCollapsed).toBe(false);
        expect([...(t.queue.reviewDecks.get("#review")?.activeFolders ?? [])]).toContain("New");
    });

    test("a folder that was closed stays closed after a redraw (Today, then the deck)", () => {
        const t = makeView(buildQueue(SPEC_TWO_DECKS));
        void t.view.onOpen();
        const today = () => decksOf(t)[0].folders.find((f) => f.title === "Today");
        expect(today().classCollapsed).toBe(false);
        click(titleOf(t.view, "Today"));
        t.view.redraw();
        expect(today().classCollapsed).toBe(true);
        click(titleOf(t.view, "#review"));
        t.view.redraw();
        expect(decksOf(t)[0].classCollapsed).toBe(true);
        click(titleOf(t.view, "#review"));
        t.view.redraw();
        expect(decksOf(t)[0].classCollapsed).toBe(false);
    });

    test("the fold state survives a rescan, which builds new decks", () => {
        const queue = buildQueue(NEW_NOTES);
        const t = makeView(queue);
        void t.view.onOpen();
        click(titleOf(t.view, "New"));
        queue.init();
        queue.addNoteToQueue(fileOf("n/a.md"), null, ["#review"]);
        t.view.redraw();
        expect(newGroup(t).classCollapsed).toBe(false);
    });
});

describe("bug 2: the list of an opened folder shows", () => {
    test.each(["n/a.md", "n/b.md", "n/c.md"])(
        "opening %s, expanded or not, leaves its list visible",
        (active) => {
            const t = makeView(buildQueue(NEW_NOTES));
            void t.view.onOpen();
            click(titleOf(t.view, "New"));
            t.setActive(active);
            t.view.redraw();
            const group = newGroup(t);
            expect(group.classCollapsed).toBe(false);
            expect(group.childrenInlineDisplay).toBeNull();
            expect(group.files.filter((f) => f.active).map((f) => f.name)).toEqual([
                active.slice(2, 3),
            ]);
        },
    );

    test("a collapsed deck folder opens for the open note, list included", () => {
        const queue = buildQueue(NEW_NOTES);
        queue.reviewDecks.get("#review")?.activeFolders.delete("#review");
        const t = makeView(queue, { active: "n/b.md" });
        void t.view.onOpen();
        expect(decksOf(t)[0].classCollapsed).toBe(false);
        expect(decksOf(t)[0].childrenInlineDisplay).toBeNull();
        t.view.redraw();
        expect(decksOf(t)[0].childrenInlineDisplay).toBeNull();
    });

    test("a note in two decks opens both", () => {
        const queue = buildQueue([
            { name: "#a", newNotes: [], sched: [["s/x.md", "2023-09-08"]] },
            { name: "#b", newNotes: [], sched: [["s/x.md", "2023-09-08"]] },
        ]);
        const t = makeView(queue, { active: "s/x.md" });
        void t.view.onOpen();
        expect(decksOf(t).map((d) => d.folders.map((f) => f.classCollapsed))).toEqual([
            [false],
            [false],
        ]);
    });
});

describe("bug 5: the labels follow the study day", () => {
    const spec: DeckSpec[] = [
        {
            name: "#review",
            newNotes: [],
            sched: [
                ["s/d-0.md", "2023-09-06"],
                ["s/d-1.md", "2023-09-07"],
                ["s/d-2.md", "2023-09-08"],
            ],
        },
    ];

    afterEach(() => globalDateProvider.setDayBoundary(null));

    test("at 02:00 with a 04:00 start the 6th is still today", () => {
        freezeAt("2023-09-07T02:00:00");
        globalDateProvider.setDayBoundary(DateUtil.strToDayBoundary("04:00:00"));
        const t = makeView(buildQueue(spec));
        void t.view.onOpen();
        expect(decksOf(t)[0].folders.map((f) => [f.title, f.files[0].name])).toEqual([
            ["Today", "d-0"],
            ["Tomorrow", "d-1"],
            ["Sep 08 2023", "d-2"],
        ]);
    });

    test("at 05:00 the same notes are a day older", () => {
        freezeAt("2023-09-07T05:00:00");
        globalDateProvider.setDayBoundary(DateUtil.strToDayBoundary("04:00:00"));
        const t = makeView(buildQueue(spec));
        void t.view.onOpen();
        expect(decksOf(t)[0].folders.map((f) => f.title)).toEqual([
            "Yesterday",
            "Today",
            "Tomorrow",
        ]);
    });

    test("the cap counts days from the study day too", () => {
        freezeAt("2023-09-07T02:00:00");
        globalDateProvider.setDayBoundary(DateUtil.strToDayBoundary("04:00:00"));
        const t = makeView(buildQueue(spec), { settings: { maxNDaysNotesReviewQueue: 1 } });
        void t.view.onOpen();
        expect(decksOf(t)[0].folders.map((f) => f.title)).toEqual(["Today", "Tomorrow"]);
    });
});

describe("bug 11: groups with the same title are separate", () => {
    test("opening one does not open the other", () => {
        const spec: DeckSpec[] = [
            {
                name: "#review",
                newNotes: [],
                sched: [
                    ["s/a.md", "2023-09-09"],
                    ["s/b.md", "2023-09-10"],
                ],
            },
        ];
        const t = makeView(buildQueue(spec), {
            settings: { preferredDateFormatForNoteReviewQueue: "MMM" },
        });
        void t.view.onOpen();
        const titles = () => decksOf(t)[0].folders.map((f) => [f.title, f.classCollapsed]);
        expect(titles()).toEqual([
            ["Sep", true],
            ["Sep", true],
        ]);
        click(
            [...t.view.contentEl.querySelectorAll(".nav-folder-title")].filter(
                (e) => e.textContent === "Sep",
            )[0],
        );
        t.view.redraw();
        expect(titles()).toEqual([
            ["Sep", false],
            ["Sep", true],
        ]);
    });
});

describe("bug 4: the pane keeps up", () => {
    test("it listens for file-open, rename and delete, whatever the startup setting was", () => {
        const off = makeView(buildQueue(NEW_NOTES), {
            settings: { enableNoteReviewPaneOnStartup: false },
        });
        expect(off.events).toEqual(["workspace:file-open", "vault:rename", "vault:delete"]);
    });

    test("file-open and rename redraw", () => {
        const t = makeView(buildQueue(NEW_NOTES));
        void t.view.onOpen();
        const spy = jest.spyOn(t.view, "redraw");
        t.handlers.get("workspace:file-open")?.();
        t.handlers.get("vault:rename")?.();
        expect(spy).toHaveBeenCalledTimes(2);
    });

    test("a deleted note leaves the pane", () => {
        const t = makeView(buildQueue(NEW_NOTES));
        void t.view.onOpen();
        t.handlers.get("vault:delete")?.({ path: "n/b.md" });
        expect(newGroup(t).files.map((f) => f.name)).toEqual(["a", "c"]);
        expect(t.queue.reviewDecks.get("#review")?.newNotes.map((n) => n.path)).toEqual([
            "n/a.md",
            "n/c.md",
        ]);
    });
});

describe("the menu of a note", () => {
    const lastMenu = () => mock.menus[mock.menus.length - 1];

    function openMenu(over: Parameters<typeof makeView>[1] = {}) {
        const t = makeView(buildQueue(NEW_NOTES), over);
        void t.view.onOpen();
        click(titleOf(t.view, "New"));
        click(t.view.contentEl.querySelector(".fs-review-context-btn"));
        return t;
    }

    test("rates with the three words of the settings, and is shown once", () => {
        const t = openMenu({ settings: { flashcardEasyText: "Simple" } });
        expect(lastMenu().items.map((i) => i.title)).toEqual([
            "Rate note: Simple",
            "Rate note: Good",
            "Rate note: Hard",
        ]);
        expect(lastMenu().shown).toBe(1);
        lastMenu().items.forEach((i) => i.click());
        expect(t.saved).toEqual([
            ["n/a.md", "Easy"],
            ["n/a.md", "Good"],
            ["n/a.md", "Hard"],
        ]);
    });

    test("the delete item comes after a separator and opens the confirmation", async () => {
        const t = openMenu({ settings: { showDeleteButtonInFileMenu: true } });
        expect(lastMenu().items.map((i) => i.separator ?? i.title)).toEqual([
            "Rate note: Easy",
            "Rate note: Good",
            "Rate note: Hard",
            true,
            "Erase the note's own schedule",
        ]);
        const before = mock.modals.length;
        lastMenu().items[4].click();
        expect(mock.modals).toHaveLength(before + 1);
        expect(t.plugin.dataManager.sync).not.toHaveBeenCalled();
    });
});

describe("the view", () => {
    test("identity and the Close item of the header menu", () => {
        const t = makeView(buildQueue(NEW_NOTES));
        expect(t.view.getViewType()).toBe(REVIEW_QUEUE_VIEW_TYPE);
        expect(t.view.getIcon()).toBe("studio-card-spark");
        const menu = new Menu();
        t.view.onHeaderMenu(menu);
        const items = (menu as unknown as { items: { title: string; icon: string }[] }).items;
        expect(items.map((i) => [i.title, i.icon])).toEqual([["Dismiss", "cross"]]);
    });

    test("an empty queue says there is nothing to review", () => {
        const t = makeView(new NoteReviewQueue());
        void t.view.onOpen();
        expect(dumpView(t).subtitle).toContain("No notes are waiting");
        expect(dumpView(t).decks).toEqual([]);
    });
});
