/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- the golden vectors are untyped JSON */
import { Notice } from "obsidian";

import { DataManager } from "src/data/data-hub";
import { DataStore } from "src/data/data-store/store";
import { cloneDefaultSettings } from "src/data/settings-model";
import { PluginDataManager, SettingsManager } from "src/data/stored-data";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { setupStaticDateProvider20230906 } from "src/utils/clock";

import { FakePlugin } from "./fake-plugin";
import { loadGolden } from "./golden";

// The real note file asks Obsidian for the tags of the cache; the fake cache holds them as `tags`
jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../../support/obsidian"),
    getAllTags: (cache: { tags?: { tag: string }[] }) => [
        ...new Set((cache.tags ?? []).map((entry) => entry.tag)),
    ],
}));

const golden = loadGolden("data-manager.json");
const plugin = golden.skipAndOrder;

beforeEach(() => {
    setupStaticDateProvider20230906();
    jest.clearAllMocks();
});

const NOTES = {
    "Flashcard Studio/Review log/2026-10-flashcard-studio.md": "#flashcards\nL1::l1\n",
    "Flashcard Studio/Exams/Exam 1.md": "#flashcards\nE1::e1\n",
    "Templates/t.md": "#flashcards\nT1::t1\n",
    "Drawings/a.excalidraw.md": "#flashcards\nX1::x1\n",
    "notes/b.md": "#flashcards\nB1::b1\n",
    "a.md": "#flashcards\nA1::a1\n",
};

function spyOnProcessed(manager: DataManager): string[] {
    const processed: string[] = [];
    const core = manager.vaultIndex;
    const original = core.processFile.bind(core);
    jest.spyOn(core, "processFile").mockImplementation(async (file) => {
        processed.push(file.path);
        await original(file);
    });
    return processed;
}

