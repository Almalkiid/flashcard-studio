import { cloneDefaultSettings } from "src/data/settings-model";
import { setClozeMathMacro } from "src/math/cloze-macro";
import { pluginEffectHost } from "src/settings/effect-host";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { globalDateProvider } from "src/utils/clock";

jest.mock("src/math/cloze-macro", () => ({ setClozeMathMacro: jest.fn() }));

/** A plugin that has not finished starting: its manager getters throw, as the real ones do. */
function earlyPlugin() {
    const settings = cloneDefaultSettings();
    const plugin = {
        isInitialized: false,
        isUiManagerLoaded: jest.fn(() => false),
        dataManager: {
            settingsManager: { settings },
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
    return { plugin, settings, host: pluginEffectHost(plugin as unknown as FlashcardStudioPlugin) };
}

test("no host method throws before the plugin is ready", () => {
    const { host } = earlyPlugin();
    expect(() => {
        host.refreshScheduler();
        host.rebuildScheduler();
        host.setMathMacro(true);
        host.restartReminders();
        host.refreshStatusBar();
        host.applyStartOfDay("04:30:00");
        host.setParserDebug(false);
        host.setHotkeys(true);
        host.leaveTabMode();
    }).not.toThrow();
});

test("the parts that are not ready yet are left alone", () => {
    const { plugin, host } = earlyPlugin();
    host.restartReminders();
    host.refreshStatusBar();
    host.setHotkeys(true);
    host.leaveTabMode();
    expect(plugin.dataManager.isVaultIndexLoaded).not.toHaveBeenCalled();
    expect(plugin.removeCustomHotkeys).not.toHaveBeenCalled();
    expect(plugin.addCustomHotkeys).not.toHaveBeenCalled();
});

test("the scheduler calls use the live settings object", () => {
    const { plugin, settings, host } = earlyPlugin();
    host.refreshScheduler();
    expect(plugin.dataManager.refreshAlgorithmParameters).toHaveBeenCalledWith(settings);
    host.rebuildScheduler();
    expect(plugin.dataManager.setupDataStoreAndAlgorithmInstances).toHaveBeenCalledWith(settings);
});

test("the math macro flag is passed on", () => {
    const { host } = earlyPlugin();
    host.setMathMacro(true);
    expect(setClozeMathMacro).toHaveBeenCalledWith(true);
});

test("once the plugin is ready, hotkeys are removed first and added only when on", () => {
    const { plugin, host } = earlyPlugin();
    plugin.isInitialized = true;
    host.setHotkeys(false);
    expect(plugin.removeCustomHotkeys).toHaveBeenCalledTimes(1);
    expect(plugin.addCustomHotkeys).not.toHaveBeenCalled();
    host.setHotkeys(true);
    expect(plugin.removeCustomHotkeys).toHaveBeenCalledTimes(2);
    expect(plugin.addCustomHotkeys).toHaveBeenCalledTimes(1);
});

test("the start of day reaches the date provider", () => {
    const { host } = earlyPlugin();
    host.applyStartOfDay("04:30:15");
    expect(globalDateProvider.getDayBoundary()).toEqual({ hour: 4, minute: 30, second: 15 });
    globalDateProvider.setDayBoundary(null);
});
