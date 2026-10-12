import { Notice, Platform } from "obsidian";

import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { SettingsManager } from "src/data/stored-data";
import { errorMessage } from "src/settings/actions";
import { StudioSettingTab } from "src/settings/settings-tab";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    PluginSettingTab: class {
        constructor(
            public app: unknown,
            public plugin: unknown,
        ) {}
        update() {}
        refreshDomState() {}
    },
    Notice: jest.fn(),
    Platform: { isMobile: false },
    Modal: class {},
}));
jest.mock("src/settings/settings.css", () => ({}));
jest.mock("src/math/cloze-macro", () => ({ setClozeMathMacro: jest.fn() }));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal", () => ({
    ConfirmationModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

/** A plugin that has not finished starting: its manager getters throw, as the real ones do. */
function fakePlugin(settingsManager: SettingsManager) {
    return {
        isInitialized: false,
        isUiManagerLoaded: jest.fn(() => false),
        dataManager: {
            settingsManager,
            isVaultIndexLoaded: jest.fn(() => false),
            refreshAlgorithmParameters: jest.fn(),
            setupDataStoreAndAlgorithmInstances: jest.fn(),
        },
        get reminderManager(): never {
            throw new Error("not ready");
        },
        get uiManager(): never {
            throw new Error("not ready");
        },
        removeCustomHotkeys: jest.fn(),
        addCustomHotkeys: jest.fn(),
    };
}

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

let errorSpy: jest.SpyInstance;
let settings: StudioSettings;
let writer: jest.Mock<Promise<void>, [StudioSettings]>;
let plugin: ReturnType<typeof fakePlugin>;
let tab: StudioSettingTab;

beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { isMobile: boolean }).isMobile = false;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    settings = cloneDefaultSettings();
    writer = jest.fn((_: StudioSettings) => Promise.resolve());
    const settingsManager = new SettingsManager(settings, writer);
    plugin = fakePlugin(settingsManager);
    tab = new StudioSettingTab(
        {} as never,
        plugin as unknown as FlashcardStudioPlugin,
        settingsManager,
    );
});

afterEach(() => {
    errorSpy.mockRestore();
});

test("two quick edits both persist", async () => {
    await Promise.all([
        tab.setControlValue("newCardsPerDay", 7),
        tab.setControlValue("reviewsPerDay", 70),
    ]);
    expect(settings.newCardsPerDay).toBe(7);
    expect(settings.reviewsPerDay).toBe(70);
    expect(writer).toHaveBeenLastCalledWith(
        expect.objectContaining({ newCardsPerDay: 7, reviewsPerDay: 70 }),
    );
});

test("saves run one after the other, so a slow first save cannot land after the second", async () => {
    const releases: (() => void)[] = [];
    writer.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));

    const first = tab.setControlValue("newCardsPerDay", 7);
    const second = tab.setControlValue("reviewsPerDay", 70);
    await flush();
    expect(writer).toHaveBeenCalledTimes(1);

    releases[0]();
    await first;
    await flush();
    expect(writer).toHaveBeenCalledTimes(2);

    releases[1]();
    await second;
});

test("setControlValue resolves only after the save", async () => {
    let release!: () => void;
    writer.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    let done = false;
    const pending = tab.setControlValue("newCardsPerDay", 7).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
});

test("save failure shows a notice and keeps the value", async () => {
    writer.mockRejectedValueOnce(new Error("disk full"));
    await tab.setControlValue("burySiblingCards", true);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"));
    expect(settings.burySiblingCards).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
});

test("a failed save does not stop the next one", async () => {
    writer.mockRejectedValueOnce(new Error("disk full"));
    await tab.setControlValue("burySiblingCards", true);
    await tab.setControlValue("newCardsPerDay", 9);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenLastCalledWith(expect.objectContaining({ newCardsPerDay: 9 }));
});

test("renders legacy values without writing", () => {
    settings.flashcardTags = [""];
    settings.fsrsDesiredRetention = 0.5;
    settings.startOfDay = "4:0:0";
    tab.getSettingDefinitions();
    expect(tab.getControlValue("flashcardTags")).toBe("");
    expect(writer).not.toHaveBeenCalled();
});

test("building the definitions needs no part of the plugin that starts later", () => {
    expect(() => tab.getSettingDefinitions()).not.toThrow();
    expect(plugin.dataManager.isVaultIndexLoaded).not.toHaveBeenCalled();
});

test("values go through the key adapters in both directions", async () => {
    await tab.setControlValue("easyBonus", 40);
    expect(settings.easyBonus).toBe(0.4);
    expect(tab.getControlValue("easyBonus")).toBe(40);

    await tab.setControlValue("flashcardTags", "#a #b #a");
    expect(settings.flashcardTags).toEqual(["#a", "#b"]);
    expect(tab.getControlValue("flashcardTags")).toBe("#a #b");
});

