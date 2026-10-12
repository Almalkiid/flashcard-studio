import { PaneType, WorkspaceLeaf } from "obsidian";

import { STUDIO_TAB_VIEW } from "src/data/formats";
import { EXAM_VIEW_TYPE, ExamView } from "src/exam/exam-view";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { ReviewQueueLoader } from "src/ui/session-queue";
import { STATISTICS_VIEW_TYPE, StatisticsView } from "src/ui/statistics-view/statistics-view";
import { StudioTabView } from "src/ui/studio-tab-view";

const TAB_VIEW_TYPES = [STUDIO_TAB_VIEW, STATISTICS_VIEW_TYPE, EXAM_VIEW_TYPE];

/** Registers the plugin's three tab views and opens them. */
export class TabViews {
    // The session a Studio tab that is about to be created will show; the tab takes it when it is made
    private pendingLoader: ReviewQueueLoader | null = null;

    constructor(private readonly plugin: FlashcardStudioPlugin) {}

    public register(): void {
        const plugin = this.plugin;
        plugin.registerView(STUDIO_TAB_VIEW, (leaf) => {
            const loader = this.pendingLoader;
            this.pendingLoader = null;
            return new StudioTabView(leaf, plugin, loader);
        });
        plugin.registerView(STATISTICS_VIEW_TYPE, (leaf) => new StatisticsView(leaf, plugin));
        plugin.registerView(EXAM_VIEW_TYPE, (leaf) => new ExamView(leaf, plugin));
    }

    /**
     * Shows a study session in the Studio tab. A tab that is already open is given the session, so every way of
     * opening one (cram, review in a note, custom study, the cards missed in an exam) shows what was asked for.
     */
    public async openStudio(loader: ReviewQueueLoader): Promise<void> {
        const workspace = this.plugin.app.workspace;
        const existing = workspace.getLeavesOfType(STUDIO_TAB_VIEW)[0];
        if (existing !== undefined && existing.view instanceof StudioTabView) {
            await workspace.revealLeaf(existing);
            await existing.view.startSession(loader);
            return;
        }
        this.pendingLoader = loader;
        try {
            await this.openTabView(STUDIO_TAB_VIEW, "tab");
        } finally {
            this.pendingLoader = null;
        }
    }

    /** Opens a tab view, or brings the one that is already open to the front. */
    public async openTabView(type: string, newLeaf: PaneType | boolean): Promise<void> {
        const workspace = this.plugin.app.workspace;
        let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(type)[0];
        if (leaf === undefined) {
            leaf = workspace.getLeaf(newLeaf);
            await leaf.setViewState({ type, active: true });
        }
        await workspace.revealLeaf(leaf);
    }

    /** Opens an exam in a tab of its own, so one that is still going is never replaced. */
    public async openExamTab(): Promise<void> {
        const leaf = this.plugin.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: EXAM_VIEW_TYPE, active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    /** Closes the tabs Obsidian restored with the layout: they hold no session. */
    public closeAll(): void {
        for (const type of TAB_VIEW_TYPES) this.plugin.app.workspace.detachLeavesOfType(type);
    }
}
