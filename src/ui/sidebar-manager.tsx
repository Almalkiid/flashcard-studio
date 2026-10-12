import type { WorkspaceLeaf } from "obsidian";

import type { SettingsManager } from "src/data/stored-data";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { REVIEW_QUEUE_VIEW_TYPE, ReviewQueueListView } from "src/ui/note-review-pane";

/** Puts the notes review queue in the right sidebar and keeps it drawn. */
export class SidebarManager {
    private registered = false;

    constructor(
        private readonly plugin: FlashcardStudioPlugin,
        private readonly settingsManager: SettingsManager,
    ) {}

    private get app() {
        return this.plugin.app;
    }

    redraw(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_QUEUE_VIEW_TYPE)) {
            if (leaf.view instanceof ReviewQueueListView) leaf.view.redraw();
        }
    }

    /** Registers the view type. Safe to call twice: the panel needs it before the layout is ready. */
    init(): void {
        if (this.registered) return;
        this.registered = true;
        this.plugin.registerView(
            REVIEW_QUEUE_VIEW_TYPE,
            (leaf) =>
                new ReviewQueueListView(
                    leaf,
                    this.plugin.nextNoteReviewHandler,
                    this.settingsManager.settings,
                    this.plugin,
                ),
        );
    }

    async activateReviewQueueViewPanel(): Promise<void> {
        if (!this.settingsManager.settings.enableNoteReviewPaneOnStartup) return;
        this.init();
        await this.reviewQueueLeaf();
    }

    async openReviewQueueView(): Promise<void> {
        const leaf = await this.reviewQueueLeaf();
        await this.app.workspace.revealLeaf(leaf);
    }

    private async reviewQueueLeaf(): Promise<WorkspaceLeaf> {
        const reviewQueueLeaf = await this.app.workspace.ensureSideLeaf(
            REVIEW_QUEUE_VIEW_TYPE,
            "right",
            { active: true, reveal: false },
        );
        // A fresh sidebar leaf is empty until it is given the view (#1212: the pane opened blank)
        if (reviewQueueLeaf.view.getViewType() !== REVIEW_QUEUE_VIEW_TYPE) {
            await reviewQueueLeaf.setViewState({ type: REVIEW_QUEUE_VIEW_TYPE, active: true });
        }
        return reviewQueueLeaf;
    }
}
