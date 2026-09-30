import { App, MarkdownView, Notice, Platform } from "obsidian";

import { NotePickerModal } from "src/ai/note-picker-modal";
import { openGenerateCards } from "src/ai/open-generate-cards";
import { DataManager } from "src/data/data-manager";
import { Card } from "src/data/data-structures/card/card";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { SRSettings } from "src/data/settings";
import { ExamStart, examSummary } from "src/exam/exam";
import { persistenceFor } from "src/exam/exam-draft-store";
import { cardsChangedText } from "src/exam/exam-render";
import { ExamRunner } from "src/exam/exam-run";
import { readExamResults, saveExamResult } from "src/exam/exam-store";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { Note } from "src/note/note";
import { editOcclusionQuestion } from "src/occlusion/occlusion-processors";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { RepItemState, ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { customStudyMode, CustomStudySpec, forgottenCardIds } from "src/scheduling/custom-study";
import {
    DeckStats,
    FlashcardReviewMode,
    IFlashcardReviewSequencer,
    UndoRecord,
} from "src/scheduling/flashcard-review-sequencer";
import { UndoHistory, UndoResult } from "src/scheduling/undo-history";
import { heatmap, streaks, todaySummary } from "src/stats/activity";
import { trueRetention } from "src/stats/answers";
import { forecast } from "src/stats/cards";
import { DayKeyFn } from "src/stats/day-keys";
import { filterEntriesByDeck } from "src/stats/scope";
import { buildSessionSummary } from "src/stats/session";
import { StatsCard } from "src/stats/types";
import { WEAK_AREA_MIN_REVIEWS, weakAreas } from "src/stats/weak-areas";
import { CardActions } from "src/ui/card-actions";
import { CardContainer } from "src/ui/obsidian-ui-components/content-container/card-container/card-container";
import { DeckContainer } from "src/ui/obsidian-ui-components/content-container/deck-container/deck-container";
import { HomeInsights } from "src/ui/obsidian-ui-components/content-container/deck-container/studio-home";
import {
    buildCardInfoData,
    CardInfoData,
    FORECAST_DAYS,
    forecastForHome,
    learningCount,
    retentionBelowTarget,
    summarizeSessionAnswers,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";
import {
    DeckDetail,
    DesktopHomeServices,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-home";
import {
    desktopTabWanted,
    DesktopShell,
    DesktopShellActions,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import {
    renderStudySidePanel,
    updateStudyPanelTime,
} from "src/ui/obsidian-ui-components/content-container/desktop/study-side-panel";
import { CardInfoModal } from "src/ui/obsidian-ui-components/modals/card-info-modal";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { FlashcardEditModal } from "src/ui/obsidian-ui-components/modals/edit-modal";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import { collectStatsCards, currentDayKeyFn, toStatsCard } from "src/ui/statistics-view/stats-data";
import { UIManager, UIState } from "src/ui/ui-manager";
import { moment } from "src/utils/dates";
import EmulatedPlatform from "src/utils/platform-detector";

export enum ContentState {
    Deck,
    CardFront,
    CardBack,
    Closed,
}

export enum CardState {
    Front,
    Back,
    Closed,
}

export interface CardData {
    currentCard: Card | null;
    currentCardState: CardState;
}

export interface DeckData {
    chosenDeck: Deck;
    currentDeck: Deck | null;
    previousDeck: Deck | null;
    currentDeckTotalCardsInQueue: number;
    currentDeckStats: DeckStats | null;
    previousDeckStats: DeckStats | null;
    chosenDeckStats: DeckStats;
}

export interface SessionData {
    cardData: CardData;
    deckData: DeckData;

    totalDecksInSession: number;
    totalCardsInSession: number;

    currentQuestion: Question;
    currentNote: Note;
}

/** What the desktop home reads from the review log and the cards. */
interface DesktopData {
    entries: ReviewLogEntry[];
    cards: StatsCard[];
    todayKey: string;
    dayKeyOf: DayKeyFn;
    weekStart: number;
}

/** Weeks of answers the home's activity grid shows. */
const ACTIVITY_WEEKS = 26;

// TODO: Refactor/integrate this code with the backend

/**
 * Manages the content of the deck and flashcard views, by determining their behavior.
 *
 * @method open - Opens the content manager, loading the review queue and initializing the deck and flashcard views.
 * @method close - Closes the content manager, shutting down the deck and flashcard views.
 */
export default class ContentManager {
    private app: App;
    private plugin: SRPlugin;
    private uiManager: UIManager;
    private dataManager: DataManager;
    private reviewSequencer: IFlashcardReviewSequencer | null = null;
    private settings: SRSettings;
    private reviewMode: FlashcardReviewMode;
    private deckContainer: DeckContainer;
    private cardContainer: CardContainer;

    private reviewQueueLoader: ReviewQueueLoader;
    private sessionData: SessionData | null = null;

    private lastPressedOnProcessReview: number = 0;
    private pendingResumeTimeout: number | null = null;
    // When the current review session started, to summarise it when it ends; 0 outside a session
    private sessionStartMs: number = 0;
    // The answers given in the current session, oldest first, for the progress bar
    private sessionAnswers: ReviewResponse[] = [];
    // After "Review mistakes", the mode to go back to once those cards are done; null otherwise
    private returnAfterCustomStudy: FlashcardReviewMode | null = null;
    private readonly closeModal: (() => void) | undefined;

    /** Called each time the screen is back on the deck list, when a layout switch that waited for the session can happen. */
    public onDeckList: (() => void) | null = null;

    // The desktop interface (sidebar, dashboard home, study side panel) in place of the phone layout; null on the phone
    private desktop: DesktopShell | null = null;
    private studyClock: number | null = null;
    // The review log by card, read once per session for the side panel; null until it is read
    private panelLog: Map<string, ReviewLogEntry[]> | null = null;
    private panelLogReading: Promise<void> | null = null;
    // What the desktop home reads from the review log and the cards, read once each time the home is shown
    private desktopData: Promise<DesktopData> | null = null;
    // An exam taken in the desktop shell, and the element it is drawn in; null when there is none
    private examRunner: ExamRunner | null = null;
    private examHost: HTMLElement | null = null;
    private isClosed = false;

    // Shared by every queue this screen loads, so the last answer of a deck can still be undone
    private undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>();
    // When the current card was shown, to record how long the answer took
    private cardShownAt: number = 0;
    public readonly cardActions: CardActions = this._createCardActions();

    constructor(
        app: App,
        plugin: SRPlugin,
        reviewQueueLoader: ReviewQueueLoader,
        settings: SRSettings,
        parentEl: HTMLElement,
        closeModal?: () => void,
        useDesktop: boolean = false,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.reviewQueueLoader = reviewQueueLoader;
        this.settings = settings;
        this.reviewMode = reviewQueueLoader.getReviewMode();
        this.closeModal = closeModal;

        this.uiManager = this.plugin.uiManager;
        this.dataManager = this.plugin.dataManager;

        // The desktop interface draws its own frame, and the decks and the cards go in its main area
        if (useDesktop) this.desktop = new DesktopShell(parentEl, this._desktopActions());
        const contentEl = this.desktop === null ? parentEl : this.desktop.mainEl;

        this.deckContainer = new DeckContainer(
            contentEl,
            (reviewMode) => void this._changeReviewMode(reviewMode),
            (deck) => void this._startReviewOfDeck(deck),
            closeModal,
            () => this._openCustomStudy(),
            {
                loadInsights: () => this._loadHomeInsights(),
                openExams: () => this._openExams(),
                openStatistics: () => {
                    this.closeModal?.();
                    void this.uiManager.openStatisticsView();
                },
                openSettings: () => this._openPluginSettings(),
                desktop: this.desktop === null ? undefined : this._desktopHomeServices(),
            },
        );

        this.cardContainer = new CardContainer(
            this.app,
            this.plugin,
            this.settings,
            contentEl,
            this._deleteCurrentCard.bind(this),
            this._showDecksList.bind(this),
            () => void this._doEditQuestionText(),
            this._processReview.bind(this),
            () => void this._skipCurrentCard(),
            () => void this._showAnswer(),
            this._jumpToCurrentCard.bind(this),
            this._showCardInfo.bind(this),
            this.cardActions,
            closeModal,
        );
    }

    /**
     * Whether a study session or an exam is in progress: from its first card until the screen is back on the deck list.
     * The screen is not rebuilt for another layout meanwhile, which would drop it.
     */
    public get inSession(): boolean {
        return this.sessionStartMs !== 0 || this.examRunner !== null;
    }

    /** Whether an exam can be taken in this screen: the desktop shell is open and no study session is going. */
    public get canRunExam(): boolean {
        return this.desktop !== null && !this.isClosed && !this.inSession;
    }

    public close() {
        this.isClosed = true;
        this._closeExam();
        this._clearPendingResumeTimeout();
        this.uiManager.setSRViewInFocus(false);
        this.deckContainer.closeList();
        this.cardContainer.closeSession();
        this._stopStudyClock();
        this.desktop?.destroy();
        this.uiManager.setUIState(UIState.Closed);
    }

    /**
     * @param stayOnDeckList - Do not go straight into the cards of a lone deck. Used when the screen is rebuilt for
     * another layout, which only happens from the deck list.
     */
    public async open(stayOnDeckList: boolean = false) {
        // Prepare a review queue to display
        this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);

        // Determine if the card view should be opened immediately
        const subdecksWithCardsInQueue: Deck[] = this.reviewSequencer.getSubDecksWithCardsInQueue(
            this.reviewSequencer.originalDeckTree,
        );

        let openImmediately: boolean = false;
        let deckWithCards: Deck | null = null;

        // Loop through all decks and determine if any have cards in queue
        for (const subdeck of subdecksWithCardsInQueue) {
            const subdeckStats = this.reviewSequencer.getDeckStats(subdeck.getTopicPath());

            if (
                openImmediately &&
                (subdeckStats.cardsInQueueOfThisDeckCount ||
                    this.reviewMode === FlashcardReviewMode.Cram)
            ) {
                openImmediately = false;
                break;
            }

            if (
                subdeckStats.cardsInQueueOfThisDeckCount ||
                this.reviewMode === FlashcardReviewMode.Cram
            ) {
                openImmediately = true;
                deckWithCards = subdeck;
            }
        }

        // The desktop opens on its dashboard, unless it was asked for one note or one custom session: then it is the
        // cards that were asked for
        const showDashboard =
            this.desktop !== null &&
            this.reviewQueueLoader.getSingleNote() === null &&
            this.reviewQueueLoader.getCustomStudy() === null;

        if (openImmediately && deckWithCards !== null && !showDashboard && !stayOnDeckList) {
            await this._reviewDeck(deckWithCards);
        } else {
            await this._showDecksList();
        }
    }

    // MARK: Content Manager

    private async _showDecksList(reloadReviewQueue: boolean = false): Promise<void> {
        this._clearPendingResumeTimeout();
        this.sessionStartMs = 0;
        if (reloadReviewQueue) {
            this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
        }
        if (this.reviewSequencer === null) return;
        this.cardContainer.closeSession();
        this.uiManager.setUIState(UIState.DeckList);
        this.desktopData = null;
        this.deckContainer.showList(
            this.reviewSequencer,
            this.settings,
            this.reviewMode,
            this.reviewQueueLoader.getCustomStudy() !== null,
        );
        this._showDesktopHome(this.reviewSequencer);
        this.onDeckList?.();
    }

    private async _reviewDeck(deck: Deck): Promise<void> {
        this.sessionStartMs = Date.now();
        this.sessionAnswers = [];
        this.cardContainer.setSessionAnswers(this.sessionAnswers);
        this.deckContainer.closeList();
        this.sessionData = this._getNewSessionData(deck);
        if (this.sessionData === null) return;
        this.uiManager.setUIState(UIState.CardFront);
        this._startDesktopStudy();
        await this.cardContainer.openSession(this.sessionData, this.settings);
        this.cardShownAt = activeWindow.performance.now();
        this._updateStudyPanel();
    }

    private async _showNextCard(): Promise<void> {
        if (this.sessionData === null || this.reviewSequencer === null) {
            await this._showDecksList(true);
            return;
        }

        // Rebuild the current iterator only at a card boundary, after a
        // short-term interval has elapsed.
        if (this.reviewSequencer.hasDuePendingCards) {
            this.reviewSequencer.refreshCurrentDeck();
        }

        // Like Anki's learn ahead limit: with nothing else left, a card due soon is shown now instead of waited for
        if (!this.reviewSequencer.hasCurrentCard && this.reviewSequencer.hasPendingCards) {
            this.reviewSequencer.learnAhead(this.settings.learnAheadMinutes * 60 * 1000);
        }

        if (!this.reviewSequencer.hasCurrentCard) {
            if (this.reviewSequencer.hasPendingCards) {
                await this._showPendingState();
            } else if (!(await this._showSessionSummary())) {
                if (this.returnAfterCustomStudy !== null) {
                    await this._changeReviewMode(this.returnAfterCustomStudy);
                } else {
                    await this._showDecksList(true);
                }
            }
            return;
        }

        if (this.reviewSequencer.currentDeck === null) {
            await this._showDecksList(true);
            return;
        }

        const chosenDeckStats = this.reviewSequencer.getDeckStats(
            this.sessionData.deckData.chosenDeck.getTopicPath(),
        );
        this.sessionData.deckData.chosenDeckStats = chosenDeckStats;

        this.sessionData.deckData.previousDeck = this.sessionData.deckData.currentDeck;
        this.sessionData.deckData.previousDeckStats = this.sessionData.deckData.currentDeckStats;

        this.sessionData.deckData.currentDeck = this.reviewSequencer.currentDeck;

        const currentDeckStats = this.reviewSequencer.getDeckStats(
            this.reviewSequencer.currentDeck.getTopicPath(),
        );
        this.sessionData.deckData.currentDeckStats = currentDeckStats;

        if (this.sessionData.deckData.previousDeck !== this.sessionData.deckData.currentDeck) {
            this.sessionData.deckData.currentDeckTotalCardsInQueue =
                currentDeckStats.cardsInQueueOfThisDeckCount;
        }

        this.sessionData.currentNote = this.reviewSequencer.currentNote;
        this.sessionData.currentQuestion = this.reviewSequencer.currentQuestion;

        this.sessionData.cardData.currentCard = this.reviewSequencer.currentCard;
        this.uiManager.setUIState(UIState.CardFront);
        this.sessionData.cardData.currentCardState = CardState.Front;

        if (
            this.sessionData.cardData.currentCard !== null &&
            this.sessionData.cardData.currentCard !== undefined
        ) {
            await this.cardContainer.drawCardFront(this.sessionData, this.settings);
            this.cardShownAt = activeWindow.performance.now();
            this._updateStudyPanel();
        } else {
            await this._showDecksList(true);
        }
    }

    /**
     * Shows how the session went, when the queue is done and something was answered in it.
     *
     * @returns Whether the summary is showing; false when there was nothing to summarise.
     */
    private async _showSessionSummary(): Promise<boolean> {
        if (this.reviewMode !== FlashcardReviewMode.Review || this.sessionStartMs === 0) {
            return false;
        }
        try {
            // Read back from the log rather than counting in memory, so undone answers and answers logged by
            // other devices are accounted for the same way as in the statistics
            const dayKeyOf = currentDayKeyFn();
            const entries = await this.dataManager.reviewLog.readAll();
            const summary = buildSessionSummary(
                entries,
                this.sessionStartMs,
                dayKeyOf(Date.now()),
                dayKeyOf,
            );
            if (summary.reviews === 0) return false;

            const sessionStartMs = this.sessionStartMs;
            this.cardContainer.showSessionSummary(summary, {
                onBackToDecks: () => void this._showDecksList(true),
                mistakes: forgottenCardIds(entries, sessionStartMs).size,
                onReviewMistakes: () =>
                    void this._startCustomStudy(
                        { type: "forgotten", days: 1, sinceMs: sessionStartMs },
                        true,
                    ),
                onUndo: () => void this._undoLastAnswer(),
                onOpenStatistics: () => {
                    this.closeModal?.();
                    void this.uiManager.openStatisticsView();
                },
            });
            this._stopStudyClock();
            this._updateStudyPanel();
            return true;
        } catch (error) {
            console.error("Flashcard Studio: could not build the session summary", error);
            return false;
        }
    }

    private async _showPendingState(): Promise<void> {
        if (this.reviewSequencer === null) return;
        this._clearPendingResumeTimeout();
        const nextPendingDueUnix = this.reviewSequencer.nextPendingDueUnix;
        if (nextPendingDueUnix === null) {
            await this._showDecksList(true);
            return;
        }

        this.uiManager.setUIState(UIState.CardFront);
        this.cardContainer.drawPendingState(nextPendingDueUnix);
        this._updateStudyPanel();

        const delayMs = Math.max(0, nextPendingDueUnix - Date.now());
        this.pendingResumeTimeout = window.setTimeout(() => {
            if (this.reviewSequencer === null) return;
            this.reviewSequencer.refreshCurrentDeck();
            void this._showNextCard();
        }, delayMs + 50);
    }

    private _getNewSessionData(deck: Deck): SessionData | null {
        if (this.reviewSequencer === null) return null;
        const chosenDeckStats = this.reviewSequencer.getDeckStats(deck.getTopicPath());
        const totalCardsInSession: number = chosenDeckStats.cardsInQueueCount;
        const totalDecksInSession: number = chosenDeckStats.decksInQueueOfThisDeckCount;
        const currentCardState: CardState = CardState.Front;

        const currentDeckStats =
            this.reviewSequencer.currentDeck === null
                ? null
                : this.reviewSequencer.getDeckStats(
                      this.reviewSequencer.currentDeck.getTopicPath(),
                  );

        return {
            cardData: {
                currentCard: this.reviewSequencer.currentCard,
                currentCardState,
            },
            deckData: {
                chosenDeck: deck,
                currentDeck: this.reviewSequencer.currentDeck,
                previousDeck: null,
                currentDeckTotalCardsInQueue:
                    currentDeckStats === null ? 0 : currentDeckStats.cardsInQueueOfThisDeckCount,
                currentDeckStats: currentDeckStats,
                previousDeckStats: null,
                chosenDeckStats: chosenDeckStats,
            },
            totalCardsInSession,
            totalDecksInSession,
            currentQuestion: this.reviewSequencer.currentQuestion,
            currentNote: this.reviewSequencer.currentNote,
        };
    }

    // MARK: Card button handlers

    public _deleteCurrentCard() {
        if (
            this.sessionData === null ||
            this.reviewSequencer === null ||
            this.dataManager.data === null
        )
            return;

        const timeNow = moment.now();
        if (
            this.lastPressedOnProcessReview &&
            timeNow - this.lastPressedOnProcessReview <
                this.dataManager.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressedOnProcessReview = timeNow;

        new ConfirmationModal(
            this.app,
            t("DELETE_CARD"),
            t("DELETE_CARD_CONFIRMATION"),
            t("CANCEL"),
            async () => {
                if (this.sessionData === null || this.reviewSequencer === null) return;
                await this.reviewSequencer.deleteCurrentCardFromNote();
                await this._showNextCard();
            },
        ).open();
    }

    public async _showAnswer() {
        if (this.sessionData === null) return;

        const timeNow = moment.now();
        if (
            this.lastPressedOnProcessReview &&
            timeNow - this.lastPressedOnProcessReview <
                this.dataManager.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressedOnProcessReview = timeNow;

        this.uiManager.setUIState(UIState.CardBack);
        this.sessionData.cardData.currentCardState = CardState.Back;

        await this.cardContainer.drawBack(
            this.sessionData,
            this.reviewMode,
            this.settings,
            this._determineButtonSchedule.bind(this),
        );
    }

    private async _doEditQuestionText(): Promise<void> {
        if (this.reviewSequencer === null) return;
        const currentCard: Card | null = this.reviewSequencer.currentCard;
        const currentQ: Question = this.reviewSequencer.currentQuestion;

        // Just the question/answer text; without any preceding topic tag
        const textPrompt = currentQ.questionText.actualQuestion;
        const currentUIState = this.uiManager.uiState;
        this.uiManager.setUIState(UIState.EditModal);
        // The occlusion editor keeps focus on its picture and its buttons, not in a text field, so the review shortcuts
        // (skip, undo, grade) would act on the card behind it for the keys typed in it: they stand down while it is
        // open, as they do for the card info window
        const editingOcclusion = currentQ.questionType === CardType.ImageOcclusion;
        const wasInFocus = this.uiManager.isSRInFocus;
        if (editingOcclusion) this.uiManager.setSRViewInFocus(false);
        // An image occlusion card is edited in the occlusion editor, not as text
        const editModal = editingOcclusion
            ? editOcclusionQuestion(this.app, currentQ)
            : FlashcardEditModal.Prompt(
                  this.app,
                  this.settings,
                  currentCard,
                  textPrompt,
                  currentQ.questionText.textDirection,
              );
        await editModal
            .then(async (modifiedCardText) => {
                if (this.reviewSequencer === null) return;
                // The text is of the question that the editor was opened on. If the review has moved on since, the
                // current question is another one, and writing it there would overwrite that question
                if (this.reviewSequencer.currentQuestion !== currentQ) {
                    new Notice(t("EDIT_CARD_MOVED_ON"));
                    return;
                }
                await this.reviewSequencer.updateCurrentQuestionTextAndCards(modifiedCardText);
                this.uiManager.setUIState(currentUIState);

                if (this.sessionData !== null) {
                    if (this.uiManager.uiState === UIState.CardFront) {
                        await this.cardContainer.drawCardFront(this.sessionData, this.settings);
                    }

                    if (this.uiManager.uiState === UIState.CardBack) {
                        await this.cardContainer.drawBack(
                            this.sessionData,
                            this.reviewMode,
                            this.settings,
                            this._determineButtonSchedule.bind(this),
                        );
                    }
                }
            })
            .catch((reason) => console.error(reason))
            .finally(() => {
                // Closed, whether saved, cancelled or refused
                if (editingOcclusion) this.uiManager.setSRViewInFocus(wasInFocus);
                if (this.uiManager.uiState === UIState.EditModal) {
                    this.uiManager.setUIState(currentUIState);
                }
            });
    }

    public async _jumpToCurrentCard(): Promise<void> {
        if (this.reviewSequencer === null) return;
        const currentQuestion = this.reviewSequencer.currentQuestion;
        if (!currentQuestion) return;

        const isMobile = Platform.isMobile || EmulatedPlatform().isMobile;
        if (
            (!this.settings.openViewInNewTab &&
                !desktopTabWanted(this.settings, isMobile) &&
                !isMobile) ||
            (!this.settings.openViewInNewTabMobile && isMobile)
        ) {
            new Notice("Note was opened in new tab in the background");
        }

        const file = currentQuestion.note.file.tfile;
        const blockId = currentQuestion.questionText.obsidianBlockId;
        const line = Math.max(0, currentQuestion.lineNo ?? 0);

        if (blockId) {
            await this.app.workspace.openLinkText(`${file.path}#${blockId}`, file.path, false);
            return;
        }

        // If the file is already open in another leaf, open it in the current one to prevent duplicates
        const existingLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
            const view = leaf.view as MarkdownView;
            return view.file?.path === file.path;
        });

        if (existingLeaf) {
            await existingLeaf.openFile(file, { eState: { line } });
            this.app.workspace.setActiveLeaf(existingLeaf);
            const markdownView = existingLeaf.view as MarkdownView;
            if (markdownView?.editor) {
                markdownView.editor.setCursor({ line, ch: 0 });
                markdownView.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } });
            }
            return;
        }

        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { eState: { line } });

        const markdownView = leaf.view as MarkdownView;
        if (markdownView?.editor) {
            markdownView.editor.setCursor({ line, ch: 0 });
            markdownView.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } });
        }
    }

    public async _skipCurrentCard() {
        if (this.reviewSequencer === null) return;
        this.reviewSequencer.skipCurrentCard();
        await this._showNextCard();
    }

    /**
     * Opens the info of the card being reviewed: its state and its whole review history.
     */
    public _showCardInfo(): void {
        if (this.sessionData === null || this.sessionData.cardData.currentCard === null) return;

        // Keep the review shortcuts from reacting to keys typed in the info window
        const wasInFocus = this.uiManager.isSRInFocus;
        this.uiManager.setSRViewInFocus(false);
        new CardInfoModal(
            this.app,
            this.plugin,
            this.sessionData.cardData.currentCard,
            this.sessionData.currentNote.file.path,
            () => this.uiManager.setSRViewInFocus(wasInFocus),
        ).open();
    }

    public async _processReview(response: ReviewResponse): Promise<void> {
        if (this.reviewSequencer === null) return;
        const timeNow = moment.now();
        if (
            timeNow - this.lastPressedOnProcessReview <
            this.dataManager.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressedOnProcessReview = timeNow;

        const durationMs: number = activeWindow.performance.now() - this.cardShownAt;
        await this.reviewSequencer.processReview(response, durationMs);
        if (response !== ReviewResponse.Reset) {
            this.sessionAnswers.push(response);
            this.cardContainer.setSessionAnswers(this.sessionAnswers);
        }
        const entry = this.reviewSequencer.lastLoggedEntry;
        if (entry !== null) this._noteAnswerLogged(entry);
        await this._showNextCard();
        // The session summary has its own undo button; the toast would sit on top of its buttons
        if (
            entry !== null &&
            this.reviewMode === FlashcardReviewMode.Review &&
            !this.cardContainer.isShowingSessionSummary
        ) {
            this.cardContainer.showAnswerToast(entry);
        }
    }

    // MARK: Studio home

    /**
     * Today's count, the streak and 30-day retention for the home screen, from every device's review log.
     */
    private async _loadHomeInsights(): Promise<HomeInsights> {
        try {
            // The desktop home has read the history already, for its own tables
            const entries =
                this.desktop === null
                    ? await this.dataManager.reviewLog.readAll()
                    : (await this._desktopStats()).entries;
            const dayKeyOf = currentDayKeyFn();
            const todayKey = dayKeyOf(Date.now());
            const last30 = trueRetention(entries, todayKey, dayKeyOf).find(
                (row) => row.id === "last30",
            );
            // The weakest deck under the retention target, if any
            const target = this.settings.fsrsDesiredRetention;
            const weakest = weakAreas(entries, [], todayKey, dayKeyOf, Date.now()).decks[0];
            return {
                studiedToday: todaySummary(entries, todayKey, dayKeyOf).reviews,
                streak: streaks(entries, todayKey, dayKeyOf).current,
                retention: last30?.all.rate ?? null,
                focus:
                    weakest !== undefined && retentionBelowTarget(weakest.retention, target)
                        ? { deck: weakest.deck, retention: weakest.retention, target }
                        : null,
            };
        } catch (error) {
            console.error(
                "Flashcard Studio: could not read the review history for the home screen",
                error,
            );
            return { studiedToday: 0, streak: 0, retention: null, focus: null };
        }
    }

    /**
     * Opens Obsidian's settings on this plugin's tab. The settings dialog is not part of Obsidian's public API.
     */
    private _openPluginSettings(): void {
        const setting = (
            this.app as unknown as {
                setting?: { open: () => void; openTabById: (id: string) => void };
            }
        ).setting;
        if (!setting) return;
        this.closeModal?.();
        setting.open();
        setting.openTabById(this.plugin.manifest.id);
    }

    // MARK: Card actions (undo, bury, suspend, flag)

    private _createCardActions(): CardActions {
        return {
            undo: () => this._undoLastAnswer(),
            canUndo: () => this.reviewSequencer?.canUndo ?? false,
            suspend: () => this._changeCurrentCard((sequencer) => sequencer.suspendCurrentCard()),
            bury: () => this._changeCurrentCard((sequencer) => sequencer.buryCurrentCard()),
            setFlag: async (flag: number) => {
                if (this.reviewSequencer === null || !this.reviewSequencer.hasCurrentCard) return;
                await this.reviewSequencer.setFlagCurrentCard(flag);
                this.cardContainer.showFlag(flag);
            },
            currentFlag: () => this.reviewSequencer?.currentCard?.meta.flag ?? 0,
        };
    }

    private async _changeCurrentCard(
        change: (sequencer: IFlashcardReviewSequencer) => Promise<void>,
    ): Promise<void> {
        if (this.reviewSequencer === null || !this.reviewSequencer.hasCurrentCard) return;
        await change(this.reviewSequencer);
        await this._showNextCard();
    }

    public async _undoLastAnswer(): Promise<void> {
        if (this.reviewSequencer === null) return;
        this.cardContainer.hideAnswerToast();
        const result: UndoResult = await this.reviewSequencer.undoLastAnswer();
        // The undone answer is no longer in the log, so the side panel reads it again
        this.panelLog = null;

        switch (result) {
            case UndoResult.Nothing:
                new Notice(t("NOTHING_TO_UNDO"));
                return;
            case UndoResult.Failed:
                return;
            case UndoResult.NeedsReload:
                // The answer came from a session that has since ended; start a fresh one on the same deck
                this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue(
                    this.undoHistory,
                );
                if (this.sessionData !== null) {
                    await this._startReviewOfDeck(this.sessionData.deckData.chosenDeck);
                } else {
                    await this._showDecksList();
                }
                return;
            case UndoResult.Requeued:
                this.sessionAnswers.pop();
                this.cardContainer.setSessionAnswers(this.sessionAnswers);
                this._clearPendingResumeTimeout();
                await this._showNextCard();
                if (this.sessionData !== null) {
                    this.deckContainer.closeList();
                    await this.cardContainer.openSession(this.sessionData, this.settings);
                }
                return;
        }
    }

    // MARK: Deck button handlers

    private async _startReviewOfDeck(deck: Deck) {
        if (this.reviewSequencer === null) return;
        this.reviewSequencer.setCurrentDeck(deck.getTopicPath());
        if (this.reviewSequencer.hasCurrentCard) {
            await this._reviewDeck(deck);
        } else {
            await this._showDecksList();
        }
    }

    private async _changeReviewMode(reviewMode: FlashcardReviewMode) {
        // Picking a mode goes back to the normal decks
        this.returnAfterCustomStudy = null;
        this.reviewQueueLoader.setCustomStudy(null);
        this.reviewQueueLoader.setReviewMode(reviewMode);
        this.reviewMode = reviewMode;
        this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
        this.deckContainer.closeList();
        await this._showDecksList();
    }

    // MARK: Custom study

    private _openCustomStudy(): void {
        new CustomStudyModal(this.app, this.plugin, {
            onLimitsChanged: () => void this._showDecksList(true),
            onStartSession: (spec) => void this._startCustomStudy(spec),
        }).open();
    }

    /**
     * Serves a custom study session in this review screen, in place of the normal decks. When no card matches, the
     * normal decks stay.
     *
     * @param startNow - Go straight to the cards, and back to the normal decks once they are done ("Review
     * mistakes"), instead of showing the decks of the session.
     * @param beforeShow - Called once the session is known to have cards, just before it is drawn: whatever it replaces
     * (the results of an exam) stays on screen until then.
     * @returns Whether a session started.
     */
    private async _startCustomStudy(
        spec: CustomStudySpec,
        startNow: boolean = false,
        beforeShow?: () => void,
    ): Promise<boolean> {
        const previousSpec = this.reviewQueueLoader.getCustomStudy();
        const previousMode = this.reviewMode;

        this.reviewQueueLoader.setCustomStudy(spec);
        this.reviewMode = customStudyMode(spec);
        this.reviewQueueLoader.setReviewMode(this.reviewMode);
        const sequencer = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);

        const found = sequencer.originalDeckTree.getDistinctRepItemCount(
            RepItemState.AnyItem,
            true,
        );
        if (found === 0) {
            new Notice(spec.type === "cards" ? t("EXAM_MISSED_NONE") : t("CUSTOM_STUDY_NO_CARDS"));
            this.reviewQueueLoader.setCustomStudy(previousSpec);
            this.reviewMode = previousMode;
            this.reviewQueueLoader.setReviewMode(previousMode);
            return false;
        }
        // Cards that were edited or deleted since the exam cannot be found: say so, rather than quietly study fewer
        if (spec.type === "cards" && found < spec.ids.length) {
            new Notice(cardsChangedText(spec.ids.length - found));
        }

        beforeShow?.();
        this.reviewSequencer = sequencer;
        this.deckContainer.closeList();
        if (startNow) {
            this.returnAfterCustomStudy = previousMode;
            this.cardContainer.closeSession();
            await this._startReviewOfDeck(sequencer.originalDeckTree);
            return true;
        }
        this.returnAfterCustomStudy = null;
        await this._showDecksList();
        return true;
    }

    // MARK: Desktop

    /**
     * What the navigation of the desktop shell does.
     */
    private _desktopActions(): DesktopShellActions {
        return {
            // What replaces the main area first asks about an exam that is going, whose answers would be lost
            openHome: () => this._afterExam(() => void this._showDecksList()),
            startReviewOfDeck: (deck) => this._afterExam(() => void this._startReviewOfDeck(deck)),
            openExams: () => this._openExams(),
            // The card browser is still to come; until then this opens the custom study filter
            openBrowse: () => this._afterExam(() => this._openCustomStudy()),
            openStatistics: () => void this.uiManager.openStatisticsView(),
            openAiGenerator: () => this._openAiGenerator(),
            openSettings: () => this._openPluginSettings(),
        };
    }

    // MARK: Exams

    /** The exam setup; Start takes the exam here, in the main area on the desktop, in a tab on the phone. */
    private _openExams(): void {
        // A click on Exams during an exam stays on the exam
        if (this.examRunner?.isRunning === true) return;
        void this.uiManager.openExamSetup((start) => {
            if (this.desktop !== null) {
                this.runExam(start);
                return;
            }
            this.closeModal?.();
            void this.uiManager.startExam(start);
        });
    }

    /**
     * Takes an exam in the main area of the desktop shell, in place of the home or the session. The sidebar shrinks
     * to its rail, as while studying.
     */
    public runExam(start: ExamStart): void {
        const desktop = this.desktop;
        // The Studio may have been closed while the setup was open: there is nowhere to draw the exam then
        if (desktop === null || this.isClosed) return;
        this._closeExam();
        this._clearPendingResumeTimeout();
        this.sessionStartMs = 0;
        this.deckContainer.closeList();
        this.cardContainer.closeSession();
        this._stopStudyClock();
        desktop.setClock(null);
        desktop.setSection("exams");
        desktop.setRail(true);

        const host = desktop.mainEl.createDiv({ cls: "fs-exam-host" });
        this.examHost = host;
        this.examRunner = new ExamRunner(host, {
            plugin: this.plugin,
            setup: start.setup,
            questions: start.questions,
            ignoreAccents: this.settings.ignoreAccentsWhenTyping,
            save: (result) => saveExamResult(this.app, result),
            resume: start.resume,
            ...persistenceFor(this.plugin),
            // The results stay on screen until the session has cards to show
            onStudyMissed: (ids) => {
                void this._startCustomStudy({ type: "cards", ids }, true, () => this._closeExam());
            },
            onClose: () => {
                this._closeExam();
                void this._showDecksList();
            },
        });
        this.examRunner.start();
    }

    private _closeExam(): void {
        this.examRunner?.destroy();
        this.examRunner = null;
        this.examHost?.remove();
        this.examHost = null;
        this.desktop?.setRail(false);
    }

    /** Runs `action` once the exam that is going has been left (after asking), or at once when there is none. */
    private _afterExam(action: () => void): void {
        const runner = this.examRunner;
        if (runner === null) {
            action();
            return;
        }
        runner.requestLeave(() => {
            this._closeExam();
            action();
        });
    }

    /** "Create with AI": choose a note, then the same dialog as the command in a note. */
    private _openAiGenerator(): void {
        new NotePickerModal(this.app, (file) => {
            void this.app.vault
                .cachedRead(file)
                .then((text) => openGenerateCards(this.plugin, file, text, false));
        }).open();
    }

    /**
     * What the desktop home reads beyond the Studio home: the forecast, the activity, and the retention of each deck.
     */
    private _desktopHomeServices(): DesktopHomeServices {
        return {
            forecast: async () => {
                const data = await this._desktopStats();
                return forecastForHome(
                    forecast(data.cards, {
                        todayKey: data.todayKey,
                        dayKeyOf: data.dayKeyOf,
                        days: FORECAST_DAYS,
                    }),
                );
            },
            heatmap: async () => {
                const data = await this._desktopStats();
                return heatmap(data.entries, {
                    todayKey: data.todayKey,
                    dayKeyOf: data.dayKeyOf,
                    weeks: ACTIVITY_WEEKS,
                    weekStart: data.weekStart,
                });
            },
            deckDetails: async (paths) => {
                const data = await this._desktopStats();
                const now = Date.now();
                const details = new Map<string, DeckDetail>();
                for (const path of paths) {
                    const last30 = trueRetention(
                        filterEntriesByDeck(data.entries, path),
                        data.todayKey,
                        data.dayKeyOf,
                    ).find((row) => row.id === "last30");
                    const judged =
                        last30 !== undefined && last30.all.total >= WEAK_AREA_MIN_REVIEWS;
                    details.set(path, {
                        retention: judged ? last30.all.rate : null,
                        learning: learningCount(data.cards, path, now),
                    });
                }
                return details;
            },
            openExams: () => this._openExams(),
            lastExam: async () => {
                const [last] = await readExamResults(this.app, 1);
                return last === undefined ? null : examSummary(last);
            },
            modeLabel: () => {
                if (this.reviewQueueLoader.getCustomStudy() !== null) return t("CUSTOM_STUDY");
                return this.reviewMode === FlashcardReviewMode.Cram ? t("CRAM_MODE") : null;
            },
            resetMode: () => void this._changeReviewMode(FlashcardReviewMode.Review),
        };
    }

    private _desktopStats(): Promise<DesktopData> {
        if (this.desktopData === null) this.desktopData = this._readDesktopStats();
        return this.desktopData;
    }

    private async _readDesktopStats(): Promise<DesktopData> {
        const dayKeyOf = currentDayKeyFn();
        const todayKey = dayKeyOf(Date.now());
        const weekStart = moment.localeData().firstDayOfWeek();
        try {
            const entries = await this.dataManager.reviewLog.readAll();
            const cards =
                this.reviewSequencer === null
                    ? []
                    : collectStatsCards(this.reviewSequencer.originalDeckTree, todayKey).cards;
            return { entries, cards, todayKey, dayKeyOf, weekStart };
        } catch (error) {
            console.error(
                "Flashcard Studio: could not read the history for the home screen",
                error,
            );
            return { entries: [], cards: [], todayKey, dayKeyOf, weekStart };
        }
    }

    /** The sidebar's deck tree and count follow the home; the frame shows the home section. */
    private _showDesktopHome(sequencer: IFlashcardReviewSequencer): void {
        if (this.desktop === null) return;
        this._stopStudyClock();
        this.desktop.setClock(null);
        this.desktop.setSection("home");
        const root = sequencer.originalDeckTree;
        this.desktop.renderDeckTree(root, (path) => sequencer.getDeckStats(path));
        const stats = sequencer.getDeckStats(root.getTopicPath());
        this.desktop.setDueCount(stats.dueCount + stats.newCount);
    }

    /** Studying: the sidebar becomes a rail, the side panel shows, and the session clock starts. */
    private _startDesktopStudy(): void {
        if (this.desktop === null) return;
        this.desktop.setSection("study");
        this._stopStudyClock();
        this.panelLog = null;
        const tick = () => {
            const elapsed = Date.now() - this.sessionStartMs;
            this.desktop?.setClock(elapsed);
            if (this.desktop !== null) updateStudyPanelTime(this.desktop.asideEl, elapsed);
        };
        tick();
        this.studyClock = window.setInterval(tick, 1000);
    }

    private _stopStudyClock(): void {
        if (this.studyClock === null) return;
        window.clearInterval(this.studyClock);
        this.studyClock = null;
    }

    /**
     * Draws the side panel for the card on screen: what is known about the card, and how the session is going. The
     * card's history follows a moment later, once the review log has been read.
     */
    private _updateStudyPanel(): void {
        const desktop = this.desktop;
        const sequencer = this.reviewSequencer;
        if (desktop === null || sequencer === null || this.sessionData === null) return;

        const card = sequencer.hasCurrentCard ? this.sessionData.cardData.currentCard : null;
        const draw = () => {
            if (this.sessionData === null) return;
            const left = sequencer.hasCurrentCard
                ? Math.max(0, this.sessionData.deckData.chosenDeckStats.cardsInQueueCount - 1)
                : 0;
            renderStudySidePanel(desktop.asideEl, {
                card: card === null ? null : this._cardInfoData(card),
                session: {
                    ...summarizeSessionAnswers(this.sessionAnswers),
                    elapsedMs: Date.now() - this.sessionStartMs,
                    left,
                },
                keys: card === null ? [] : this._studyKeys(),
            });
        };
        draw();

        if (card !== null && this.panelLog === null) {
            // Cards shown while the log is being read wait for that one read
            this.panelLogReading ??= this._readPanelLog().finally(() => {
                this.panelLogReading = null;
            });
            void this.panelLogReading.then(() => {
                // Only if the same card is still on screen
                if (this.sessionData?.cardData.currentCard === card) draw();
            });
        }
    }

    private _cardInfoData(card: Card): CardInfoData {
        const now = Date.now();
        const decks = card.question.topicPathList.list.map((path) => path.path.join("/"));
        const stats = toStatsCard(card, decks, currentDayKeyFn()(now));
        const entries = stats.id === null ? [] : (this.panelLog?.get(stats.id) ?? []);
        return buildCardInfoData(stats, entries, now);
    }

    /** Reads the review log once, grouped by card, so showing each card does not read every log file again. */
    private async _readPanelLog(): Promise<void> {
        const log = new Map<string, ReviewLogEntry[]>();
        try {
            for (const entry of await this.dataManager.reviewLog.readAll()) {
                const list = log.get(entry.c);
                if (list === undefined) log.set(entry.c, [entry]);
                else list.push(entry);
            }
        } catch (error) {
            console.error("Flashcard Studio: could not read the review history", error);
        }
        this.panelLog = log;
    }

    /** Keeps the side panel's copy of the log in step with the answers of this session. */
    private _noteAnswerLogged(entry: ReviewLogEntry): void {
        if (this.panelLog === null || entry.c === "") return;
        const list = this.panelLog.get(entry.c);
        if (list === undefined) this.panelLog.set(entry.c, [entry]);
        else list.push(entry);
    }

    /** The shortcuts the side panel lists. None with custom hotkeys, which replace them. */
    private _studyKeys(): [string, string][] {
        if (this.settings.useCustomHotkeys) return [];
        return [
            [this.settings.answerKeys === "anki" ? "1–4" : "1–3", t("DESKTOP_KEY_RATE")],
            ["Space", t("DESKTOP_KEY_SPACE")],
            ["U", t("UNDO_LAST_ANSWER")],
            ["-", t("BURY_CARD")],
            ["@", t("SUSPEND_CARD")],
            ["S", t("SKIP")],
            ["J", t("DESKTOP_KEY_JUMP")],
        ];
    }

    // MARK: Utils

    private _determineButtonSchedule(reviewResponse: ReviewResponse): RepItemScheduleInfo | null {
        if (this.sessionData === null) return null;
        if (this.reviewSequencer === null) return null;
        return this.reviewSequencer.determineCardSchedule(
            reviewResponse,
            this.sessionData.cardData.currentCard,
        );
    }

    private _clearPendingResumeTimeout(): void {
        if (this.pendingResumeTimeout !== null) {
            window.clearTimeout(this.pendingResumeTimeout);
            this.pendingResumeTimeout = null;
        }
    }
}
