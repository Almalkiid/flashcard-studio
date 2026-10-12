import { Platform, SettingDefinitionItem } from "obsidian";

import { cloneDefaultSettings, DEFAULT_SETTINGS } from "src/data/settings-model";
import { SettingsManager } from "src/data/stored-data";
import { readControl } from "src/settings/adapters";
import { NOT_ON_SCREEN } from "src/settings/coverage";
import { coveredKeys } from "src/settings/definitions/helpers";
import { StudioSettingTab } from "src/settings/settings-tab";
import type FlashcardStudioPlugin from "src/studio-plugin";

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
// The Read aloud page is only on screen where speech exists, so say it does.
jest.mock("src/ui/speech", () => ({
    speechAvailable: jest.fn(() => true),
    VoiceWatcher: jest.fn(),
}));

let tab: StudioSettingTab;

beforeEach(() => {
    (Platform as { isMobile: boolean }).isMobile = false;
    const settings = cloneDefaultSettings();
    const settingsManager = new SettingsManager(settings, () => Promise.resolve());
    const plugin = { dataManager: { settingsManager } } as unknown as FlashcardStudioPlugin;
    tab = new StudioSettingTab({} as never, plugin, settingsManager);
});

test("every setting has a control or a reason", () => {
    const covered = coveredKeys(tab.getSettingDefinitions());
    const missing = Object.keys(DEFAULT_SETTINGS).filter(
        (key) => !covered.has(key as never) && !(key in NOT_ON_SCREEN),
    );
    expect(missing).toEqual([]);
});

test("nothing is both on screen and listed as hidden", () => {
    const covered = coveredKeys(tab.getSettingDefinitions());
    expect(Object.keys(NOT_ON_SCREEN).filter((key) => covered.has(key as never))).toEqual([]);
});

test("every hidden setting is a real setting with a reason", () => {
    for (const [key, reason] of Object.entries(NOT_ON_SCREEN)) {
        expect(key in DEFAULT_SETTINGS).toBe(true);
        expect(reason.length).toBeGreaterThan(0);
    }
});

test("no heading says settings and the first group has none", () => {
    const items = tab.getSettingDefinitions();
    const headings = items.flatMap((item) =>
        "heading" in item && item.heading ? [item.heading] : [],
    );
    expect(headings.filter((h) => /settings/i.test(h))).toEqual([]);
    expect("heading" in items[0] ? items[0].heading : undefined).toBeUndefined();
});

/** The key and default of every number control, however deep inside groups and pages. */
function numberControls(items: readonly SettingDefinitionItem[]): [string, number | undefined][] {
    return items.flatMap((item) => {
        const own: [string, number | undefined][] =
            "control" in item && item.control?.type === "number"
                ? [[item.control.key, item.control.defaultValue]]
                : [];
        return [
            ...own,
            ...("items" in item && item.items !== undefined ? numberControls(item.items) : []),
        ];
    });
}

test("every number control has the shipped default, so clearing a field restores it instead of saving 0", () => {
    const controls = numberControls(tab.getSettingDefinitions());
    expect(controls.map(([key]) => key).sort()).toEqual([
        "baseEase",
        "easyBonus",
        "fsrsDesiredRetention",
        "learnAheadMinutes",
        "leechThreshold",
        "maxNDaysNotesReviewQueue",
        "maximumInterval",
        "newCardsPerDay",
        "reviewReminderIntervalMinutes",
        "reviewsPerDay",
    ]);
    for (const [key, defaultValue] of controls) {
        // As the control shows it: the percent controls show a fraction times 100.
        expect([key, defaultValue]).toEqual([
            key,
            readControl(DEFAULT_SETTINGS, key, { isMobile: false }),
        ]);
    }
});
