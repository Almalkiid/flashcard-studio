import { Platform } from "obsidian";

import { PluginDataManager } from "src/data/plugin-data-manager";
import { cloneDefaultSettings, DEFAULT_SETTINGS } from "src/data/settings";
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

describe("open in a tab, through the loader", () => {
    test("a new install on desktop opens the Studio in a tab, at the full size of the pane", async () => {
        const manager = managerWith(null);
        await manager.loadData();
        const settings = manager.pluginData.settings;
        expect(manager.isFirstRun).toBe(true);
        expect(settings.openViewInNewTab).toBe(true);
        // What the toggle in the settings does when it is switched on
        expect(settings.flashcardWidthPercentage).toBe(100);
        expect(settings.flashcardHeightPercentage).toBe(100);
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
