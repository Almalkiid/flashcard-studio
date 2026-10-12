import { Platform } from "obsidian";

import { setDebugParser } from "src/cards/parse";
import { setClozeMathMacro } from "src/math/cloze-macro";
import { applyReloadedSettings, EffectHost } from "src/settings/effects";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { DateUtil, globalDateProvider } from "src/utils/clock";

/**
 * The real things a settings change has to update. Each method does nothing while the part it needs is not
 * ready yet, since settings can be opened before the plugin has finished starting.
 */
export function pluginEffectHost(plugin: FlashcardStudioPlugin): EffectHost {
    const settings = () => plugin.dataManager.settingsManager.settings;
    return {
        refreshScheduler: () => plugin.dataManager.refreshAlgorithmParameters(settings()),
        rebuildScheduler: () => plugin.dataManager.setupDataStoreAndAlgorithmInstances(settings()),
        setMathMacro: (on) => void setClozeMathMacro(on),
        restartReminders: () => {
            if (plugin.isInitialized) plugin.reminderManager.restartReviewReminders();
        },
        refreshStatusBar: () => {
            if (plugin.isInitialized && plugin.dataManager.isVaultIndexLoaded()) {
                void plugin.uiManager.updateStatusBar();
            }
        },
        applyStartOfDay: (text) => {
            const boundary = DateUtil.strToDayBoundary(text);
            if (boundary !== null) globalDateProvider.setDayBoundary(boundary);
        },
        setParserDebug: (on) => setDebugParser(on),
        setHotkeys: (on) => {
            if (!plugin.isInitialized) return;
            plugin.removeCustomHotkeys();
            if (on) plugin.addCustomHotkeys();
        },
        leaveTabMode: () => {
            if (plugin.isUiManagerLoaded()) plugin.uiManager.setStudioViewInFocus(false);
        },
    };
}

/** Redoes everything the settings set up, after they were replaced as a whole (read from disk, imported). */
export function reapplySettings(plugin: FlashcardStudioPlugin): void {
    applyReloadedSettings(plugin.dataManager.settingsManager.settings, pluginEffectHost(plugin), {
        isMobile: Platform.isMobile,
    });
}
