import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { NoteEaseList } from "src/note-review/note-ease-list";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { NoteDueDateHistogram } from "src/scheduling/due-histogram";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { globalDateProvider } from "src/utils/clock";
import { setupStaticRandomNumberProvider, staticRandomNumberProvider } from "src/utils/random";

import { FakeVault, makeCore } from "../scheduling/sm2/fake-vault";
import { expectParity, loadGolden } from "./helpers/parity";
import { freezeAt, queueDump, scanLikeLoadVault, settingsWith } from "./helpers/scenario";

// These rerun the scenarios that produced tests/unit/note/golden/*.json against the rewritten note review code and
// hold it to the same values. Inputs come from the golden files themselves. Every difference is a listed fix.

type Json = Record<string, unknown>;
const golden = (name: string) => loadGolden(name) as Json;
const fileOf = (p: string) =>
    ({
        path: p,
        basename: p.replace(/^.*\//, "").replace(/\.md$/, ""),
    }) as unknown as IVaultNoteFile;
const day = (s: string) => new Date(s + "T00:00:00").getTime();

beforeEach(() => {
    // A note whose sr-due is not a date warns once per scan: that is the vault of the golden file, not news
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe("queue build (bug 9: tags match without regard to case)", () => {
    test("queue-build.json", async () => {
        freezeAt("2023-09-06T12:00:00");
        const g = golden("queue-build") as {
            clock: string;
            vault: Record<string, string>;
            variants: Json[];
        };
        const variants: unknown[] = [];
        for (const v of g.variants) {
            const settings = settingsWith(v.settingsOverrides);
            const vault = new FakeVault(g.vault);
            const { core, queue } = makeCore(vault, settings);
            const skipped = await scanLikeLoadVault(vault, core, settings);
            const dump = queueDump(queue);
            // `inbox/case.md` carries `#Review`: the one note the case-insensitive match adds. It is checked here and
            // taken out, so that every other value is compared as it was.
            const reviewed = v.deckOrder as string[];
            for (const deck of dump.decks) {
                const wanted =
                    reviewed.includes(deck.deck) && deck.deck.toLowerCase() === "#review";
                expect(deck.newNotes.includes("inbox/case.md")).toBe(wanted);
                deck.newNotes = deck.newNotes.filter((p) => p !== "inbox/case.md");
            }
            variants.push({
                id: v.id,
                note: v.note,
                settingsOverrides: v.settingsOverrides,
                skippedByLoadVault: skipped,
                ...dump,
                histogramDueNow: core.dueDateNoteHistogram.dueNotesCount,
                noteEaseList: ActiveScheduler.getInstance().noteStats().dict,
            });
        }
        expectParity("queue-build", { clock: g.clock, vault: g.vault, variants });
    });

    test("S4 and S7 are not affected by the case rule", async () => {
        freezeAt("2023-09-06T12:00:00");
        const g = golden("queue-build") as { vault: Record<string, string> };
        const settings = settingsWith({ tagsToReview: ["#review/sub"] });
        const vault = new FakeVault(g.vault);
        const { core, queue } = makeCore(vault, settings);
        await scanLikeLoadVault(vault, core, settings);
        expect(queueDump(queue).decks.flatMap((d) => d.newNotes)).not.toContain("inbox/case.md");
    });
});

test("deck-order.json", async () => {
    freezeAt("2023-09-06T12:00:00");
    const g = golden("deck-order") as { vault: unknown; runs: { tagsToReview: string[] }[] };
    const runs: unknown[] = [];
    for (const r of g.runs) {
        const vault = new FakeVault({
            "a.md": "#review #review-2\n",
            "b.md": "#review-2\n",
            "c.md": "#review\n",
        });
        const settings = settingsWith({ tagsToReview: r.tagsToReview });
        const { core, queue } = makeCore(vault, settings);
        await scanLikeLoadVault(vault, core, settings);
        runs.push({
            tagsToReview: r.tagsToReview,
            deckOrder: queue.reviewDeckNameList,
            decks: queueDump(queue).decks.map((d) => ({ deck: d.deck, newNotes: d.newNotes })),
        });
    }
    expectParity("deck-order", { vault: g.vault, runs });
});

test("sort-vectors.json", () => {
    const g = golden("sort-vectors") as {
        note: string;
        cases: {
            id: string;
            input: { new: string[]; scheduled: string[][]; pageranks: Record<string, number> };
        }[];
    };
    const cases = g.cases.map((c) => {
        const deck = new NoteReviewDeck("#review");
        c.input.new.forEach((p) => deck.newNotes.push(fileOf(p)));
        c.input.scheduled.forEach(([p, d]) =>
            deck.scheduledNotes.push(new SchedNote(fileOf(p), day(d))),
        );
        deck.sortNotesByDateAndImportance(c.input.pageranks);
        return {
            id: c.id,
            input: c.input,
            newOrder: deck.newNotes.map((f) => f.path),
            scheduledOrder: deck.scheduledNotes.map((s) => [
                s.note.path,
                new Date(s.dueUnix).toISOString().slice(0, 10),
            ]),
        };
    });
    expectParity("sort-vectors", { note: g.note, cases });
});

describe("queue-ops.json (bug 3: a note in several decks moves in all of them, and counts once)", () => {
    const sched = (d: string, interval = 1, ease = 250) =>
        Sm2State.fromDueDateStr(d, interval, ease);

    function run() {
        freezeAt("2023-09-06T12:00:00");
        const q = new NoteReviewQueue();
        q.init();
        const steps: Json[] = [];
        const snap = (label: string) => steps.push({ label, ...queueDump(q) });
        q.addNoteToQueue(fileOf("n1.md"), null, ["#a"]);
        q.addNoteToQueue(fileOf("n2.md"), sched("2023-09-05"), ["#a", "#b"]);
        q.addNoteToQueue(fileOf("n3.md"), null, ["#b", "#a"]);
        q.addNoteToQueue(fileOf("n4.md"), sched("2023-09-20"), []);
        snap("");
        q.calcDueNotesCount(day("2023-09-06"));
        snap("");
        q.updateScheduleInfo(fileOf("n3.md"), sched("2023-09-10", 4, 270));
        snap("");
        q.updateScheduleInfo(fileOf("n2.md"), sched("2023-09-30", 24, 260));
        snap("");
        q.updateScheduleInfo(fileOf("unknown.md"), sched("2023-09-30"));
        snap("");
        q.init();
        snap("");
        return steps;
    }

    test("the same steps, compared with the golden values", () => {
        const g = golden("queue-ops") as { note: string; steps: { label: string }[] };
        const steps = run().map((s, i) => ({ ...s, label: g.steps[i].label }));
        // The fixes move these rows:
        //  - step 3 and 4: n3 and n2 change in both decks (was: only #a)
        //  - the count after step 5 is still 1 (n2 once, however many decks)
        const now = JSON.parse(JSON.stringify(steps)) as typeof steps;
        const decks = (i: number) =>
            (
                now[i] as unknown as {
                    decks: {
                        deck: string;
                        newNotes: string[];
                        scheduledNotes: { path: string; due: { local: string } }[];
                    }[];
                }
            ).decks;
        expect(
            decks(2).map((d) => [d.deck, d.newNotes, d.scheduledNotes.map((s) => s.path)]),
        ).toEqual([
            ["#a", ["n1.md"], ["n2.md", "n3.md"]],
            ["#b", [], ["n2.md", "n3.md"]],
        ]);
        expect(decks(3).map((d) => d.scheduledNotes.map((s) => [s.path, s.due.local]))).toEqual([
            [
                ["n2.md", "2023-09-30 00:00"],
                ["n3.md", "2023-09-10 00:00"],
            ],
            [
                ["n2.md", "2023-09-30 00:00"],
                ["n3.md", "2023-09-10 00:00"],
            ],
        ]);
        expectParity("queue-ops", { note: g.note, steps }, [
            {
                fix: "bug 3: rating a note updates every deck that lists it",
                paths: /^steps\[[234]\]\.decks\[\d\]\.(newNotes|scheduledNotes)/,
            },
            {
                fix: "bug 14: the count is 0, not undefined, before the first calculation",
                paths: /^steps\[0\]\.dueNotesCount$/,
                only: (was, now) => was === undefined && now === 0,
            },
            {
                fix: "bug 3: the count after the first deck-count (n2 in two decks) is one note, not two",
                paths: /^steps\[\d\]\.dueNotesCount$/,
                only: (was, now) => was === 2 && now === 1,
            },
        ]);
    });

    test("a note in two decks is counted once", () => {
        freezeAt("2023-09-06T12:00:00");
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("shared.md"), sched("2023-09-05"), ["#a", "#b"]);
        q.addNoteToQueue(fileOf("solo.md"), sched("2023-09-06"), ["#b"]);
        q.addNoteToQueue(fileOf("later.md"), sched("2023-09-08"), ["#a"]);
        q.calcDueNotesCount(day("2023-09-06"));
        expect(q.dueNotesCount).toBe(2);
        expect(q.reviewDecks.get("#b")?.dueNotesCount).toBe(2);
    });

    test("a duplicate tag adds the note to the deck once", () => {
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("n.md"), null, ["#a", "#a"]);
        expect(q.reviewDecks.get("#a")?.newNotes).toHaveLength(1);
    });

    test("the count is 0 before the first calculation", () => {
        expect(new NoteReviewQueue().dueNotesCount).toBe(0);
    });

    test("a deleted note leaves every deck", () => {
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("gone.md"), null, ["#a", "#b"]);
        q.addNoteToQueue(fileOf("kept.md"), sched("2023-09-08"), ["#a"]);
        q.addNoteToQueue(fileOf("gone.md"), sched("2023-09-08"), ["#c"]);
        q.removeNote("gone.md");
        expect(q.reviewDecks.get("#a")?.newNotes).toEqual([]);
        expect(q.reviewDecks.get("#b")?.newNotes).toEqual([]);
        expect(q.reviewDecks.get("#c")?.scheduledNotes).toEqual([]);
        expect(q.reviewDecks.get("#a")?.scheduledNotes.map((s) => s.note.path)).toEqual([
            "kept.md",
        ]);
    });
});

