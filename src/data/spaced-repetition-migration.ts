import { normalizePath, Notice } from "obsidian";

import { mergeImportedSettings } from "src/data/settings-import";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";

function spacedRepetitionDataPath(plugin: SRPlugin): string {
    return normalizePath(
        `${plugin.app.vault.configDir}/plugins/obsidian-spaced-repetition/data.json`,
    );
}

/**
 * Whether the original Spaced Repetition plugin has saved settings in this vault.
 */
export async function hasSpacedRepetitionSettings(plugin: SRPlugin): Promise<boolean> {
    return plugin.app.vault.adapter.exists(spacedRepetitionDataPath(plugin));
}

/**
 * Copies the settings of the original Spaced Repetition plugin into Flashcard Studio's and applies them.
 *
 * @returns The number of settings imported, or null when there were none to import.
 */
export async function importSpacedRepetitionSettings(plugin: SRPlugin): Promise<number | null> {
    const path = spacedRepetitionDataPath(plugin);
    const adapter = plugin.app.vault.adapter;

    let imported: unknown;
    try {
        if (!(await adapter.exists(path))) throw new Error("missing");
        imported = JSON.parse(await adapter.read(path));
    } catch {
        new Notice(t("SR_SETTINGS_NOT_FOUND"));
        return null;
    }

    const settingsManager = plugin.dataManager.settingsManager;
    const { settings, importedKeys } = mergeImportedSettings(settingsManager.settings, imported);
    Object.assign(settingsManager.settings, settings);
    await settingsManager.save();
    plugin.dataManager.setupDataStoreAndAlgorithmInstances(settingsManager.settings);
    new Notice(t("SR_SETTINGS_IMPORTED", { count: importedKeys.length }));
    return importedKeys.length;
}