describe("scanning the vault (data-manager.json)", () => {
    test("notes are read one by one in vault order, leaving out the log, the exams and the ignored folders", async () => {
        const fake = new FakePlugin(NOTES, {
            noteFoldersToIgnore: ["Templates", "**/*.excalidraw.md"],
        });
        const { manager } = await fake.startManager();
        const processed = spyOnProcessed(manager);
        await manager.sync();
        expect(Object.keys(NOTES)).toEqual(plugin.filesInVaultOrder);
        // the scan goes in path order, whatever order the vault lists the files in (note review, bug 8)
        expect(processed).toEqual([...plugin.processedInOrder].sort());
        const cards = manager.vaultIndex.reviewableRoot.getDeck({ path: ["flashcards"] } as never);
        expect(cards.newReviewItems.map((card) => card.front)).toEqual(["A1", "B1"]);
        expect(manager.syncLock).toBe(false);
    });

    test("an empty log folder setting leaves the log in; a trailing slash on the setting is ignored", async () => {
        const empty = new FakePlugin(NOTES, { reviewLogFolder: "", noteFoldersToIgnore: [] });
        const first = await empty.startManager();
        const processed = spyOnProcessed(first.manager);
        await first.manager.sync();
        expect(processed).toEqual([
            "Drawings/a.excalidraw.md",
            "Flashcard Studio/Review log/2026-10-flashcard-studio.md",
            "Templates/t.md",
            "a.md",
            "notes/b.md",
        ]);

        const slash = new FakePlugin(NOTES, {
            reviewLogFolder: "Flashcard Studio/Review log/",
            noteFoldersToIgnore: [],
        });
        const second = await slash.startManager();
        const seen = spyOnProcessed(second.manager);
        await second.manager.sync();
        expect(seen).toEqual(["Drawings/a.excalidraw.md", "Templates/t.md", "a.md", "notes/b.md"]);
    });

    test("isInReviewLogFolder", async () => {
        const fake = new FakePlugin({});
        const { manager } = await fake.startManager();
        for (const [folderJson, paths] of Object.entries(
            loadGolden("plugin-data.json").isInReviewLogFolder,
        )) {
            fake.settings.reviewLogFolder = JSON.parse(folderJson);
            for (const [path, expected] of Object.entries(paths as Record<string, boolean>)) {
                expect([folderJson, path, manager.isInReviewLogFolder(path)]).toEqual([
                    folderJson,
                    path,
                    expected,
                ]);
            }
        }
    });

    test("syncs that overlap share one follow-up run, and a sync after both starts a new one", async () => {
        const fake = new FakePlugin(NOTES);
        const { manager } = await fake.startManager();
        const load = jest.spyOn(manager, "loadVault");
        await Promise.all([manager.sync(), manager.sync(), manager.sync()]);
        // The first run, and one more for the calls made while it ran
        expect(load).toHaveBeenCalledTimes(2);
        await manager.sync();
        expect(load).toHaveBeenCalledTimes(3);
    });

    test("a sync asked for while a scan runs gets the state after its call: a note written during the scan is in it", async () => {
        const fake = new FakePlugin({
            "a.md": "#flashcards\nA1::a1\n",
            "b.md": "#flashcards\nB1::b1\n",
        });
        const { manager } = await fake.startManager();
        const core = manager.vaultIndex;
        const original = core.processFile.bind(core);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let held = false;
        jest.spyOn(core, "processFile").mockImplementation(async (file) => {
            // The scan stops at its second note, when the first one has been read already
            if (!held && file.path === "b.md") {
                held = true;
                await gate;
            }
            await original(file);
        });

        const first = manager.sync();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // A note the scan has read is written while it runs, then something asks for the decks
        fake.edit("a.md", "#flashcards\nA1 edited::a1\n");
        const second = manager.sync();
        release();
        await second;

        const fronts = () =>
            manager.vaultIndex.reviewableRoot
                .getDeck({ path: ["flashcards"] } as never)
                .newReviewItems.map((card) => card.front);
        expect(fronts()).toEqual(["A1 edited", "B1"]);
        await first;
    });

    test("loadVault does nothing while a scan runs, and the lock is released afterwards", async () => {
        const fake = new FakePlugin(NOTES);
        const { manager } = await fake.startManager();
        const processed = spyOnProcessed(manager);
        const first = manager.loadVault();
        expect(manager.syncLock).toBe(true);
        await manager.loadVault();
        await first;
        expect(manager.syncLock).toBe(false);
        expect(processed.length).toBeGreaterThan(0);
        const count = processed.length;
        // The second call returned without scanning; a later one that sees no change does not read the notes either
        await manager.loadVault();
        expect(processed.length).toBe(count);
    });

    test("the lock is released when the scan fails", async () => {
        const fake = new FakePlugin(NOTES);
        const { manager } = await fake.startManager();
        jest.spyOn(manager.vaultIndex, "processFile").mockRejectedValue(new Error("boom"));
        await expect(manager.loadVault()).rejects.toThrow("boom");
        expect(manager.syncLock).toBe(false);
    });

    test("sync waits up to three seconds for the metadata cache, and not longer", async () => {
        jest.useFakeTimers();
        try {
            const fake = new FakePlugin(NOTES);
            fake.uncached.add("a.md");
            const { manager } = await fake.startManager();
            const processed = spyOnProcessed(manager);
            let done = false;
            const run = manager.loadVault().then(() => (done = true));
            await jest.advanceTimersByTimeAsync(2999);
            expect(done).toBe(false);
            expect(processed).toEqual([]);
            await jest.advanceTimersByTimeAsync(1);
            await run;
            expect(done).toBe(true);
            expect(fake.handlers.get("resolved") ?? []).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test("sync goes on as soon as the cache says it has resolved", async () => {
        const fake = new FakePlugin(NOTES);
        fake.uncached.add("a.md");
        const { manager } = await fake.startManager();
        const processed = spyOnProcessed(manager);
        const run = manager.loadVault();
        await Promise.resolve();
        expect(processed).toEqual([]);
        fake.uncached.clear();
        fake.emit("resolved");
        await run;
        expect(processed.length).toBeGreaterThan(0);
    });
});

describe("starting up", () => {
    test("the core is missing before it is started", async () => {
        const fake = new FakePlugin(NOTES);
        const manager = new DataManager(
            fake.asPlugin(),
            { pluginData: fake.data } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        expect(() => manager.vaultIndex).toThrow("Vault index not initialized!!!");
        expect(manager.isVaultIndexLoaded()).toBe(false);
        await expect(manager.sync()).rejects.toThrow("Vault index not initialized!!!");
        const { manager: started } = await fake.startManager();
        expect(started.isVaultIndexLoaded()).toBe(true);
    });

    test("the scheduler follows the setting: FSRS, else SM-2", () => {
        const fake = new FakePlugin({});
        const manager = new DataManager(
            fake.asPlugin(),
            { pluginData: fake.data } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        for (const [algorithm, expected] of [
            [SchedulerKind.FSRS, FsrsCardScheduler],
            [SchedulerKind.SM2, Sm2Scheduler],
            ["bogus" as SchedulerKind, Sm2Scheduler],
        ] as const) {
            manager.setupDataStoreAndAlgorithmInstances({ ...cloneDefaultSettings(), algorithm });
            expect(ActiveScheduler.getInstance()).toBeInstanceOf(expected);
        }
        expect(DataStore.getInstance()).toBeDefined();
    });

    test("new parameters reach FSRS and are ignored by SM-2", () => {
        const fake = new FakePlugin({});
        const manager = new DataManager(
            fake.asPlugin(),
            { pluginData: fake.data } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        const settings = { ...cloneDefaultSettings(), algorithm: SchedulerKind.FSRS };
        manager.setupDataStoreAndAlgorithmInstances(settings);
        const update = jest.spyOn(
            ActiveScheduler.getInstance() as FsrsCardScheduler,
            "updateParameters",
        );
        manager.refreshAlgorithmParameters(settings);
        expect(update).toHaveBeenCalledWith(settings);
        manager.setupDataStoreAndAlgorithmInstances({
            ...settings,
            algorithm: SchedulerKind.SM2,
        });
        expect(() => manager.refreshAlgorithmParameters(settings)).not.toThrow();
    });

    test("the bury list is the plugin data's own array, and starting up on a new study day saves once", async () => {
        const fake = new FakePlugin({});
        const saves = jest.fn(() => Promise.resolve());
        fake.data.buryList.push("old");
        fake.data.buryDate = "2023-09-05";
        const manager = new DataManager(
            fake.asPlugin(),
            { pluginData: fake.data, savePluginData: saves } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        await manager.initVaultIndex(
            new (await import("src/note-review/note-review-queue")).NoteReviewQueue(),
            () => Promise.resolve(),
        );
        const list = manager.vaultIndex.buriedCards;
        expect(list.list).toBe(fake.data.buryList);
        expect(list.list).toEqual([]);
        expect(fake.data.buryDate).toBe(golden.buryListSharing.buryDateAfterInit);
        expect(saves).toHaveBeenCalledTimes(golden.buryListSharing.savesDuringInit);
    });
});

describe("single notes", () => {
    test("an exam's file is no note with cards; any other note is read, tags or not", async () => {
        const fake = new FakePlugin({ ...NOTES, "x.md": "#flashcards\nA1::a1\n" });
        const { manager } = await fake.startManager();
        expect(
            await manager.loadNote(fake.fake.tfileOf("Flashcard Studio/Exams/Exam 1.md")),
        ).toBeNull();
        const note = await manager.loadNote(fake.fake.tfileOf("x.md"));
        expect(note?.questionList.map((q) => q.questionText.original)).toEqual(
            golden.loadNote.forCardNoteWithTagAndFoldersOff_questions,
        );
    });

    describe("a review of the note itself", () => {
        const notice = Notice as unknown as jest.Mock;
        const reviewable = {
            "r.md": "#review\nread this\n",
            "t/ignored.md": "#review\nread this too\n",
        };

        test("a note under an ignored folder is not reviewed", async () => {
            const fake = new FakePlugin(reviewable, { noteFoldersToIgnore: ["t"] });
            const { manager } = await fake.startManager();
            await manager.saveNoteReviewResponse(
                fake.fake.tfileOf("t/ignored.md"),
                ReviewResponse.Good,
            );
            expect(notice).toHaveBeenCalledWith(
                "This note is in a skipped folder. Check the skipped folders in settings.",
            );
            expect(fake.fake.frontmatter.has("t/ignored.md")).toBe(false);
        });

        test("a note without a review tag is not reviewed", async () => {
            const fake = new FakePlugin({ "plain.md": "no tags\n" });
            const { manager } = await fake.startManager();
            await manager.saveNoteReviewResponse(
                fake.fake.tfileOf("plain.md"),
                ReviewResponse.Good,
            );
            expect(notice).toHaveBeenCalledWith(
                "Give this note one of your review tags first. They are listed in settings.",
            );
        });

        test("a review writes the schedule into the note, moves it in the queue and goes on to the next note", async () => {
            const fake = new FakePlugin(reviewable);
            const changed = jest.fn(() => Promise.resolve());
            const { manager, queue } = await fake.startManager(changed);
            fake.settings.autoNextNote = true;
            const auto = jest.spyOn(fake.asPlugin().nextNoteReviewHandler, "autoReviewNextNote");
            await manager.sync();
            const deck = queue.reviewDecks.get("#review");
            expect(deck.newNotes.map((note) => note.path)).toEqual(["r.md", "t/ignored.md"]);

            await manager.saveNoteReviewResponse(fake.fake.tfileOf("r.md"), ReviewResponse.Good);
            expect(fake.fake.frontmatter.get("r.md")).toMatchObject({
                "sr-interval": expect.any(Number),
            });
            expect(queue.reviewDecks.get("#review").newNotes.map((note) => note.path)).toEqual([
                "t/ignored.md",
            ]);
            expect(
                queue.reviewDecks.get("#review").scheduledNotes.map((note) => note.note.path),
            ).toEqual(["r.md"]);
            expect(notice).toHaveBeenCalledWith("Rating saved.");
            expect(changed).toHaveBeenCalled();
            expect(auto).toHaveBeenCalledTimes(0);
        });
    });

    test("reviewing a note buries its cards until tomorrow when siblings are buried", async () => {
        const fake = new FakePlugin(
            { "r.md": "#review #flashcards\nQ1::A1\nQ2::A2\n" },
            { burySiblingCards: true },
        );
        const { manager } = await fake.startManager();
        await manager.sync();
        await manager.saveNoteReviewResponse(fake.fake.tfileOf("r.md"), ReviewResponse.Good);
        const list = manager.vaultIndex.buriedCards;
        expect(list.list).toHaveLength(2);
    });

    test("the review log is read from the folder of the settings, for this device", async () => {
        const fake = new FakePlugin({});
        const app = fake.asPlugin().app as unknown as Record<string, unknown>;
        app.loadLocalStorage = () => "mac-ab12";
        const plugin = { ...fake.asPlugin(), app } as never;
        const manager = new DataManager(
            plugin,
            { pluginData: fake.data } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        fake.settings.reviewLogFolder = "Elsewhere/Log";
        expect(manager.reviewLog).toBeDefined();
        expect(manager.reviewLog).not.toBe(manager.reviewLog);
    });

    test("with the scheduling debug setting on, a sync says what it found", async () => {
        const fake = new FakePlugin(NOTES, { showSchedulingDebugMessages: true });
        const { manager } = await fake.startManager();
        const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        await manager.sync();
        expect(debug).toHaveBeenCalledTimes(2);
        debug.mockRestore();
    });

    test("save of the plugin data never throws", async () => {
        const fake = new FakePlugin({});
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const manager = new DataManager(
            fake.asPlugin(),
            {
                pluginData: fake.data,
                savePluginData: () => Promise.reject(new Error("no")),
            } as unknown as PluginDataManager,
            new SettingsManager(fake.settings, () => Promise.resolve()),
        );
        await expect(manager.savePluginData()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("reloadSettings: data.json changed on disk", () => {
    test("the data is read again, and the bury list stays the one array the buried cards hold", async () => {
        const fake = new FakePlugin({ "a.md": "#flashcards\nA1::a1\n" });
        const { manager } = await fake.startManager();
        const list = manager.vaultIndex.buriedCards.list;
        list.push("local");
        const loadData = jest.fn(() => {
            fake.data.buryList = ["from-disk"];
            return Promise.resolve();
        });
        (manager.pluginDataManager as unknown as { loadData: typeof loadData }).loadData = loadData;

        await manager.reloadSettings();

        expect(loadData).toHaveBeenCalledTimes(1);
        expect(manager.vaultIndex.buriedCards.list).toBe(list);
        expect(list).toEqual(["from-disk"]);
        expect(fake.data.buryList).toBe(list);
    });
});
