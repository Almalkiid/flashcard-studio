/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- the golden vectors are untyped JSON */
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import {
    DEFAULT_DATA,
    PluginData,
    PluginDataError,
    PluginDataManager,
    SettingsManager,
} from "src/data/stored-data";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type FlashcardStudioPlugin from "src/studio-plugin";

import { loadGolden } from "./golden";

const golden = loadGolden("plugin-data.json");
const ABSENT = { $absent: true };

function pluginWith(saved: unknown) {
    const saveData = jest.fn(() => Promise.resolve());
    const plugin = {
        loadData: () => Promise.resolve(saved),
        saveData,
    } as unknown as FlashcardStudioPlugin;
    return { plugin, saveData };
}

async function loaded(saved: unknown) {
    const { plugin, saveData } = pluginWith(saved);
    const manager = new PluginDataManager(plugin);
    await manager.loadData();
    return { manager, saveData };
}

const settingsDiff = (settings: StudioSettings) => {
    const diff: Record<string, { default: unknown; loaded: unknown }> = {};
    const current = settings as unknown as Record<string, unknown>;
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(current), ...Object.keys(defaults)])) {
        if (JSON.stringify(current[key]) !== JSON.stringify(defaults[key])) {
            diff[key] = {
                default: key in defaults && defaults[key] !== undefined ? defaults[key] : ABSENT,
                loaded: key in current ? current[key] : ABSENT,
            };
        }
    }
    return diff;
};

/**
 * What the golden run recorded, with the deliberate differences: no empty cloze list (bug 1), a null does not
 * replace a default (bug 7), and a partial nested record is filled up from the defaults (bug 7).
 */
function expectedOf(name: string, result: unknown) {
    const expected = JSON.parse(JSON.stringify(result));
    delete expected.settingsDiffVsShippedDefaults.clozePatterns;
    if (name === "null value overrides a default") {
        delete expected.settingsDiffVsShippedDefaults.flashcardTags;
    }
    if (name === "scheduleData replaced wholesale") {
        expected.otherTopLevel.scheduleData = { version: 2, noteSchedules: {}, cardSchedules: {} };
    }
    if (name === "limitOverride partial replaced wholesale") {
        expected.otherTopLevel.limitOverride = { date: "2023-09-06", extraNew: 0, extraReviews: 0 };
    }
    return expected;
}

describe("loadData against the golden vectors (plugin-data.json)", () => {
    test.each(golden.cases.map((c: { name: string }) => [c.name, c]))("%s", async (_name, c) => {
        const saved = c.savedDataJson?.$undefined ? undefined : c.savedDataJson;
        const { manager, saveData } = await loaded(saved);
        const { settings, ...otherTopLevel } = manager.pluginData;
        expect({
            isFirstRun: manager.isFirstRun,
            settingsDiffVsShippedDefaults: settingsDiff(settings),
            otherTopLevel,
            saveCalls: saveData.mock.calls.length,
        }).toEqual(expectedOf(c.name, c.result));
    });

    test("the defaults are those of the golden run, plus the review order and the FSRS load balancing", () => {
        const expected = JSON.parse(JSON.stringify(golden.defaultData));
        // JSON cannot hold undefined: the four legacy keys are marked in the golden file and left out of the copy
        for (const [key, value] of Object.entries(expected.settings)) {
            if ((value as { $undefined?: boolean }).$undefined) delete expected.settings[key];
        }
        const actual = JSON.parse(JSON.stringify(DEFAULT_DATA));
        delete actual.settings.reviewOrder;
        delete actual.settings.fsrsLoadBalance;
        delete actual.settings.fsrsEasyDays;
        expect(actual.settings.typedAnswerEvaluation).toBe("deterministic");
        delete actual.settings.typedAnswerEvaluation;
        expect(actual).toEqual(expected);
    });
});

