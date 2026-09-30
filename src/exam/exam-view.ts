import { ItemView, WorkspaceLeaf } from "obsidian";

import { SR_TAB_VIEW } from "src/data/constants";
import { ExamStart } from "src/exam/exam";
import { ExamRunner } from "src/exam/exam-run";
import { saveExamResult } from "src/exam/exam-store";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";

export const EXAM_VIEW_TYPE = "flashcard-studio-exam";

/**
 * An exam in a tab of its own: the phone, and the desktop when the Studio's desktop shell is not open. The exam to take
 * is handed over by the plugin when the tab opens; a tab restored with the workspace has none and closes itself.
 */
export class ExamView extends ItemView {
    private readonly plugin: SRPlugin;
    private runner: ExamRunner | null = null;
    // Taken when the tab is made, so its title is right from the start; null for a tab restored with the workspace
    private readonly exam: ExamStart | null;

    constructor(leaf: WorkspaceLeaf, plugin: SRPlugin) {
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
        if (activeDocument.body.classList.contains("is-mobile")) {
            const navbar = activeDocument.getElementsByClassName("mobile-navbar")[0] as
                HTMLElement | undefined;
            navbar?.setCssProps({ position: "relative" });
        }
        if (
            activeDocument.body.classList.contains("is-phone") &&
            activeDocument.body.classList.contains("is-floating-nav")
        ) {
            activeDocument.body.addClass("sr-reduced-bottom-fade-mask");
        }
        this.runner = new ExamRunner(this.contentEl, {
            plugin: this.plugin,
            setup: exam.setup,
            questions: exam.questions,
            ignoreAccents: this.plugin.dataManager.data.settings.ignoreAccentsWhenTyping,
            save: (result) => saveExamResult(this.app, result),
            onStudyMissed: (ids) => {
                void this.plugin.uiManager.openDeckContainer(FlashcardReviewMode.Cram, undefined, {
                    type: "cards",
                    ids,
                });
            },
            onClose: () => this.leaf.detach(),
        });
        this.runner.start();
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.runner?.destroy();
        this.runner = null;
        // Give the phone's navigation back, unless the Studio's tab still needs it out of the way
        if (this.app.workspace.getLeavesOfType(SR_TAB_VIEW).length === 0) {
            const navbar = activeDocument.getElementsByClassName("mobile-navbar")[0] as
                HTMLElement | undefined;
            navbar?.setCssProps({ position: "unset" });
            activeDocument.body.removeClass("sr-reduced-bottom-fade-mask");
        }
        return Promise.resolve();
    }
}