describe("fold state (bug 1, the part kept in the queue)", () => {
    test("a rescan gives the new decks the fold state of the old ones", () => {
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("n.md"), null, ["#review"]);
        const before = q.reviewDecks.get("#review");
        before?.activeFolders.add("New");
        before?.activeFolders.delete("Today");
        q.init();
        q.addNoteToQueue(fileOf("n.md"), null, ["#review"]);
        const after = q.reviewDecks.get("#review");
        expect(after).not.toBe(before);
        expect([...(after?.activeFolders ?? [])]).toEqual(["#review", "New"]);
    });

    test("a deck that is new gets the defaults", () => {
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("n.md"), null, ["#review"]);
        expect([...(q.reviewDecks.get("#review")?.activeFolders ?? [])]).toEqual([
            "#review",
            "Today",
        ]);
    });
});

test("ordering-scan.json", async () => {
    freezeAt("2023-09-06T12:00:00");
    const g = golden("ordering-scan") as { vault: Record<string, string> };
    const vault = new FakeVault(g.vault);
    const settings = settingsWith();
    const { core, queue } = makeCore(vault, settings);
    await scanLikeLoadVault(vault, core, settings);
    const ranks = (core as unknown as { noteLinkGraph: { pageranks: Record<string, number> } })
        .noteLinkGraph.pageranks;
    const rounded = Object.fromEntries(
        Object.entries(ranks)
            .sort()
            .map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]),
    );
    expectParity("ordering-scan", { vault: g.vault, pageranks: rounded, queue: queueDump(queue) });
});

