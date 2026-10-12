import "src/ui/global.css";
import { Menu, Notice, Platform, TAbstractFile, TFile } from "obsidian";

import { DataStore } from "src/data/data-store/store";
import { STUDIO_TAB_VIEW } from "src/data/formats";
import { SettingsManager } from "src/data/stored-data";
import { ExamStart } from "src/exam/exam";
import { unfinishedExams } from "src/exam/exam-draft-store";
import { cardsChangedText } from "src/exam/exam-render";
import { ExamResumeModal } from "src/exam/exam-resume";
import { ExamSetupModal } from "src/exam/exam-setup-modal";
import { readExamResults } from "src/exam/exam-store";
import { STUDIO_ICON } from "src/icons/studio-icon";
import { t } from "src/lang/translate";
import { chosenCardsIn, CustomStudySpec } from "src/scheduling/custom-study";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { reviewOpensInTab } from "src/settings/adapters";
import { StudioSettingTab } from "src/settings/settings-tab";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { bounceDock, bringWindowToFront, playBeep } from "src/ui/desktop-window";
import { restoreMobileChrome } from "src/ui/mobile-chrome";
import { NOTE_RATINGS } from "src/ui/note-ratings";
import ContentManager from "src/ui/obsidian-ui-components/content-container/review-screen";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { StudioModalView } from "src/ui/obsidian-ui-components/modals/review-modal";
import { ReviewQueueLoader } from "src/ui/session-queue";
import { SidebarManager } from "src/ui/sidebar-manager";
import { STATISTICS_VIEW_TYPE } from "src/ui/statistics-view/statistics-view";
import { StatusBar } from "src/ui/status-bar";
import { StudioTabView } from "src/ui/studio-tab-view";
import { TabViews } from "src/ui/tab-views";
import { UIState } from "src/ui/ui-state";

export { UIState };

/**
 * Everything the plugin puts on screen outside the review itself: the ribbon icon, the file menu, the settings tab,
 * the tab views, the sidebar pane and the status bar. It also knows what the review is doing (`uiState`) and whether
 * keyboard input belongs to it (`isStudioInFocus`).
 */
export class UIManager {
    public uiState: UIState = UIState.Closed;
    /** The review on screen, in a tab or a modal. */
    public contentManager: ContentManager | null = null;
    public readonly sidebarManager: SidebarManager;

    private readonly tabViews: TabViews;
    private readonly statusBar: StatusBar;
    private focused = false;
    // The exam an exam tab is about to show; the tab takes it when it opens
    private pendingExam: ExamStart | null = null;

    constructor(
        private readonly plugin: FlashcardStudioPlugin,
        private readonly settingsManager: SettingsManager,
    ) {
        const { workspace } = plugin.app;
        this.statusBar = new StatusBar(plugin);
        this.tabViews = new TabViews(plugin);
        this.sidebarManager = new SidebarManager(plugin, settingsManager);
        this.tabViews.register();
        this.sidebarManager.init();

        plugin.addRibbonIcon(STUDIO_ICON, t("REVIEW_CARDS"), () => {
            void this.openDeckContainer(FlashcardReviewMode.Review);
        });
        plugin.registerEvent(workspace.on("file-menu", this.addFileMenuItems.bind(this)));
        plugin.registerEvent(
            workspace.on("active-leaf-change", (leaf) => {
                this.focused = leaf?.view instanceof StudioTabView;
            }),
        );
        plugin.addSettingTab(new StudioSettingTab(plugin.app, plugin, settingsManager));
        // A Studio tab changes the phone's navigation bar; if the plugin goes while one is open, put it back
        plugin.register(restoreMobileChrome);
    }

    private get settings() {
        return this.settingsManager.settings;
    }

    // MARK: Startup

    /** Closes the tabs Obsidian restored (they hold no session) and shows the note review pane if it is wanted. */
    public async onLayoutReady(): Promise<void> {
        this.tabViews.closeAll();
        return this.sidebarManager.activateReviewQueueViewPanel();
    }

    public destroy(): void {
        this.focused = false;
    }

    /** The vault was scanned: refresh the counts and, if the note review pane is on, its list. */
    public onDataChanged(): void {
        this.updateStatusBar();
        this.sidebarManager.redraw();
    }

