import { Platform } from "obsidian";

import { PluginDataManager } from "src/data/plugin-data-manager";
import { cloneDefaultSettings, DEFAULT_SETTINGS } from "src/data/settings";
import { ExamAnswer, ExamCardInput, ExamSetup, pickExamQuestions } from "src/exam/exam";
import { makeDraft } from "src/exam/exam-draft";
import type SRPlugin from "src/main";

/** A manager whose plugin has the given saved data, or none: a new install. */
function managerWith(saved: unknown): PluginDataManager {
    const plugin = { loadData: () => Promise.resolve(saved) } as unknown as SRPlugin;
    return new PluginDataManager(plugin);
}

/** Runs `body` as a phone, where Obsidian's Platform says so. */
async function onPhone(body: () => Promise<void>): Promise<void> {
    const original = Object.getOwnPropertyDescriptor(Platform, "isMobile");
    Object.defineProperty(Platform, "isMobile", { get: () => true, configurable: true });
    try {
        await body();
    } finally {
        if (original !== undefined) Object.defineProperty(Platform, "isMobile", original);
    }
}

describe("the first run and how the Studio opens", () => {
    test("a new install on desktop leaves the tab setting and the sizes alone: the Desktop layout setting opens the tab", async () => {
        const manager = managerWith(null);
        await manager.loadData();
        const settings = manager.pluginData.settings;
        expect(manager.isFirstRun).toBe(true);
        // The settings are shared with the phone through the synced data, so the first run must not change them
        expect(settings.openViewInNewTab).toBe(false);
        expect(settings.openViewInNewTabMobile).toBe(false);
        expect(settings.flashcardWidthPercentage).toBe(DEFAULT_SETTINGS.flashcardWidthPercentage);
        expect(settings.flashcardHeightPercentage).toBe(DEFAULT_SETTINGS.flashcardHeightPercentage);
        expect(settings.desktopLayout).toBe(true);
    });

    test("the first run sets the algorithm and the keys of a new install, and nothing about the window", async () => {
        const manager = managerWith(null);
        await manager.loadData();
        const fresh = manager.pluginData.settings;
        const untouched = cloneDefaultSettings();
        const changed = (Object.keys(untouched) as (keyof typeof untouched)[]).filter(
            (key) => JSON.stringify(fresh[key]) !== JSON.stringify(untouched[key]),
        );
        expect(changed.sort()).toEqual(["algorithm", "answerKeys", "fsrsEnableFuzz"]);
    });

    test("a new install on a phone keeps the modal, and the phone's own settings", async () => {
        await onPhone(async () => {
            const manager = managerWith(undefined);
            await manager.loadData();
            const settings = manager.pluginData.settings;
            expect(settings.openViewInNewTab).toBe(false);
            expect(settings.openViewInNewTabMobile).toBe(false);
            expect(settings.flashcardWidthPercentage).toBe(
                DEFAULT_SETTINGS.flashcardWidthPercentage,
            );
        });
    });

    test("an existing install keeps the modal it chose", async () => {
        const saved = {
            settings: {
                ...cloneDefaultSettings(),
                openViewInNewTab: false,
                flashcardWidthPercentage: 70,
                flashcardHeightPercentage: 65,
            },
        };
        const manager = managerWith(saved);
        await manager.loadData();
        const settings = manager.pluginData.settings;
        expect(manager.isFirstRun).toBe(false);
        expect(settings.openViewInNewTab).toBe(false);
        expect(settings.flashcardWidthPercentage).toBe(70);
        expect(settings.flashcardHeightPercentage).toBe(65);
    });

    test("an existing install keeps the tab it chose", async () => {
        const manager = managerWith({ settings: { openViewInNewTab: true } });
        await manager.loadData();
        expect(manager.pluginData.settings.openViewInNewTab).toBe(true);
    });

    test("an existing install saved before the setting existed is not switched to the tab", async () => {
        const manager = managerWith({ settings: {} });
        await manager.loadData();
        expect(manager.pluginData.settings.openViewInNewTab).toBe(false);
    });

    test("the defaults stay as they were, so Reset settings does not change how the Studio opens", () => {
        expect(DEFAULT_SETTINGS.openViewInNewTab).toBe(false);
        expect(cloneDefaultSettings().flashcardWidthPercentage).toBe(60);
    });
});