test("queue-day-boundary.json", async () => {
    const g = golden("queue-day-boundary") as {
        vault: Record<string, string>;
        note: string;
        runs: { startOfDay: string; clock: string }[];
    };
    const runs: unknown[] = [];
    for (const r of g.runs) {
        freezeAt(r.clock);
        const settings = settingsWith({ startOfDay: r.startOfDay });
        const vault = new FakeVault(g.vault);
        const { core, queue } = makeCore(vault, settings);
        await scanLikeLoadVault(vault, core, settings);
        const d = queueDump(queue);
        const next = queue.reviewDecks.get("#review")?.determineNextNote(false);
        runs.push({
            startOfDay: r.startOfDay,
            clock: r.clock,
            queueDueNotesCount: d.dueNotesCount,
            perDeckDue: d.decks[0].dueNotesCount,
            scheduled: d.decks[0].scheduledNotes.map((s) => [s.path, s.due.local]),
            nextNoteOpenedFirst: next ? next.path : null,
        });
        jest.useRealTimers();
    }
    expectParity("queue-day-boundary", { vault: g.vault, note: g.note, runs });
});

describe("rating.json", () => {
    const RESPONSES: Record<string, ReviewResponse> = {
        Easy: ReviewResponse.Easy,
        Good: ReviewResponse.Good,
        Hard: ReviewResponse.Hard,
    };

    test("rating a note", async () => {
        const g = golden("rating") as { vault: Record<string, string>; cases: Json[] };
        const frontmatterOf = (vault: FakeVault, p: string) => {
            const f = vault.frontmatter.get(p);
            return f === undefined
                ? null
                : Object.entries(f).map(([k, v]) => `${k}: ${v as string | number}`);
        };
        const cases: unknown[] = [];
        for (const c of g.cases) {
            freezeAt(c["clock"] as string);
            const settings = settingsWith(c["settingsOverrides"]);
            const vault = new FakeVault(g.vault);
            const { core, queue } = makeCore(vault, settings);
            await scanLikeLoadVault(vault, core, settings);
            const queueBefore = queueDump(queue);
            const frontmatterBefore = frontmatterOf(vault, c["path"] as string);
            await core.saveNoteReviewResponse(
                vault.file(c["path"] as string),
                RESPONSES[c["response"] as string],
                settings,
            );
            const queueAfterRating = queueDump(queue);
            const frontmatterAfter = frontmatterOf(vault, c["path"] as string);
            const second = makeCore(vault, settings);
            await scanLikeLoadVault(vault, second.core, settings);
            cases.push({
                id: c["id"],
                note: c["note"],
                clock: c["clock"],
                settingsOverrides: c["settingsOverrides"],
                path: c["path"],
                response: c["response"],
                frontmatterBefore,
                frontmatterAfter,
                queueBefore,
                queueAfterRating,
                queueAfterRescan: queueDump(second.queue),
                noteEaseList: ActiveScheduler.getInstance().noteStats().dict,
            });
            jest.useRealTimers();
        }
        expectParity("rating", { vault: g.vault, cases }, [
            {
                fix: "bug 3: a note in two decks is updated in every deck, so the queue after the rating equals the rescan",
                paths: /^cases\[9\]\.queueAfterRating\.decks\[1\]/,
            },
        ]);
    });
});