test("a per-device control writes the key for the device it runs on", async () => {
    await tab.setControlValue("windowHeight", 70);
    expect(settings.flashcardHeightPercentage).toBe(70);

    (Platform as { isMobile: boolean }).isMobile = true;
    await tab.setControlValue("windowHeight", 55);
    expect(settings.flashcardHeightPercentageMobile).toBe(55);
    expect(settings.flashcardHeightPercentage).toBe(70);
    expect(tab.context().env.isMobile).toBe(true);
});

test("a change that resets another key rebuilds the tab", async () => {
    const update = jest.spyOn(tab, "update");
    await tab.setControlValue("aiProvider", "openai");
    expect(settings.aiModel).toBe("");
    expect(update).toHaveBeenCalled();
});

test("a plain change does not rebuild the tab", async () => {
    const update = jest.spyOn(tab, "update");
    await tab.setControlValue("newCardsPerDay", 8);
    expect(update).not.toHaveBeenCalled();
});

test("watchers hear about their keys only", async () => {
    const heard = jest.fn();
    const stop = tab.context().watch(["fsrsDesiredRetention"], heard);
    await tab.setControlValue("newCardsPerDay", 3);
    expect(heard).not.toHaveBeenCalled();
    await tab.setControlValue("fsrsDesiredRetention", 85);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
});

test("a stopped watcher hears nothing more", async () => {
    const heard = jest.fn();
    const stop = tab.context().watch(["newCardsPerDay"], heard);
    stop();
    await tab.setControlValue("newCardsPerDay", 3);
    expect(heard).not.toHaveBeenCalled();
});

test("a watcher also hears about keys the effects changed", async () => {
    const heard = jest.fn();
    tab.context().watch(["aiModel"], heard);
    await tab.setControlValue("aiProvider", "openai");
    expect(heard).toHaveBeenCalledTimes(1);
});

test("watchers are told after the save", async () => {
    const order: string[] = [];
    writer.mockImplementation(() => {
        order.push("saved");
        return Promise.resolve();
    });
    tab.context().watch(["newCardsPerDay"], () => order.push("heard"));
    await tab.setControlValue("newCardsPerDay", 3);
    expect(order).toEqual(["saved", "heard"]);
});

describe("a change is never lost", () => {
    test("an effect that throws still saves the value, says so, and commit resolves", async () => {
        plugin.dataManager.refreshAlgorithmParameters.mockImplementation(() => {
            throw new Error("bad weights");
        });
        const heard = jest.fn();
        tab.context().watch(["fsrsDesiredRetention"], heard);

        await expect(tab.setControlValue("fsrsDesiredRetention", 85)).resolves.toBeUndefined();

        expect(settings.fsrsDesiredRetention).toBe(0.85);
        expect(writer).toHaveBeenCalledTimes(1);
        expect(writer).toHaveBeenCalledWith(
            expect.objectContaining({ fsrsDesiredRetention: 0.85 }),
        );
        expect(Notice).toHaveBeenCalledWith("Couldn't apply the change: bad weights");
        expect(errorSpy).toHaveBeenCalled();
        expect(heard).toHaveBeenCalledTimes(1);
    });

    test("a custom row's commit survives a throwing effect too", async () => {
        plugin.dataManager.refreshAlgorithmParameters.mockImplementation(() => {
            throw new Error("bad weights");
        });
        await expect(tab.context().commit(["fsrsWeights"])).resolves.toBeUndefined();
        expect(writer).toHaveBeenCalledTimes(1);
    });

    test("one failing effect does not skip the others: the rest run, what they changed is saved, and each failure is said", async () => {
        plugin.dataManager.refreshAlgorithmParameters.mockImplementation(() => {
            throw new Error("bad weights");
        });
        const update = jest.spyOn(tab, "update");
        settings.aiProvider = "openai";
        settings.aiModel = "claude-x";

        await tab.context().commit(["fsrsDesiredRetention", "aiProvider"]);

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith("Couldn't apply the change: bad weights");
        expect(errorSpy).toHaveBeenCalled();
        // The provider's effect ran after the failing one: the model was reset, saved, and the tab redrawn.
        expect(settings.aiModel).toBe("");
        expect(writer).toHaveBeenCalledTimes(1);
        expect(writer).toHaveBeenCalledWith(expect.objectContaining({ aiModel: "" }));
        expect(update).toHaveBeenCalledTimes(1);
    });

    test("a watcher that throws does not stop the others, the redraw, or the commit", async () => {
        const update = jest.spyOn(tab, "update");
        const second = jest.fn();
        tab.context().watch(["aiProvider"], () => {
            throw new Error("watcher broke");
        });
        tab.context().watch(["aiModel"], second);

        await expect(tab.setControlValue("aiProvider", "openai")).resolves.toBeUndefined();

        expect(second).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
        expect(writer).toHaveBeenCalledTimes(1);
    });
});