describe("loading data.json", () => {
    test("a block saved before the review order existed starts on the due date order", async () => {
        const { manager } = await loaded({ settings: { openViewInNewTab: true } });
        expect(manager.pluginData.settings.reviewOrder).toBe("dueDate");
        expect(manager.pluginData.settings.openViewInNewTab).toBe(true);
    });

    test("a saved review order is kept", async () => {
        const { manager } = await loaded({ settings: { reviewOrder: "mostAtRisk" } });
        expect(manager.pluginData.settings.reviewOrder).toBe("mostAtRisk");
    });

    test("bug 1: a block without cloze settings still makes highlights into cards", async () => {
        const { manager } = await loaded({ settings: { openViewInNewTab: true } });
        expect(manager.pluginData.settings.clozePatterns).toEqual(["==[123;;]answer[;;hint]=="]);
    });

    test("bug 7: a null limit override or setting does not replace the default", async () => {
        const { manager } = await loaded({
            settings: { tagsToReview: null, algorithm: "SM-2-OSR" },
            limitOverride: null,
            buryList: null,
        });
        const data = manager.pluginData;
        expect(data.settings.tagsToReview).toEqual(["#review"]);
        expect(data.limitOverride).toEqual({ date: "", extraNew: 0, extraReviews: 0 });
        expect(data.buryList).toEqual([]);
        expect(data.settings.algorithm).toBe(SchedulerKind.SM2);
    });

    test("a first run keeps the other saved top-level data and starts on FSRS", async () => {
        const { manager } = await loaded({ buryDate: "2023-09-05", buryList: ["abc"] });
        expect(manager.isFirstRun).toBe(true);
        expect(manager.pluginData.settings.algorithm).toBe(SchedulerKind.FSRS);
        expect(manager.pluginData.buryList).toEqual(["abc"]);
    });

    test("data that is not an object is a first run", async () => {
        const { manager } = await loaded("garbage");
        expect(manager.isFirstRun).toBe(true);
    });

    test("loaded data shares nothing with the defaults", async () => {
        const first = await loaded(null);
        first.manager.pluginData.buryList.push("x");
        first.manager.pluginData.settings.flashcardTags.push("#y");
        const second = await loaded(null);
        expect(second.manager.pluginData.buryList).toEqual([]);
        expect(second.manager.pluginData.settings.flashcardTags).toEqual(["#flashcards"]);
        expect(DEFAULT_DATA.buryList).toEqual([]);
    });
});

describe("loading twice", () => {
    test("the settings object stays the same one, holding the newly loaded values", async () => {
        let saved: unknown = { settings: { learnerName: "First" } };
        const plugin = {
            loadData: () => Promise.resolve(saved),
            saveData: jest.fn(),
        } as unknown as FlashcardStudioPlugin;
        const manager = new PluginDataManager(plugin);
        await manager.loadData();
        const shared = manager.pluginData.settings;
        saved = { settings: { learnerName: "Second" } };
        await manager.loadData();
        expect(manager.pluginData.settings).toBe(shared);
        expect(shared.learnerName).toBe("Second");
    });
});

describe("before the data is loaded", () => {
    test("bug 8: isLoaded says false, the data and the saves throw", async () => {
        const { plugin } = pluginWith(null);
        const manager = new PluginDataManager(plugin);
        expect(manager.isLoaded).toBe(false);
        expect(() => manager.pluginData).toThrow(PluginDataError);
        expect(() => manager.pluginData).toThrow(golden.beforeLoad.pluginData.throws);
        await expect(manager.savePluginData()).rejects.toThrow(PluginDataError);
        await expect(manager.writeSettings({} as StudioSettings)).rejects.toThrow(PluginDataError);
        await manager.loadData();
        expect(manager.isLoaded).toBe(true);
    });
});

describe("writing the settings", () => {
    test("the settings object stays the same one, with the new values in it, and the data is saved once", async () => {
        const { manager, saveData } = await loaded({ settings: {} });
        const shared = manager.pluginData.settings;
        const other = { ...shared, learnerName: "Ed" };
        await manager.writeSettings(other);
        expect(manager.pluginData.settings).toBe(shared);
        expect(shared.learnerName).toBe("Ed");
        expect(saveData).toHaveBeenCalledTimes(1);
        const saved = (saveData.mock.calls[0] as unknown as [PluginData])[0];
        expect(saved.settings.learnerName).toBe("Ed");
    });

    test("keys the new settings lack are gone from the shared object", async () => {
        const { manager } = await loaded({ settings: { leftOver: 1 } });
        const shared = manager.pluginData.settings;
        await manager.writeSettings({ ...DEFAULT_SETTINGS });
        expect("leftOver" in shared).toBe(false);
    });
});

describe("SettingsManager", () => {
    const make = (write: (s: StudioSettings) => Promise<void>) => {
        const settings = { ...DEFAULT_SETTINGS };
        return { settings, manager: new SettingsManager(settings, write) };
    };

    test("save writes the settings it holds, again and again", async () => {
        const write = jest.fn(() => Promise.resolve());
        const { settings, manager } = make(write);
        await manager.save();
        await manager.save();
        expect(write).toHaveBeenCalledTimes(2);
        expect(manager.settings).toBe(settings);
    });

    test("settings handed over as another object are copied into the shared one, which every holder sees", async () => {
        const written: StudioSettings[] = [];
        const { settings, manager } = make((s) => {
            written.push(s);
            return Promise.resolve();
        });
        await manager.saveSettings({ ...settings, learnerName: "New" });
        expect(manager.settings).toBe(settings);
        expect(settings.learnerName).toBe("New");
        expect(written[0]).toBe(settings);
    });

    test("a failed write is only logged by save and thrown by saveOrThrow", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const { manager } = make(() => Promise.reject(new Error("disk full")));
        await expect(manager.save()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        await expect(manager.saveOrThrow()).rejects.toThrow("disk full");
        warn.mockRestore();
    });
});
