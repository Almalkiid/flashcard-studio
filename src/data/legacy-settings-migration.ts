import { normalizePath, Notice } from "obsidian";

import { mergeImportedSettings } from "src/data/settings-import";
import { upgradeSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { reapplySettings } from "src/settings/effect-host";
import type FlashcardStudioPlugin from "src/studio-plugin";

function legacyDataPath(plugin: FlashcardStudioPlugin): string {
    return normalizePath(
        `${plugin.app.vault.configDir}/plugins/obsidian-spaced-repetition/data.json`,
    );
}

/**
 * Whether the original Spaced Repetition plugin has saved settings in this vault.
 */
export async function hasLegacySettings(plugin: FlashcardStudioPlugin): Promise<boolean> {
    return plugin.app.vault.adapter.exists(legacyDataPath(plugin));
}

/**
 * Copies the settings of the original Spaced Repetition plugin into Flashcard Studio's and applies them.
 *
 * @returns The number of settings imported, or null when there were none to import.
 */
export async function importLegacySettings(plugin: FlashcardStudioPlugin): Promise<number | null> {
    const path = legacyDataPath(plugin);
    const adapter = plugin.app.vault.adapter;

    let imported: unknown;
    try {
        if (!(await adapter.exists(path))) throw new Error("missing");
        imported = JSON.parse(await adapter.read(path));
    } catch {
        new Notice(t("LEGACY_SETTINGS_NOT_FOUND"));
        return null;
    }

    const settingsManager = plugin.dataManager.settingsManager;
    const { settings, importedKeys } = mergeImportedSettings(settingsManager.settings, imported);
    // Brought up to date like settings read from data.json, then saved and put to work
    upgradeSettings(settings);
    Object.assign(settingsManager.settings, settings);
    await settingsManager.save();
    reapplySettings(plugin);
    new Notice(t("LEGACY_SETTINGS_IMPORTED", { count: importedKeys.length }));
    return importedKeys.length;
}
