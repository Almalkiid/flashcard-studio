import { ItemView, WorkspaceLeaf } from "obsidian";

import { STUDIO_TAB_VIEW } from "src/data/formats";
import { ExamStart } from "src/exam/exam";
import { persistenceFor } from "src/exam/exam-draft-store";
import { ExamRunner } from "src/exam/exam-run";
import { saveExamResult } from "src/exam/exam-store";
import { t } from "src/lang/translate";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { reduceMobileChrome, restoreMobileChrome } from "src/ui/mobile-chrome";

export const EXAM_VIEW_TYPE = "flashcard-studio-exam";

/**
 * An exam in a tab of its own: the phone, and the desktop when the Studio's desktop shell is not open. The exam to take
 * is handed over by the plugin when the tab opens; a tab restored with the workspace has none and closes itself.
 */
export class ExamView extends ItemView {
    private readonly plugin: FlashcardStudioPlugin;
    private runner: ExamRunner | null = null;
    // Taken when the tab is made, so its title is right from the start; null for a tab restored with the workspace
    private readonly exam: ExamStart | null;

    constructor(leaf: WorkspaceLeaf, plugin: FlashcardStudioPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.navigation = false;
        this.exam = plugin.uiManager.takePendingExam();
    }

    getViewType(): string {
        return EXAM_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.exam?.setup.title ?? t("EXAM_VIEW_TITLE");
    }

    getIcon(): string {
        return "clipboard-check";
    }

    onOpen(): Promise<void> {
        const exam = this.exam;
        if (exam === null) {
            this.leaf.detach();
            return Promise.resolve();
        }
        this.contentEl.addClass("fs-exam-view");
        // As in the Studio's own tab: the phone's floating navigation would sit over the buttons at the bottom
        reduceMobileChrome();
        this.runner = new ExamRunner(this.contentEl, {
            plugin: this.plugin,
            setup: exam.setup,
            questions: exam.questions,
            ignoreAccents: this.plugin.dataManager.data.settings.ignoreAccentsWhenTyping,
            save: (result) => saveExamResult(this.app, result),
            onStudyMissed: (ids) => void this.plugin.uiManager.studyMissed(ids),
            resume: exam.resume,
            ...persistenceFor(this.plugin),
            onClose: () => this.leaf.detach(),
        });
        this.runner.start();
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.runner?.destroy();
        this.runner = null;
        // Give the phone's navigation back, unless the Studio's tab still needs it out of the way
        if (this.app.workspace.getLeavesOfType(STUDIO_TAB_VIEW).length === 0) restoreMobileChrome();
        return Promise.resolve();
    }
}
