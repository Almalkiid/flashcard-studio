import { normalizePath, Notice } from "obsidian";

import {
    hasSpacedRepetitionSettings,
    importSpacedRepetitionSettings,
} from "src/data/spaced-repetition-migration";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { SAMPLE_DECK_PATH, sampleDeckMarkdown } from "src/onboarding/sample-deck";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import { WelcomeModal } from "src/ui/obsidian-ui-components/modals/welcome-modal";

/**
 * Creates the sample deck (or opens it when it already exists) and opens it in a new tab.
 */
export async function createSampleDeck(plugin: SRPlugin): Promise<void> {
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
export async function showWelcome(plugin: SRPlugin): Promise<void> {
    const canImport = await hasSpacedRepetitionSettings(plugin);
    new WelcomeModal(plugin.app, {
        createSampleDeck: () => createSampleDeck(plugin),
        startReviewing: () => plugin.uiManager.openDeckContainer(FlashcardReviewMode.Review),
        importSpacedRepetitionSettings: canImport
            ? async () => {
                  await importSpacedRepetitionSettings(plugin);
              }
            : null,
    }).open();
}

/**
 * Shows the welcome guide once, the first time the plugin runs in a vault.
 */
export async function showWelcomeOnFirstRun(plugin: SRPlugin): Promise<void> {
    const pluginDataManager = plugin.dataManager.pluginDataManager;
    const data = pluginDataManager.pluginData;
    if (!pluginDataManager.isFirstRun || data.welcomeShown) return;

    data.welcomeShown = true;
    await pluginDataManager.savePluginData();
    await showWelcome(plugin);
}