describe("a notice after a typed value", () => {
    const FSRS4 =
        "0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61";

    test("17 parameters are saved as 21 and the conversion is said after the save", async () => {
        const order: string[] = [];
        writer.mockImplementation(() => {
            order.push("saved");
            return Promise.resolve();
        });
        (Notice as unknown as jest.Mock).mockImplementation(() => order.push("notice"));

        await tab.setControlValue("fsrsWeights", FSRS4);

        expect(settings.fsrsWeights.split(", ")).toHaveLength(21);
        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith("Converted to the 21 parameters of FSRS-6.");
        expect(order).toEqual(["saved", "notice"]);
    });

    test("a value with nothing to say shows no notice", async () => {
        await tab.setControlValue("fsrsWeights", "");
        await tab.setControlValue("newCardsPerDay", 4);
        expect(Notice).not.toHaveBeenCalled();
    });

    test("steps of a day or more show the regular-review notice", async () => {
        await tab.setControlValue("fsrsLearningSteps", "1m 1d");
        expect(settings.fsrsLearningSteps).toBe("1m 1d");
        expect(Notice).toHaveBeenCalledWith(
            "Steps of a day or more work better as regular reviews.",
        );
    });

    describe("only when something newly changes", () => {
        const STEPS = "Steps of a day or more work better as regular reviews.";
        const CONVERTED = "Converted to the 21 parameters of FSRS-6.";
        const noticed = () =>
            (Notice as unknown as jest.Mock<unknown, [string]>).mock.calls.map(([text]) => text);

        test("keystrokes after steps already have a day or more say nothing again", async () => {
            await tab.setControlValue("fsrsLearningSteps", "1m 1d");
            await tab.setControlValue("fsrsLearningSteps", "1m 1d ");
            await tab.setControlValue("fsrsLearningSteps", "1m 12d");
            expect(noticed()).toEqual([STEPS]);
        });

        test("short steps and then a day again says so again", async () => {
            await tab.setControlValue("fsrsRelearningSteps", "1d");
            await tab.setControlValue("fsrsRelearningSteps", "10m");
            await tab.setControlValue("fsrsRelearningSteps", "1d");
            expect(noticed()).toEqual([STEPS, STEPS]);
        });

        test("the two lists of steps do not hide each other's notice", async () => {
            await tab.setControlValue("fsrsLearningSteps", "1d");
            await tab.setControlValue("fsrsRelearningSteps", "1d");
            expect(noticed()).toEqual([STEPS, STEPS]);
        });

        test("keystrokes after 17 parameters were converted say nothing again", async () => {
            await tab.setControlValue("fsrsWeights", FSRS4);
            expect(settings.fsrsWeights.split(", ")).toHaveLength(21);
            await tab.setControlValue("fsrsWeights", FSRS4 + " ");
            await tab.setControlValue("fsrsWeights", FSRS4.replace("2.61", "2.6"));
            expect(noticed()).toEqual([CONVERTED]);
        });

        test("clearing the parameters and typing 17 again says so again", async () => {
            await tab.setControlValue("fsrsWeights", FSRS4);
            await tab.setControlValue("fsrsWeights", "");
            await tab.setControlValue("fsrsWeights", FSRS4);
            expect(noticed()).toEqual([CONVERTED, CONVERTED]);
        });
    });
});