describe("next-note-deck.json", () => {
    function mulberry32(seed: number) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function seeded(seed: number, calls: number[][]) {
        const rnd = mulberry32(seed);
        staticRandomNumberProvider.getInteger = (lo: number, hi: number) => {
            const v = Math.floor(rnd() * (hi - lo + 1)) + lo;
            calls.push([lo, hi, v]);
            return v;
        };
        setupStaticRandomNumberProvider();
    }
    function makeDeck(name: string, news: string[], sched: [string, string][]) {
        const d = new NoteReviewDeck(name);
        news.forEach((p) => d.newNotes.push(fileOf(p)));
        sched.forEach(([p, due]) => d.scheduledNotes.push(new SchedNote(fileOf(p), day(due))));
        return d;
    }

    test("determineNextNote vectors", () => {
        freezeAt("2023-09-06T12:00:00");
        const g = golden("next-note-deck") as { note: string; cases: Json[] };
        const DECKS: Record<string, () => NoteReviewDeck> = {
            "due+new": () =>
                makeDeck(
                    "#r",
                    ["n1", "n2", "n3"],
                    [
                        ["d-old", "2023-09-01"],
                        ["d-yesterday", "2023-09-05"],
                        ["d-today", "2023-09-06"],
                        ["f-tomorrow", "2023-09-07"],
                    ],
                ),
            "no-due-only-new": () =>
                makeDeck(
                    "#r",
                    ["n1", "n2", "n3", "n4"],
                    [
                        ["f-1", "2023-09-07"],
                        ["f-2", "2023-09-10"],
                    ],
                ),
            "nothing-due-nothing-new": () => makeDeck("#r", [], [["f-1", "2023-09-07"]]),
            empty: () => makeDeck("#r", [], []),
            "one-due": () => makeDeck("#r", ["n1"], [["only", "2023-09-06"]]),
        };
        const out: unknown[] = [];
        for (const [id, make] of Object.entries(DECKS)) {
            const deck = make();
            deck.sortNotesByDateAndImportance({});
            const plain = deck.determineNextNote(false);
            out.push({ id, openRandomNote: false, result: plain === null ? null : plain.path });
            for (const seed of [1, 2, 3]) {
                const calls: number[][] = [];
                seeded(seed, calls);
                const picks: (string | null)[] = [];
                for (let i = 0; i < 12; i++) {
                    const r = deck.determineNextNote(true);
                    picks.push(r === null ? null : r.path);
                }
                out.push({ id, openRandomNote: true, seed, picks, providerCalls: calls });
            }
        }
        const unsorted = makeDeck(
            "#r",
            [],
            [
                ["late", "2023-09-05"],
                ["early", "2023-09-01"],
            ],
        );
        out.push({
            id: "unsorted-first-due-is-insertion-order",
            openRandomNote: false,
            result: unsorted.determineNextNote(false)?.path,
        });
        expectParity("next-note-deck", { note: g.note, cases: out });
    });

    test("the day boundary decides what is due", () => {
        freezeAt("2023-09-07T02:00:00");
        globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
        try {
            const deck = makeDeck(
                "#r",
                ["n1"],
                [
                    ["a", "2023-09-06"],
                    ["b", "2023-09-07"],
                ],
            );
            expect(deck.determineNextNote(false)?.path).toBe("a");
            deck.scheduledNotes.shift();
            expect(deck.determineNextNote(false)?.path).toBe("n1");
        } finally {
            globalDateProvider.setDayBoundary(null);
        }
    });
});