    public updateStatusBar(): void {
        const { dataManager } = this.plugin;
        const core = dataManager.isVaultIndexLoaded() ? dataManager.vaultIndex : null;
        const todo = core?.remainingRoot;
        const countOf = (state: ReviewItemState) => todo?.getReviewItemCount(state, true) ?? 0;
        const {
            showStatusBar,
            showCardStatusBarItem,
            showNoteStatusBarItem,
            showUpdateAvailableStatusBarItem,
        } = this.settings;
        this.statusBar.render({
            show: showStatusBar,
            showCards: showCardStatusBarItem,
            showNotes: showNoteStatusBarItem,
            showUpdate: showUpdateAvailableStatusBarItem,
            cardsDue: countOf(ReviewItemState.NewItem) + countOf(ReviewItemState.DueItem),
            notesDue: core?.noteReviewQueue.dueNotesCount ?? 0,
        });
    }

    // MARK: Keyboard focus and review state

    /**
     * Whether keyboard input belongs to the review: it is the active view (or a modal of its own), and no other
     * dialog is open over it. The dialog check is made when asked, so nothing has to watch the page for changes.
     */
    public get isStudioInFocus(): boolean {
        return this.focused && !this.otherModalIsOpen();
    }

    public getStudioInFocusState = (): boolean => this.isStudioInFocus;

    public setStudioViewInFocus = (focused: boolean): void => {
        this.focused = focused;
    };

    public setUIState = (state: UIState): void => {
        this.uiState = state;
    };

    public setContentManager = (manager: ContentManager | null): void => {
        this.contentManager = manager;
    };

    /** Lets go of a review that has closed, so its detached screen can be freed. */
    public forgetContentManager(contentManager: ContentManager): void {
        if (this.contentManager === contentManager) this.contentManager = null;
    }

    /** Any dialog other than the review's own modal. */
    private otherModalIsOpen(): boolean {
        const dialogs = Array.from(activeDocument.querySelectorAll(".modal-container"));
        return dialogs.some((dialog) => !dialog.querySelector("#fs-modal-view"));
    }

    // MARK: Opening a review

    /**
     * Opens a review in a tab or a modal, whichever the settings call for. A review that is already open in the Studio
     * tab is given this session instead.
     */
    public async openDeckContainer(
        mode: FlashcardReviewMode,
        singleNote?: TFile,
        customStudy?: CustomStudySpec,
        stayOnDeckList: boolean = false,
    ): Promise<void> {
        const { plugin } = this;
        if (!plugin.ensureReady()) return;
        bringWindowToFront();
        const loader = new ReviewQueueLoader(
            plugin,
            plugin.dataManager.vaultIndex,
            singleNote ?? null,
            mode,
            customStudy ?? null,
            stayOnDeckList,
        );
        if (reviewOpensInTab(this.settings, { isMobile: Platform.isMobile })) {
            await this.tabViews.openStudio(loader);
            return;
        }
        new StudioModalView(plugin.app, plugin, plugin.dataManager.settingsManager, loader).open();
        this.focused = true;
    }

    public async openStatisticsView(): Promise<void> {
        if (!this.plugin.isInitialized) return;
        await this.tabViews.openTabView(STATISTICS_VIEW_TYPE, "tab");
    }

    // MARK: Reminders

    /** Tells the person that cards are due: a notice, a beep and a bounce of the Dock icon, as they chose. */
    public async notifyReviewReminder(): Promise<void> {
        const { reviewReminderMessage, reviewReminderShowNotice } = this.settings;
        if (reviewReminderShowNotice) {
            new Notice(reviewReminderMessage.trim() || t("REVIEW_REMINDER_NOTICE"), 5000);
        }
        if (!Platform.isDesktopApp) return;
        if (this.settings.reviewReminderPlaySound) await playBeep();
        if (this.settings.reviewReminderBounceDock) bounceDock();
    }

    // MARK: File menu

    private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const settings = this.settings;
        const section = "flashcard-studio";

        if (settings.showFileMenuReviewOptions) {
            for (const rating of NOTE_RATINGS) {
                menu.addItem((item) =>
                    item
                        .setTitle(
                            t("REVIEW_DIFFICULTY_FILE_MENU", {
                                difficulty: rating.label(settings),
                            }),
                        )
                        .setIcon(STUDIO_ICON)
                        .setSection(section)
                        .onClick(() => {
                            if (!this.plugin.ensureReady()) return;
                            void this.plugin.dataManager.saveNoteReviewResponse(
                                file,
                                rating.response,
                            );
                        }),
                );
            }
        }