describe("context", () => {
    test("settings is the live object", () => {
        expect(tab.context().settings).toBe(settings);
    });

    test("commit runs the effects for keys that custom rows changed, then saves once", async () => {
        settings.fsrsDesiredRetention = 0.85;
        await tab.context().commit(["fsrsDesiredRetention", "fsrsWeights"]);
        expect(plugin.dataManager.refreshAlgorithmParameters).toHaveBeenCalledTimes(1);
        expect(writer).toHaveBeenCalledTimes(1);
    });

    test("rebuild runs the definitions again and refresh only re-checks the rows", () => {
        const update = jest.spyOn(tab, "update");
        const refresh = jest.spyOn(tab, "refreshDomState");
        tab.context().refresh();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
        tab.context().rebuild();
        expect(update).toHaveBeenCalledTimes(1);
    });

    test("confirm opens the confirmation dialog with no extra message", async () => {
        const onConfirm = jest.fn();
        tab.context().confirm("Delete?", "This cannot be undone.", onConfirm);
        const modal = ConfirmationModal as unknown as jest.Mock<
            { open: jest.Mock },
            [unknown, string, string, string, () => Promise<void>]
        >;
        expect(modal).toHaveBeenCalledWith(
            {},
            "Delete?",
            "This cannot be undone.",
            "",
            expect.any(Function),
        );
        const opened = modal.mock.results[0] as jest.MockResultReturn<{ open: jest.Mock }>;
        expect(opened.value.open).toHaveBeenCalledTimes(1);

        await modal.mock.calls[0][4]();
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe("a confirmed action never fails silently", () => {
    /** Opens the confirmation and returns what the dialog runs when the person confirms. */
    function confirmed(onConfirm: () => Promise<void> | void): () => Promise<void> {
        const modal = ConfirmationModal as unknown as jest.Mock<
            unknown,
            [unknown, string, string, string, () => Promise<void>]
        >;
        modal.mockClear();
        tab.context().confirm("Delete?", "This cannot be undone.", onConfirm);
        return modal.mock.calls[0][4];
    }

    test("an action that rejects shows why, logs it, and the confirmation still resolves", async () => {
        const run = confirmed(() => Promise.reject(new Error("vault is read-only")));
        await expect(run()).resolves.toBeUndefined();
        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith("Couldn't finish: vault is read-only");
        expect(errorSpy).toHaveBeenCalled();
    });

    test("an action that throws at once is reported the same way", async () => {
        const run = confirmed(() => {
            throw new Error("no file modifier");
        });
        await expect(run()).resolves.toBeUndefined();
        expect(Notice).toHaveBeenCalledWith("Couldn't finish: no file modifier");
    });

    test("something thrown that is not an Error is still said", async () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error is the point of this test
        const run = confirmed(() => Promise.reject("nope"));
        await expect(run()).resolves.toBeUndefined();
        expect(Notice).toHaveBeenCalledWith("Couldn't finish: nope");
    });

    test("an action that works shows no notice", async () => {
        const run = confirmed(() => Promise.resolve());
        await run();
        expect(Notice).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    test("a second confirm while the first is running waits for it instead of returning early", async () => {
        let finish!: () => void;
        const onConfirm = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        const run = confirmed(onConfirm);

        let secondDone = false;
        const first = run();
        const second = run().then(() => (secondDone = true));
        await flush();
        expect(onConfirm).toHaveBeenCalledTimes(1);
        // The dialog closes when this resolves, so it must not resolve while the real work is still going.
        expect(secondDone).toBe(false);

        finish();
        await first;
        await second;
        expect(secondDone).toBe(true);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    test("a second confirm during a failing action waits for it too, and the failure is said once", async () => {
        let fail!: (error: Error) => void;
        const onConfirm = jest.fn(() => new Promise<void>((_, reject) => (fail = reject)));
        const run = confirmed(onConfirm);

        let secondDone = false;
        const first = run();
        const second = run().then(() => (secondDone = true));
        await flush();
        expect(secondDone).toBe(false);

        fail(new Error("vault is read-only"));
        await expect(first).resolves.toBeUndefined();
        await expect(second).resolves.toBe(true);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith("Couldn't finish: vault is read-only");
    });

    test("each confirmation has its own work in flight, and a finished one can run again", async () => {
        let failFirst!: (error: Error) => void;
        const first = jest.fn(() => new Promise<void>((_, reject) => (failFirst = reject)));
        const runFirst = confirmed(first);
        const firstDone = runFirst();
        await flush();

        // The first is still pending, and a different confirmation must not be held up by it.
        const second = jest.fn(() => Promise.resolve());
        await confirmed(second)();
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1);

        failFirst(new Error("failed once"));
        await firstDone;
        first.mockImplementation(() => Promise.reject(new Error("failed again")));
        await runFirst();
        expect(first).toHaveBeenCalledTimes(2);
    });
});

describe("errorMessage", () => {
    test("an Error says its message", () => {
        expect(errorMessage(new Error("disk full"))).toBe("disk full");
    });

    test("anything else is turned into text", () => {
        expect(errorMessage("nope")).toBe("nope");
        expect(errorMessage(42)).toBe("42");
        expect(errorMessage(undefined)).toBe("undefined");
    });

    test("a failing save says it the same way", async () => {
        writer.mockRejectedValueOnce("disk full");
        await tab.setControlValue("burySiblingCards", true);
        expect(Notice).toHaveBeenCalledWith("Couldn't save: disk full");
    });
});

test("the first group has no heading", () => {
    const first = tab.getSettingDefinitions()[0];
    expect(first).toMatchObject({ type: "group" });
    expect((first as { heading?: string }).heading).toBeUndefined();
});

test("the groups follow each other in the order of the tab", () => {
    const headings = tab
        .getSettingDefinitions()
        .map((item) => (item as { heading?: string }).heading);
    expect(headings).toEqual([
        undefined,
        "Studying",
        "Scheduling",
        "Card formats",
        "Note review",
        "Display",
        "Reminders",
        "AI cards",
        "Data",
        "Delete schedules",
        "Reset",
        "Developer",
        "Help",
    ]);
});