test("note-ease-list.json", () => {
    const list = new NoteEaseList(settingsWith());
    const g = golden("note-ease-list") as { rows: { step: string }[] };
    const rows: Json[] = [];
    const get = (p: string) => {
        const v = list.getEaseByPath(p);
        return Object.is(v, -0) ? "-0" : v;
    };
    // the golden rows name their fields in snake case, so they are built from pairs
    const add = (i: number, ...fields: [string, unknown][]) =>
        rows.push(Object.fromEntries([["step", g.rows[i].step], ...fields]));
    const noteOf = (i: number): [string, unknown] => ["note", (g.rows[i] as Json)["note"]];
    add(
        0,
        ["baseEase", (list as unknown as { baseEase?: number }).baseEase],
        ["has_a", list.hasEaseForPath("a.md")],
        ["get_a", get("a.md")],
    );
    list.setEaseForPath("a.md", 272.5);
    add(1, ["dict", { ...list.dict }], ["get_a", get("a.md")], noteOf(1));
    list.setEaseForPath("b.md", 272.4);
    add(2, ["get_b", get("b.md")]);
    list.setEaseForPath("c.md", 0);
    add(3, ["has_c", list.hasEaseForPath("c.md")], ["get_c", get("c.md")], noteOf(3));
    list.setEaseForPath("a.md", 130);
    add(4, ["get_a", get("a.md")], ["dictSize", Object.keys(list.dict).length]);
    list.setEaseForPath("n.md", NaN);
    add(
        5,
        ["has_n", list.hasEaseForPath("n.md")],
        ["get_n", Number.isNaN(list.getEaseByPath("n.md")) ? "NaN" : list.getEaseByPath("n.md")],
    );
    list.setEaseForPath("m.md", -0.4);
    add(6, ["get_m", get("m.md")]);
    add(
        7,
        ["has_constructor", list.hasEaseForPath("constructor")],
        ["has_toString", list.hasEaseForPath("toString")],
        ["get_constructor", get("constructor")],
    );
    add(
        8,
        ["has_A", list.hasEaseForPath("A.md")],
        ["has_dot_slash", list.hasEaseForPath("./a.md")],
        ["has_empty", list.hasEaseForPath("")],
    );
    add(9, ["other_dict", { ...new NoteEaseList(settingsWith()).dict }]);
    expectParity("note-ease-list", { rows }, [
        {
            fix: "dead member removed: the baseEase getter (test only) is gone",
            paths: /^rows\[0\]\.baseEase$/,
        },
    ]);
});

describe("the histogram sorts the decks (as the scan relies on)", () => {
    test("calculateFromReviewDecksAndSort sorts every deck by date, then page rank", () => {
        freezeAt("2023-09-06T12:00:00");
        const q = new NoteReviewQueue();
        q.addNoteToQueue(fileOf("late.md"), Sm2State.fromDueDateStr("2023-09-09", 1, 250), ["#r"]);
        q.addNoteToQueue(fileOf("soon.md"), Sm2State.fromDueDateStr("2023-09-07", 1, 250), ["#r"]);
        new NoteDueDateHistogram().calculateFromReviewDecksAndSort(q.reviewDecks, {
            pageranks: {},
        } as never);
        expect(q.reviewDecks.get("#r")?.scheduledNotes.map((s) => s.note.path)).toEqual([
            "soon.md",
            "late.md",
        ]);
    });
});