        if (settings.showDeleteButtonInFileMenu) {
            const erasers = [
                {
                    title: t("DELETE_NOTE_SCHEDULING_DATA_IN_NOTE"),
                    question: t("CONFIRM_NOTE_SCHEDULING_DATA_IN_NOTE_DELETION"),
                    progress: t("NOTE_SCHEDULING_DATA_IN_NOTE_DELETION_IN_PROGRESS"),
                    erase: () =>
                        DataStore.instance.fileModifier.deleteNoteSchedulingDataInNote(
                            file,
                            settings.deleteTagsOnSchedulingDataDeletion,
                            settings.tagsToReview,
                        ),
                },
                {
                    title: t("DELETE_SCHEDULING_DATA_OF_CARDS_IN_NOTE"),
                    question: t("CONFIRM_SCHEDULING_DATA_OF_CARDS_IN_NOTE_DELETION"),
                    progress: t("SCHEDULING_DATA_OF_CARDS_IN_NOTE_DELETION_IN_PROGRESS"),
                    erase: () =>
                        DataStore.instance.fileModifier.deleteAllSchedulingDataOfCardsInNote(
                            file,
                            settings.deleteTagsOnSchedulingDataDeletion,
                            settings.flashcardTags,
                        ),
                },
            ];
            for (const eraser of erasers) {
                menu.addItem((item) =>
                    item
                        .setTitle(eraser.title)
                        .setIcon("trash")
                        .setWarning(true)
                        .setSection(section + "-erase")
                        .onClick(() => {
                            new ConfirmationModal(
                                this.plugin.app,
                                eraser.title,
                                eraser.question,
                                eraser.progress,
                                eraser.erase,
                            ).open();
                        }),
                );
            }
        }
    }

    // MARK: Exams

    /**
     * Opens the exam setup. `onStart` gets the exam when the person chooses Start; by default it is taken in the
     * Studio's desktop shell when that is open, and in a tab of its own otherwise.
     */
    public async openExamSetup(onStart?: (start: ExamStart) => void): Promise<void> {
        const { plugin } = this;
        if (!plugin.isInitialized) return;
        // The decks and cards listed are the ones of the last sync, so make sure they are up to date
        await plugin.dataManager.sync();
        const [recent, unfinished] = await Promise.all([
            readExamResults(plugin.app, 5),
            unfinishedExams(plugin),
        ]);
        const begin = onStart ?? ((start: ExamStart) => void this.startExam(start));
        new ExamSetupModal(plugin, recent, unfinished, begin).open();
    }

    /**
     * When Obsidian starts with an exam that was not finished, offers to take it up again or drop it. Nothing happens
     * without one.
     */
    public async offerExamResume(): Promise<void> {
        const drafts = await unfinishedExams(this.plugin);
        if (drafts.length === 0) return;
        new ExamResumeModal(this.plugin, drafts, (start) => void this.startExam(start)).open();
    }

    /**
     * "Study the ones I missed" from an exam in a tab: a session of exactly those cards. Cards that were edited or
     * deleted since the exam cannot be found, and the person is told; with none found nothing opens and the results
     * stay on screen.
     *
     * @returns Whether the session opened.
     */
    public async studyMissed(ids: string[]): Promise<boolean> {
        const { dataManager, isInitialized } = this.plugin;
        if (!isInitialized) return false;
        await dataManager.sync();
        const found = chosenCardsIn(dataManager.vaultIndex.reviewableRoot, ids).length;
        if (found === 0) {
            new Notice(t("EXAM_MISSED_NONE"));
            return false;
        }
        if (found < ids.length) new Notice(cardsChangedText(ids.length - found));
        await this.openDeckContainer(FlashcardReviewMode.Cram, undefined, { type: "cards", ids });
        return true;
    }

    /** Takes an exam where it belongs: in the desktop Studio when it is open and free, else in a tab. */
    public async startExam(start: ExamStart): Promise<void> {
        const studio = this.contentManager;
        if (studio !== null && studio.canRunExam) {
            const leaf = this.plugin.app.workspace.getLeavesOfType(STUDIO_TAB_VIEW)[0];
            if (leaf !== undefined) await this.plugin.app.workspace.revealLeaf(leaf);
            studio.runExam(start);
            return;
        }
        this.pendingExam = start;
        await this.tabViews.openExamTab();
    }

    /** Hands the waiting exam to the tab that shows it; null when there is none. */
    public takePendingExam(): ExamStart | null {
        const exam = this.pendingExam;
        this.pendingExam = null;
        return exam;
    }
}
