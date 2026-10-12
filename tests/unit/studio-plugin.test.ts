import { Notice } from "obsidian";

import { registerStudioCommands } from "src/commands/studio-commands";
import FlashcardStudioPlugin from "src/studio-plugin";

// What the mocked parts do on this run
const mockRun = {
    sync: () => Promise.resolve(),
    uiConstructor: () => undefined as void,
    layoutReady: null as null | (() => void),
    order: [] as string[],
};

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    getLanguage: () => "en",
    Plugin: class {
        app = {
            workspace: {
                onLayoutReady: (callback: () => void) => {
                    mockRun.layoutReady = callback;
                },
            },
        };
        registerMarkdownCodeBlockProcessor = jest.fn();
        registerEvent = jest.fn();
        addCommand = jest.fn();
    },
}));
jest.mock("src/icons/studio-icon", () => ({ registerStudioIcon: jest.fn() }));
jest.mock("src/commands/answer-commands", () => ({
    addAnswerCommands: jest.fn(),
    removeAnswerCommands: jest.fn(),
}));
jest.mock("src/commands/studio-commands", () => ({
    registerStudioCommands: jest.fn(() => mockRun.order.push("commands")),
}));
jest.mock("src/data/stored-data", () => ({
    SettingsManager: class {
        constructor(public settings: unknown) {}
    },
    PluginDataManager: class {
        pluginData = { settings: { useCustomHotkeys: false, latexClozes: false } };
        loadData = () => Promise.resolve();
        writeSettings = () => Promise.resolve();
    },
}));
jest.mock("src/data/data-hub", () => ({
    DataManager: class {
        constructor(
            public plugin: unknown,
            public pluginData: unknown,
            public settingsManager: unknown,
        ) {}
        loadData = () => mockRun.order.push("loadData");
        initVaultIndex = () => {
            mockRun.order.push("initVaultIndex");
            return Promise.resolve();
        };
        reloadSettings = () => {
            mockRun.order.push("reloadSettings");
            return Promise.resolve();
        };
        sync = () => {
            mockRun.order.push("sync");
            return mockRun.sync();
        };
    },
}));
jest.mock("src/note-review/next-note-review-handler", () => ({
    NextNoteReviewHandler: class {
        noteReviewQueue = {};
    },
}));
jest.mock("src/note-review/note-review-queue", () => ({ NoteReviewQueue: class {} }));
jest.mock("src/occlusion/occlusion-processors", () => ({ registerOcclusion: jest.fn() }));
jest.mock("src/onboarding/onboarding", () => ({
    showWelcomeOnFirstRun: jest.fn(() => Promise.resolve()),
}));
jest.mock("src/scheduling/reminders", () => ({
    ReminderManager: class {
        restartReviewReminders = jest.fn();
        stopReviewReminders = jest.fn();
    },
}));
jest.mock("src/math/cloze-macro", () => ({
    setClozeMathMacro: jest.fn(() => Promise.resolve()),
}));
jest.mock("src/settings/effect-host", () => ({
    reapplySettings: jest.fn(() => mockRun.order.push("effects")),
}));
jest.mock("src/ui/review-log-renderer", () => ({ renderReviewLog: jest.fn() }));
jest.mock("src/utils/markdown-render", () => ({ registerHoverLinkSource: jest.fn() }));
jest.mock("src/ui/studio-ui", () => ({
    UIManager: class {
        constructor() {
            mockRun.uiConstructor();
        }
        onLayoutReady = () => {
            mockRun.order.push("uiLayoutReady");
            return Promise.resolve();
        };
        onDataChanged = jest.fn();
        destroy = jest.fn();
        offerExamResume = jest.fn(() => Promise.resolve());
    },
}));

function newPlugin(): FlashcardStudioPlugin {
    return new (
        FlashcardStudioPlugin as unknown as new (
            app: unknown,
            manifest: unknown,
        ) => FlashcardStudioPlugin
    )({}, {});
}

const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const noticeTexts = (): string[] =>
    (Notice as unknown as jest.Mock<unknown, [string]>).mock.calls.map((call) => call[0]);