describe("exam drafts in the plugin's data", () => {
    const CARDS: ExamCardInput[] = [
        {
            id: "c1",
            deck: "CIA",
            front: "Who approves the charter?",
            back: "- [ ] The CAE\n- [x] The board",
            isCloze: false,
            suspended: false,
        },
    ];
    const SETUP: ExamSetup = {
        decks: [],
        count: 1,
        minutes: null,
        filter: "all",
        passPercent: 75,
        title: "Exam",
    };
    const QUESTIONS = pickExamQuestions(CARDS, SETUP, () => 0);
    const EMPTY: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
    const DRAFT = JSON.parse(
        JSON.stringify(
            makeDraft(
                {
                    setup: SETUP,
                    questions: QUESTIONS,
                    answers: [EMPTY],
                    current: 0,
                    startedMs: 1000,
                },
                5000,
            ),
        ),
    ) as unknown;

    /** A plugin whose data is `saved`, with the plugin folder in memory; `failWrites` files cannot be written. */
    function pluginWith(saved: unknown, failWrites = false) {
        const files = new Map<string, string>();
        const saves: unknown[] = [];
        const plugin = {
            loadData: () => Promise.resolve(JSON.parse(JSON.stringify(saved))),
            saveData: (data: unknown) => {
                saves.push(JSON.parse(JSON.stringify(data)));
                return Promise.resolve();
            },
            manifest: { id: "flashcard-studio", dir: ".obsidian/plugins/flashcard-studio" },
            app: {
                loadLocalStorage: () => "mac-1a2b",
                vault: {
                    configDir: ".obsidian",
                    adapter: {
                        exists: (path: string) =>
                            Promise.resolve(files.has(path) || path.endsWith("exam-drafts")),
                        mkdir: () => Promise.resolve(),
                        write: (path: string, text: string) => {
                            if (failWrites) return Promise.reject(new Error("read-only"));
                            files.set(path, text);
                            return Promise.resolve();
                        },
                    },
                },
            },
        };
        return { plugin: plugin as unknown as SRPlugin, files, saves };
    }

    test("drafts that older builds kept there are written out as files, and the data is saved once without them", async () => {
        const { plugin, files, saves } = pluginWith({
            settings: cloneDefaultSettings(),
            examDrafts: { "1000": DRAFT, junk: "x" },
        });
        const manager = new PluginDataManager(plugin);
        await manager.loadData();
        expect([...files.keys()]).toEqual([
            ".obsidian/plugins/flashcard-studio/exam-drafts/1000-mac-1a2b.json",
        ]);
        expect(saves).toHaveLength(1);
        expect(saves[0]).not.toHaveProperty("examDrafts");
        expect(manager.pluginData).not.toHaveProperty("examDrafts");
    });

    test("an empty list of drafts is dropped the same way", async () => {
        const { plugin, files, saves } = pluginWith({
            settings: cloneDefaultSettings(),
            examDrafts: {},
        });
        const manager = new PluginDataManager(plugin);
        await manager.loadData();
        expect(files.size).toBe(0);
        expect(saves).toHaveLength(1);
        expect(saves[0]).not.toHaveProperty("examDrafts");
    });

    test("data that never had drafts is not saved at load", async () => {
        const { plugin, saves } = pluginWith({ settings: cloneDefaultSettings() });
        await new PluginDataManager(plugin).loadData();
        expect(saves).toHaveLength(0);
    });

    test("a new install has none to move", async () => {
        const { plugin, saves } = pluginWith(null);
        await new PluginDataManager(plugin).loadData();
        expect(saves).toHaveLength(0);
    });

    test("when the files cannot be written the drafts stay in the data for the next start", async () => {
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const { plugin, saves } = pluginWith(
            { settings: cloneDefaultSettings(), examDrafts: { "1000": DRAFT } },
            true,
        );
        const manager = new PluginDataManager(plugin);
        await manager.loadData();
        expect(saves).toHaveLength(0);
        expect(manager.pluginData).toHaveProperty("examDrafts");
        log.mockRestore();
    });
});
