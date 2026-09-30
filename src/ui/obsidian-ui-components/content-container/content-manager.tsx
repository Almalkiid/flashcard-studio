import { App, MarkdownView, Notice, Platform } from "obsidian";

import { DataManager } from "src/data/data-manager";
import { Card } from "src/data/data-structures/card/card";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { SRSettings } from "src/data/settings";
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
import { streaks, todaySummary } from "src/stats/activity";
import { trueRetention } from "src/stats/answers";
import { buildSessionSummary } from "src/stats/session";
import { weakAreas } from "src/stats/weak-areas";
import { CardActions } from "src/ui/card-actions";
import { CardContainer } from "src/ui/obsidian-ui-components/content-container/card-container/card-container";
import { DeckContainer } from "src/ui/obsidian-ui-components/content-container/deck-container/deck-container";
import { HomeInsights } from "src/ui/obsidian-ui-components/content-container/deck-container/studio-home";
import { CardInfoModal } from "src/ui/obsidian-ui-components/modals/card-info-modal";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { FlashcardEditModal } from "src/ui/obsidian-ui-components/modals/edit-modal";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import { currentDayKeyFn } from "src/ui/statistics-view/stats-data";
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
    ) {
        this.app = app;
        this.plugin = plugin;
        this.reviewQueueLoader = reviewQueueLoader;
        this.settings = settings;
        this.reviewMode = reviewQueueLoader.getReviewMode();
        this.closeModal = closeModal;

        this.uiManager = this.plugin.uiManager;
        this.dataManager = this.plugin.dataManager;

        this.deckContainer = new DeckContainer(
            parentEl,
            (reviewMode) => void this._changeReviewMode(reviewMode),
            (deck) => void this._startReviewOfDeck(deck),
            closeModal,
            () => this._openCustomStudy(),
            {
                loadInsights: () => this._loadHomeInsights(),
                openStatistics: () => {
                    this.closeModal?.();
                    void this.uiManager.openStatisticsView();
                },
                openSettings: () => this._openPluginSettings(),
            },
        );

        this.cardContainer = new CardContainer(
            this.app,
            this.plugin,
            this.settings,
            parentEl,
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

    public close() {
        this._clearPendingResumeTimeout();
        this.uiManager.setSRViewInFocus(false);
        this.deckContainer.closeList();
        this.cardContainer.closeSession();
        this.uiManager.setUIState(UIState.Closed);
    }

    public async open() {
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

        if (openImmediately && deckWithCards !== null) {
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
        this.deckContainer.showList(
            this.reviewSequencer,
            this.settings,
            this.reviewMode,
            this.reviewQueueLoader.getCustomStudy() !== null,
        );
    }

    private async _reviewDeck(deck: Deck): Promise<void> {
        this.sessionStartMs = Date.now();
        this.sessionAnswers = [];
        this.cardContainer.setSessionAnswers(this.sessionAnswers);
        this.deckContainer.closeList();
        this.sessionData = this._getNewSessionData(deck);
        if (this.sessionData === null) return;
        this.uiManager.setUIState(UIState.CardFront);
        await this.cardContainer.openSession(this.sessionData, this.settings);
        this.cardShownAt = activeWindow.performance.now();
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
        // An image occlusion card is edited in the occlusion editor, not as text
        const editModal =
            currentQ.questionType === CardType.ImageOcclusion
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
            .catch((reason) => console.error(reason));
    }

    public async _jumpToCurrentCard(): Promise<void> {
        if (this.reviewSequencer === null) return;
        const currentQuestion = this.reviewSequencer.currentQuestion;
        if (!currentQuestion) return;

        if (
            (!this.settings.openViewInNewTab &&
                !(Platform.isMobile || EmulatedPlatform().isMobile)) ||
            (!this.settings.openViewInNewTabMobile &&
                (Platform.isMobile || EmulatedPlatform().isMobile))
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
            const entries = await this.dataManager.reviewLog.readAll();
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
                    weakest !== undefined && weakest.retention < target
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
     */
    private async _startCustomStudy(
        spec: CustomStudySpec,
        startNow: boolean = false,
    ): Promise<void> {
        const previousSpec = this.reviewQueueLoader.getCustomStudy();
        const previousMode = this.reviewMode;

        this.reviewQueueLoader.setCustomStudy(spec);
        this.reviewMode = customStudyMode(spec);
        this.reviewQueueLoader.setReviewMode(this.reviewMode);
        const sequencer = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);

        if (sequencer.originalDeckTree.getDistinctRepItemCount(RepItemState.AnyItem, true) === 0) {
            new Notice(t("CUSTOM_STUDY_NO_CARDS"));
            this.reviewQueueLoader.setCustomStudy(previousSpec);
            this.reviewMode = previousMode;
            this.reviewQueueLoader.setReviewMode(previousMode);
            return;
        }

        this.reviewSequencer = sequencer;
        this.deckContainer.closeList();
        if (startNow) {
            this.returnAfterCustomStudy = previousMode;
            this.cardContainer.closeSession();
            await this._startReviewOfDeck(sequencer.originalDeckTree);
            return;
        }
        this.returnAfterCustomStudy = null;
        await this._showDecksList();
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
