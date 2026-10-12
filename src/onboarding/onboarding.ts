import { normalizePath, Notice } from "obsidian";

import { hasLegacySettings, importLegacySettings } from "src/data/legacy-settings-migration";
import { t } from "src/lang/translate";
import { SAMPLE_DECK_PATH, sampleDeckMarkdown } from "src/onboarding/sample-deck";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { WelcomeModal } from "src/ui/obsidian-ui-components/modals/welcome-modal";

/**
 * Creates the sample deck (or opens it when it already exists) and opens it in a new tab.
 */
export async function createSampleDeck(plugin: FlashcardStudioPlugin): Promise<void> {
    const vault = plugin.app.vault;
    const path = normalizePath(SAMPLE_DECK_PATH);
    let file = vault.getFileByPath(path);
    if (!file) {
        const folder = path.substring(0, path.lastIndexOf("/"));
        if (folder && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
        file = await vault.create(path, sampleDeckMarkdown());
        new Notice(t("SAMPLE_DECK_CREATED"));
    }
    await plugin.app.workspace.getLeaf("tab").openFile(file);
}

/**
 * Shows the welcome guide. Offers to import Spaced Repetition settings when that plugin's data exists.
 */
export async function showWelcome(plugin: FlashcardStudioPlugin): Promise<void> {
    const canImport = await hasLegacySettings(plugin);
    new WelcomeModal(plugin.app, {
        createSampleDeck: () => createSampleDeck(plugin),
        startReviewing: () => plugin.uiManager.openDeckContainer(FlashcardReviewMode.Review),
        importLegacySettings: canImport
            ? async () => {
                  await importLegacySettings(plugin);
              }
            : null,
    }).open();
}

/**
 * Shows the welcome guide once, the first time the plugin runs in a vault.
 */
export async function showWelcomeOnFirstRun(plugin: FlashcardStudioPlugin): Promise<void> {
    const pluginDataManager = plugin.dataManager.pluginDataManager;
    const data = pluginDataManager.pluginData;
    if (!pluginDataManager.isFirstRun || data.welcomeShown) return;

    data.welcomeShown = true;
    await pluginDataManager.savePluginData();
    await showWelcome(plugin);
}
