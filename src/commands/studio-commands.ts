import { Editor, MarkdownFileInfo, Notice, TFile } from "obsidian";

import { openGenerateCards } from "src/ai/open-generate-cards";
import { unburyAllInText, unsuspendAllInText } from "src/data/card-meta";
import { t } from "src/lang/translate";
import { createSampleDeck, showWelcome } from "src/onboarding/onboarding";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { NOTE_RATINGS } from "src/ui/note-ratings";
import { exportRevlogCsv, openCustomStudy, openPostpone } from "src/ui/scheduling-commands";
import { UIState } from "src/ui/ui-state";

/**
 * Registers every command except the answer hotkeys. They are all registered when the plugin loads, before the vault
 * has been scanned: each one checks that the plugin is ready when it runs, and says so when it is not.
 */
export function registerStudioCommands(plugin: FlashcardStudioPlugin): void {
    const ui = () => plugin.uiManager;

    /** A command that does something once the plugin is ready. */
    const action = (id: string, name: string, run: () => unknown, icon?: string): void => {
        plugin.addCommand({
            id,
            name,
            icon,
            callback: () => {
                if (plugin.ensureReady()) void run();
            },
        });
    };

    /** The markdown note being edited, or null. */
    const activeNote = (): TFile | null => {
        const file = plugin.app.workspace.getActiveFile();
        return file !== null && file.extension === "md" ? file : null;
    };

    /** A command on the active note: listed only while a markdown note is open and the plugin is ready. */
    const noteAction = (id: string, name: string, run: (note: TFile) => unknown): void => {
        plugin.addCommand({
            id,
            name,
            checkCallback: (checking: boolean) => {
                const note = activeNote();
                if (note === null || !plugin.isInitialized) return false;
                if (!checking) void run(note);
                return true;
            },
        });
    };

    /** A command on the card being studied: listed only while one is on screen. */
    const cardAction = (id: string, name: string, run: () => unknown): void => {
        plugin.addCommand({
            id,
            name,
            checkCallback: (checking: boolean) => {
                const studying =
                    plugin.isInitialized &&
                    ui().contentManager !== null &&
                    (ui().uiState === UIState.CardFront || ui().uiState === UIState.CardBack);
                if (studying && !checking) void run();
                return studying;
            },
        });
    };

    // Notes
    action("open-note-for-review", t("OPEN_NOTE_FOR_REVIEW"), async () => {
        const data = plugin.dataManager;
        if (data.syncLock) return;
        await data.sync();
        await plugin.nextNoteReviewHandler.reviewNextNoteModal();
    });
    for (const rating of NOTE_RATINGS) {
        const label = rating.label(plugin.dataManager.settingsManager.settings);
        noteAction(
            `note-review-${rating.id}`,
            t("REVIEW_NOTE_DIFFICULTY_CMD", { difficulty: label }),
            (note) => plugin.dataManager.saveNoteReviewResponse(note, rating.response),
        );
    }
    action("open-note-queue", t("OPEN_REVIEW_QUEUE_VIEW"), () =>
        ui().sidebarManager.openReviewQueueView(),
    );

    // Flashcards
    action("review-flashcards", t("REVIEW_ALL_CARDS"), () =>
        ui().openDeckContainer(FlashcardReviewMode.Review),
    );
    action("cram-flashcards", t("CRAM_ALL_CARDS"), () =>
        ui().openDeckContainer(FlashcardReviewMode.Cram),
    );
    noteAction("review-flashcards-in-note", t("REVIEW_CARDS_IN_NOTE"), (note) =>
        ui().openDeckContainer(FlashcardReviewMode.Review, note),
    );
    noteAction("cram-flashcards-in-note", t("CRAM_CARDS_IN_NOTE"), (note) =>
        ui().openDeckContainer(FlashcardReviewMode.Cram, note),
    );

    // Onboarding
    plugin.addCommand({
        id: "show-welcome",
        name: t("SHOW_WELCOME"),
        callback: () => void showWelcome(plugin),
    });
    plugin.addCommand({
        id: "create-sample-deck",
        name: t("CREATE_SAMPLE_DECK"),
        callback: () => void createSampleDeck(plugin),
    });

    // The card being studied
    cardAction("undo-last-answer", t("UNDO_LAST_ANSWER"), () =>
        ui().contentManager?._undoLastAnswer(),
    );
    cardAction("suspend-current-card", t("SUSPEND_CARD"), () =>
        ui().contentManager?.cardActions.suspend(),
    );
    cardAction("bury-current-card", t("BURY_CARD"), () => ui().contentManager?.cardActions.bury());
    cardAction("card-info", t("VIEW_CARD_INFO"), () => ui().contentManager?._showCardInfo());

    // The active note: the cards in it, put back in play atomically
    const rewriteNote = (
        id: string,
        name: string,
        rewrite: (text: string) => string,
        done: string,
    ): void =>
        noteAction(id, name, async (note) => {
            await plugin.app.vault.process(note, rewrite);
            new Notice(done);
            await plugin.dataManager.sync();
        });
    rewriteNote(
        "unsuspend-cards-in-note",
        t("UNSUSPEND_NOTE_CARDS"),
        unsuspendAllInText,
        t("CARDS_UNSUSPENDED"),
    );
    rewriteNote(
        "unbury-cards-in-note",
        t("UNBURY_NOTE_CARDS"),
        unburyAllInText,
        t("CARDS_UNBURIED"),
    );

    // Views, scheduling and exams
    action("open-statistics", t("OPEN_STATISTICS"), () => ui().openStatisticsView());
    action("custom-study", t("CUSTOM_STUDY"), () => openCustomStudy(plugin));
    action("postpone-due-reviews", t("POSTPONE_REVIEWS"), () => openPostpone(plugin));
    action("export-revlog-csv", t("EXPORT_REVLOG_CSV"), () => exportRevlogCsv(plugin));
    action("fs-take-exam", t("DESKTOP_TAKE_EXAM"), () => ui().openExamSetup(), "clipboard-check");

    // Anki import and export. The dialogs are loaded when a command runs, so that none of their code (nor sql.js and
    // ankipack behind them) is evaluated while the plugin starts.
    plugin.addCommand({
        id: "import-anki-deck",
        name: t("ANKI_IMPORT_CMD"),
        callback: async () => {
            const { AnkiImportModal } = await import("src/import-export/ui/anki-import-modal");
            new AnkiImportModal(plugin).open();
        },
    });
    plugin.addCommand({
        id: "export-anki",
        name: t("ANKI_EXPORT_CMD"),
        callback: async () => {
            if (!plugin.ensureReady()) return;
            // The decks listed are the ones of the last sync, so make sure they are up to date
            await plugin.dataManager.sync();
            const { AnkiExportModal } = await import("src/import-export/ui/anki-export-modal");
            new AnkiExportModal(plugin).open();
        },
    });

    registerAiCommands(plugin);
}

/**
 * "Generate cards with AI", in the command palette and in the editor's context menu. The dialog is loaded when it is
 * used, so none of its code runs while the plugin starts, and nothing is sent anywhere until it is used.
 */
function registerAiCommands(plugin: FlashcardStudioPlugin): void {
    const open = async (editor: Editor, info: MarkdownFileInfo): Promise<void> => {
        const file = info.file;
        if (file === null) return;
        const fromSelection = editor.somethingSelected();
        await openGenerateCards(
            plugin,
            file,
            fromSelection ? editor.getSelection() : editor.getValue(),
            fromSelection,
        );
    };

    plugin.addCommand({
        id: "fs-generate-cards-ai",
        name: t("AI_GENERATE_CMD"),
        icon: "sparkles",
        editorCallback: (editor: Editor, info: MarkdownFileInfo) => {
            void open(editor, info);
        },
    });

    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
            menu.addItem((item) =>
                item
                    .setTitle(t("AI_GENERATE_CMD"))
                    .setIcon("sparkles")
                    .onClick(() => void open(editor, info)),
            );
        }),
    );
}