beforeEach(() => {
    mockRun.sync = () => Promise.resolve();
    mockRun.uiConstructor = () => undefined;
    mockRun.layoutReady = null;
    mockRun.order = [];
    (Notice as unknown as jest.Mock).mockClear();
    (registerStudioCommands as jest.Mock).mockClear();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("starting up", () => {
    test("the commands exist before the vault is scanned, and the plugin is ready after it", async () => {
        const plugin = newPlugin();
        await plugin.onload();

        expect(registerStudioCommands).toHaveBeenCalledTimes(1);
        expect(plugin.isInitialized).toBe(false);

        mockRun.layoutReady?.();
        await tick();

        expect(plugin.isInitialized).toBe(true);
        expect(mockRun.order).toEqual([
            "commands",
            "loadData",
            "initVaultIndex",
            "uiLayoutReady",
            "sync",
        ]);
        expect(noticeTexts()).toEqual([]);
    });

    // The bug: a throw while scanning left a plugin with no commands and no message
    test("a vault scan that fails leaves the commands in place and tells the person", async () => {
        mockRun.sync = () => Promise.reject(new Error("disk on fire"));
        const plugin = newPlugin();
        await plugin.onload();
        mockRun.layoutReady?.();
        await tick();

        expect(registerStudioCommands).toHaveBeenCalledTimes(1);
        expect(plugin.isInitialized).toBe(false);
        expect(noticeTexts()).toHaveLength(1);
        expect(noticeTexts()[0]).toContain("disk on fire");
    });

    test("an interface that fails to build leaves the commands in place and tells the person", async () => {
        mockRun.uiConstructor = () => {
            throw new Error("no ribbon");
        };
        const plugin = newPlugin();
        await plugin.onload();

        expect(registerStudioCommands).toHaveBeenCalledTimes(1);
        expect(mockRun.layoutReady).toBeNull();
        expect(noticeTexts()[0]).toContain("no ribbon");
    });

    test("a command used before the scan is done says that the plugin is not ready", async () => {
        const plugin = newPlugin();
        await plugin.onload();

        expect(plugin.ensureReady()).toBe(false);
        expect(noticeTexts()).toHaveLength(1);
    });
});

describe("unloading", () => {
    // The bug: onunload threw when the reminders had never been built, and skipped the rest
    test("does not throw when start-up never finished", async () => {
        const plugin = newPlugin();
        await plugin.onload();

        expect(() => plugin.onunload()).not.toThrow();
    });

    test("does not throw when the plugin never loaded at all", () => {
        expect(() => newPlugin().onunload()).not.toThrow();
    });

    test("a scan that finishes after the plugin was unloaded does not make it ready", async () => {
        let finish: () => void = () => undefined;
        mockRun.sync = () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            });
        const plugin = newPlugin();
        await plugin.onload();
        mockRun.layoutReady?.();
        await tick();
        plugin.onunload();
        finish();
        await tick();

        expect(plugin.isInitialized).toBe(false);
    });
});

describe("settings changed on disk by another device", () => {
    test("they are read again, their effects redone and the vault scanned again, in that order", async () => {
        const plugin = newPlugin();
        await plugin.onload();
        mockRun.layoutReady?.();
        await tick();
        mockRun.order = [];

        await plugin.onExternalSettingsChange();

        expect(mockRun.order).toEqual(["reloadSettings", "effects", "sync"]);
    });

    test("before the first scan only the settings are read: the scan will use them", async () => {
        const plugin = newPlugin();
        await plugin.onload();
        mockRun.order = [];

        await plugin.onExternalSettingsChange();

        expect(mockRun.order).toEqual(["reloadSettings"]);
    });

    test("a plugin that never loaded does nothing", async () => {
        await expect(newPlugin().onExternalSettingsChange()).resolves.toBeUndefined();
    });

    test("a failure is logged, not thrown into Obsidian", async () => {
        const plugin = newPlugin();
        await plugin.onload();
        mockRun.layoutReady?.();
        await tick();
        mockRun.sync = () => Promise.reject(new Error("scan failed"));

        await expect(plugin.onExternalSettingsChange()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });
});
