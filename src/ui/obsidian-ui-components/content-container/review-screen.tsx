import { App, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";

import { NotePickerModal } from "src/ai/note-picker-modal";
import { openGenerateCards } from "src/ai/open-generate-cards";
import { Card } from "src/data/data-structures/card/flashcard";
import { CardType } from "src/data/data-structures/card/question";
import { Deck } from "src/data/decks/deck";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { StudioSettings } from "src/data/settings-model";
import { ExamStart, examSummary } from "src/exam/exam";
import { persistenceFor } from "src/exam/exam-draft-store";
import { cardsChangedText } from "src/exam/exam-render";
import { isInExamsFolder } from "src/exam/exam-results-file";
import { ExamRunner } from "src/exam/exam-run";
import { readExamResults, saveExamResult } from "src/exam/exam-store";
import { t } from "src/lang/translate";
import { editOcclusionQuestion } from "src/occlusion/occlusion-processors";
import { customStudyMode, CustomStudySpec, forgottenCardIds } from "src/scheduling/custom-study";
import {
    FlashcardReviewMode,
    IReviewSession,
    removalConfirmation,
    UndoRecord,
} from "src/scheduling/review/review-session";
import { ReviewItemState, ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { UndoHistory, UndoResult } from "src/scheduling/undo-history";
import { heatmap, streaks, todaySummary } from "src/stats/activity";
import { trueRetention } from "src/stats/answers";
import { forecast } from "src/stats/cards";
import { DayKeyFn } from "src/stats/day-keys";
import { filterEntriesByDeck } from "src/stats/scope";
import { buildSessionSummary } from "src/stats/session";
import { StatsCard } from "src/stats/types";
import { WEAK_AREA_MIN_REVIEWS, weakAreas } from "src/stats/weak-areas";
import FlashcardStudioPlugin from "src/studio-plugin";
import { CardActions } from "src/ui/card-actions";
import CardContainer from "src/ui/obsidian-ui-components/content-container/card-container/card-screen";
import DeckContainer from "src/ui/obsidian-ui-components/content-container/deck-container/deck-screen";
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
    DesktopShell,
    DesktopShellActions,
    desktopTabWanted,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import {
    renderStudySidePanel,
    updateStudyPanelTime,
} from "src/ui/obsidian-ui-components/content-container/desktop/study-side-panel";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/session-data";
import {
    EditCancelled,
    FlashcardEditModal,
} from "src/ui/obsidian-ui-components/modals/card-edit-modal";
import { CardInfoModal } from "src/ui/obsidian-ui-components/modals/card-info-modal";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { ReviewQueueLoader } from "src/ui/session-queue";
import { Latch } from "src/ui/single-flight";
import { speechAvailable } from "src/ui/speech";
import { collectStatsCards, currentDayKeyFn, toStatsCard } from "src/ui/statistics-view/stats-data";
import { UIManager, UIState } from "src/ui/studio-ui";
import { moment } from "src/utils/moment-en";

export { CardState };
export type {
    CardData,
    DeckData,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/session-data";

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

const topicKey = (deck: Deck): string => deck.getTopicPath().path.join("/");

/**
 * The review screen's controller: loads the cards to review, shows the deck list or the card in the right container,
 * and carries out what the person does (reveal, answer, skip, edit, undo). It owns no pixels itself.
 */
export default class ContentManager {
    private readonly ui: UIManager;
    private readonly dataManager: FlashcardStudioPlugin["dataManager"];
    private readonly deckPane: DeckContainer;
    private readonly cardPane: CardContainer;

    private reviewMode: FlashcardReviewMode;
    private queueSeq: IReviewSession | null = null;
    // What the card screen draws; null between sessions
    private sessionState: SessionData | null = null;
    // When the current review session started, to summarise it when it ends; 0 outside a session
    private sessionStartMs: number = 0;
    // The answers given in the current session, oldest first, for the progress bar
    private sessionAnswers: ReviewResponse[] = [];
    // After "Review mistakes", the mode to go back to once those cards are done; null otherwise
    private returnAfterCustomStudy: FlashcardReviewMode | null = null;
    // The last time a button was accepted, so that buttons can be told to ignore a second press
    private lastButtonTime: number = 0;
    // The timer that brings back a card waiting for its step
    private resumeTimer: number | null = null;
    // The waiting screen is up: there is no card to reveal, answer, edit or skip
    private waiting = false;
    // Held while an action that moves the screen to another card runs; a second press meanwhile would act on that card
    private readonly busy = new Latch();

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
        private readonly app: App,
        private readonly plugin: FlashcardStudioPlugin,
        private readonly reviewQueueLoader: ReviewQueueLoader,
        private readonly settings: StudioSettings,
        parentEl: HTMLElement,
        private readonly closeModal?: () => void,
        useDesktop = false,
    ) {
        this.reviewMode = reviewQueueLoader.getReviewMode();
        this.ui = plugin.uiManager;
        this.dataManager = plugin.dataManager;

        // The desktop interface draws its own frame, and the decks and the cards go in its main area
        if (useDesktop) this.desktop = new DesktopShell(parentEl, this._desktopActions());
        const contentEl = this.desktop === null ? parentEl : this.desktop.mainEl;

        this.deckPane = new DeckContainer(
            contentEl,
            (reviewMode) => void this._switchMode(reviewMode),
            (deck) => void this._beginDeck(deck),
            closeModal,
            () => this._openCustomStudy(),
            {
                loadInsights: () => this._loadHomeInsights(),
                openExams: () => this._openExams(),
                openStatistics: () => {
                    this.closeModal?.();
                    void this.ui.openStatisticsView();
                },
                openSettings: () => this._openPluginSettings(),
                desktop: this.desktop === null ? undefined : this._desktopHomeServices(),
            },
        );
        this.cardPane = new CardContainer(
            app,
            plugin,
            settings,
            contentEl,
            () => this._deleteCurrentCard(),
            async () => this._gotoDeckList(),
            () => void this._editQuestion(),
            (response) => this._processReview(response),
            () => void this._skipCurrentCard(),
            () => void this._showAnswer(),
            () => this._jumpToCurrentCard(),
            () => this._showCardInfo(),
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

    public close(): void {
        // On a phone a closing window slides away first and is told that it closed afterwards, so a review that was
        // opened again at once may already be the current one. The state of the plugin's UI is then that review's.
        const isCurrent = this.ui.contentManager === this;
        this.isClosed = true;
        this._closeExam();
        this._cancelResume();
        if (isCurrent) this.ui.setStudioViewInFocus(false);
        this.deckPane.closeList();
        this.cardPane.closeSession();
        this._stopStudyClock();
        this.desktop?.destroy();
        if (isCurrent) this.ui.setUIState(UIState.Closed);
    }

    // #region -> Showing the screens

    /**
     * Loads the cards and shows the deck list, or goes straight into the cards when there is only one deck to review.
     *
     * @param stayOnDeckList - Do not go straight into the cards of a lone deck. Used when the screen is rebuilt for
     * another layout, which only happens from the deck list.
     */
    public async open(stayOnDeckList: boolean = false): Promise<void> {
        this.queueSeq = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
        // A review closed while its cards were loading has nowhere to be drawn
        if (this.isClosed) return;

        // The cards open at once when exactly one deck has cards of its own to review (in Cram mode, when exactly one
        // deck is listed)
        const reviewSession = this.queueSeq;
        let deckWithCards: Deck | null = null;
        let openImmediately = false;
        for (const deck of reviewSession.getSubDecksWithCardsInQueue(reviewSession.originalRoot)) {
            const hasCards =
                this.reviewMode === FlashcardReviewMode.Cram ||
                reviewSession.getDeckStats(deck.getTopicPath()).cardsInQueueOfThisDeckCount > 0;
            if (!hasCards) continue;
            if (deckWithCards !== null) {
                openImmediately = false;
                break;
            }
            deckWithCards = deck;
            openImmediately = true;
        }

        // The desktop opens on its dashboard, unless it was asked for one note or one custom session: then it is the
        // cards that were asked for
        const showDashboard =
            this.desktop !== null &&
            this.reviewQueueLoader.getSingleNote() === null &&
            this.reviewQueueLoader.getCustomStudy() === null;

        const deckListWanted = stayOnDeckList || this.reviewQueueLoader.opensOnDeckList();
        if (openImmediately && deckWithCards !== null && !showDashboard && !deckListWanted) {
            await this._enterDeck(deckWithCards);
        } else {
            await this._gotoDeckList();
        }
    }

    private async _gotoDeckList(reload = false): Promise<void> {
        this._cancelResume();
        this.waiting = false;
        this.sessionStartMs = 0;
        if (reload) {
            // What the queue holds must be the same as what is on disk
            this.queueSeq = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
        }
        if (this.queueSeq === null || this.isClosed) return;

        this.cardPane.closeSession();
        this.ui.setUIState(UIState.DeckList);
        this.desktopData = null;
        this.deckPane.showList(
            this.queueSeq,
            this.settings,
            this.reviewMode,
            this.reviewQueueLoader.getCustomStudy() !== null,
        );
        this._showDesktopHome(this.queueSeq);
        this.onDeckList?.();
    }

    /** Goes into the cards of a deck. */
    private async _enterDeck(deck: Deck): Promise<void> {
        const sessionState = this._freshSession(deck);
        if (sessionState === null) return;
        this.sessionState = sessionState;
        this.sessionStartMs = Date.now();
        this.sessionAnswers = [];
        // A card screen that is still up (the summary of the last session, a session being restarted) starts again
        this.cardPane.closeSession();
        this.cardPane.setSessionAnswers(this.sessionAnswers);
        this.deckPane.closeList();
        this.ui.setUIState(UIState.CardFront);
        this._startDesktopStudy();
        await this.cardPane.openSession(sessionState, this.settings);
        this.cardShownAt = activeWindow.performance.now();
        this._updateStudyPanel();
    }

    private _freshSession(deck: Deck): SessionData | null {
        const reviewSession = this.queueSeq;
        if (reviewSession === null || !reviewSession.hasCurrentCard) return null;
        const currentDeck = reviewSession.currentDeck;
        if (currentDeck === null) return null;

        const chosenDeckStats = reviewSession.getDeckStats(deck.getTopicPath());
        const currentDeckStats = reviewSession.getDeckStats(currentDeck.getTopicPath());
        return {
            cardData: { currentCard: reviewSession.currentCard, cardState: CardState.Front },
            deckData: {
                chosenDeck: deck,
                currentDeck,
                previousDeck: null,
                currentDeckTotalCardsInQueue: currentDeckStats.cardsInQueueCount,
                chosenDeckStats,
                currentDeckStats,
                previousDeckStats: null,
            },
            // The total is fixed for the session, so the progress bar has a whole to fill
            totalCardsInSession: chosenDeckStats.cardsInQueueCount,
            totalDecksInSession: chosenDeckStats.decksInQueueOfThisDeckCount,
            currentQuestion: reviewSession.currentQuestion,
            currentNote: reviewSession.currentNote,
        };
    }

    /** Shows the next card of the session, or what comes when there is none: the waiting screen, the summary, the decks. */
    private async _advance(): Promise<void> {
        const reviewSession = this.queueSeq;
        if (this.sessionState === null || reviewSession === null) {
            await this._gotoDeckList(true);
            return;
        }
        this.waiting = false;
        // A waiting card that has fallen due is woken at a card boundary
        if (reviewSession.hasDuePendingCards) reviewSession.refreshCurrentDeck();
        // Like Anki's learn ahead limit: with nothing else left, a card due soon is shown now instead of waited for
        if (!reviewSession.hasCurrentCard && reviewSession.hasPendingCards) {
            reviewSession.learnAhead(this.settings.learnAheadMinutes * 60 * 1000);
        }

        if (!reviewSession.hasCurrentCard) {
            if (reviewSession.hasPendingCards) {
                await this._showPendingState();
            } else if (!(await this._showSessionSummary())) {
                if (this.returnAfterCustomStudy !== null) {
                    await this._switchMode(this.returnAfterCustomStudy);
                } else {
                    await this._gotoDeckList(true);
                }
            }
            return;
        }
        const currentDeck = reviewSession.currentDeck;
        if (currentDeck === null) {
            await this._gotoDeckList(true);
            return;
        }

        const deckData = this.sessionState.deckData;
        const deckChanged = topicKey(currentDeck) !== topicKey(deckData.currentDeck);
        deckData.chosenDeckStats = reviewSession.getDeckStats(deckData.chosenDeck.getTopicPath());
        deckData.previousDeck = deckData.currentDeck;
        deckData.previousDeckStats = deckData.currentDeckStats;
        deckData.currentDeck = currentDeck;
        deckData.currentDeckStats = reviewSession.getDeckStats(currentDeck.getTopicPath());
        if (deckChanged) {
            deckData.currentDeckTotalCardsInQueue = deckData.currentDeckStats.cardsInQueueCount;
        }
        this.sessionState.currentQuestion = reviewSession.currentQuestion;
        this.sessionState.currentNote = reviewSession.currentNote;
        this.sessionState.cardData = {
            currentCard: reviewSession.currentCard,
            cardState: CardState.Front,
        };
        this.ui.setUIState(UIState.CardFront);

        await this.cardPane.drawCardFront(this.sessionState, this.settings);
        this.cardShownAt = activeWindow.performance.now();
        this._updateStudyPanel();
    }

    /** Nothing is due right now but a card is waiting for its step: shows how long, and brings it back when it is due. */
    private async _showPendingState(): Promise<void> {
        this._cancelResume();
        const dueUnix = this.queueSeq?.nextPendingDueUnix ?? null;
        if (dueUnix === null || Number.isNaN(dueUnix)) {
            // A waiting card without a due time never comes back in this session
            await this._gotoDeckList(true);
            return;
        }
        this.waiting = true;
        this.ui.setUIState(UIState.Waiting);
        this.cardPane.drawPendingState(dueUnix);
        this._updateStudyPanel();
        this.resumeTimer = window.setTimeout(
            () => {
                this.resumeTimer = null;
                this.queueSeq?.refreshCurrentDeck();
                void this._advance();
            },
            Math.max(0, dueUnix - Date.now()) + 50,
        );
    }

    private _cancelResume(): void {
        if (this.resumeTimer === null) return;
        window.clearTimeout(this.resumeTimer);
        this.resumeTimer = null;
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
            this.ui.setUIState(UIState.DeckList);
            this.cardPane.showSessionSummary(summary, {
                onBackToDecks: () => void this._gotoDeckList(true),
                mistakes: forgottenCardIds(entries, sessionStartMs).size,
                onReviewMistakes: () =>
                    void this._startCustomStudy(
                        { type: "forgotten", days: 1, sinceMs: sessionStartMs },
                        true,
                    ),
                onUndo: () => void this._undoLastAnswer(),
                onOpenStatistics: () => {
                    this.closeModal?.();
                    void this.ui.openStatisticsView();
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

    // #endregion

    // #region -> What the buttons and keys do

    /** Runs an action that moves the screen to another card; a second one that arrives while it runs is dropped. */
    private async _exclusive(action: () => Promise<void>): Promise<void> {
        if (!this.busy.enter()) return;
        try {
            await action();
        } finally {
            this.busy.leave();
        }
    }

    /** Whether a button pressed now should be ignored because the one before it came too soon. */
    private _pressedTooSoon(): boolean {
        const now = Date.now();
        if (now - this.lastButtonTime < this.settings.reviewButtonDelay) return true;
        this.lastButtonTime = now;
        return false;
    }

    /** Whether there is a card on screen to act on: a session is going, a card is up, and it is not the waiting screen. */
    private get _hasCardOnScreen(): boolean {
        return (
            this.sessionState !== null &&
            this.queueSeq !== null &&
            this.queueSeq.hasCurrentCard &&
            !this.waiting
        );
    }

    private _deleteCurrentCard(): void {
        if (!this._hasCardOnScreen || this._pressedTooSoon()) return;
        // The review keys stand down while the dialog is up, or a key typed in it would act on the card behind it
        const wasInFocus = this.ui.isStudioInFocus;
        this.ui.setStudioViewInFocus(false);
        const [heading, question] = [
            t("DELETE_CARD"),
            removalConfirmation(this.queueSeq.currentQuestion),
        ];
        new ConfirmationModal(
            this.app,
            heading,
            question,
            "",
            () =>
                this._exclusive(async () => {
                    // The card may have gone while the dialog was open
                    if (!this._hasCardOnScreen) return;
                    // A note that changed leaves the card where it is
                    if (!(await this.queueSeq?.deleteCurrentCardFromNote())) return;
                    await this._advance();
                }),
            () => this.ui.setStudioViewInFocus(wasInFocus),
        ).open();
    }

    /** Shows the back of the card. Called by the key, the button, a tap on the card, and the command. */
    public async _showAnswer(): Promise<void> {
        const sessionState = this.sessionState;
        // Only a front that has a card can be turned over, and only once
        if (
            !this._hasCardOnScreen ||
            sessionState === null ||
            sessionState.cardData.cardState !== CardState.Front ||
            this._pressedTooSoon()
        ) {
            return;
        }
        this.ui.setUIState(UIState.CardBack);
        sessionState.cardData.cardState = CardState.Back;
        await this.cardPane.drawBack(sessionState, this.reviewMode, this.settings, (response) =>
            this._determineButtonSchedule(response),
        );
    }

    private _determineButtonSchedule(response: ReviewResponse): ScheduleState | null {
        const card = this.sessionState?.cardData.currentCard;
        if (this.queueSeq === null || !card) return null;
        return this.queueSeq.determineCardSchedule(response, card);
    }

    /** Edits the text of the card on screen, and draws the side that was showing again. */
    public async _editQuestion(): Promise<void> {
        const reviewSession = this.queueSeq;
        if (reviewSession === null || !this._hasCardOnScreen) return;
        const currentCard = reviewSession.currentCard;
        const currentQ = reviewSession.currentQuestion;
        if (currentCard === null) return;

        const previousState = this.ui.uiState;
        this.ui.setUIState(UIState.EditModal);
        // The review keys (skip, undo, grade) would act on the card behind the editor for the keys typed in it, so they
        // stand down while it is open, as they do for the card info window
        const wasInFocus = this.ui.isStudioInFocus;
        this.ui.setStudioViewInFocus(false);
        try {
            // An image occlusion card is edited in the occlusion editor, not as text
            const newText =
                currentQ.questionType === CardType.ImageOcclusion
                    ? await editOcclusionQuestion(this.app, currentQ)
                    : await FlashcardEditModal.Prompt(
                          this.app,
                          this.settings,
                          currentCard,
                          currentQ.questionText.actualQuestion,
                          currentQ.questionText.textDirection,
                      );
            // The text is of the question that the editor was opened on. If the review has moved on since, the
            // current question is another one, and writing it there would overwrite that question
            if (reviewSession.currentQuestion !== currentQ) {
                new Notice(t("EDIT_CARD_MOVED_ON"));
                return;
            }
            await reviewSession.updateCurrentQuestionTextAndCards(newText);
            if (this.ui.uiState === UIState.EditModal) {
                this.ui.setUIState(previousState);
            }
            await this._redrawCurrentSide();
        } catch (reason) {
            // Closing the editor without saving is not a failure
            if (!(reason instanceof EditCancelled)) console.error(reason);
        } finally {
            this.ui.setStudioViewInFocus(wasInFocus);
            // Closed, whether saved, cancelled or refused
            if (this.ui.uiState === UIState.EditModal) {
                this.ui.setUIState(previousState);
            }
        }
    }

    /** Draws the side of the card that is showing again, after the card was edited. */
    private async _redrawCurrentSide(): Promise<void> {
        const reviewSession = this.queueSeq;
        const sessionState = this.sessionState;
        if (reviewSession === null || sessionState === null || !reviewSession.hasCurrentCard)
            return;
        sessionState.cardData.currentCard = reviewSession.currentCard;
        sessionState.currentQuestion = reviewSession.currentQuestion;
        sessionState.currentNote = reviewSession.currentNote;
        if (sessionState.cardData.cardState === CardState.Back) {
            await this.cardPane.drawBack(sessionState, this.reviewMode, this.settings, (response) =>
                this._determineButtonSchedule(response),
            );
        } else {
            await this.cardPane.drawCardFront(sessionState, this.settings);
        }
    }

    /** Opens the note of the card on screen at the card, in a tab of its own. */
    public async _jumpToCurrentCard(): Promise<void> {
        const reviewSession = this.queueSeq;
        if (reviewSession === null || !this._hasCardOnScreen) return;
        const question = reviewSession.currentQuestion;
        const filePath = question.note.filePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        // The review is in a window of its own: the note opens behind it
        const isMobile = Platform.isMobile;
        const inModal =
            (!this.settings.openViewInNewTab &&
                !desktopTabWanted(this.settings, isMobile) &&
                !isMobile) ||
            (!this.settings.openViewInNewTabMobile && isMobile);
        if (inModal) new Notice(t("NOTE_OPENED_IN_BACKGROUND"));

        const workspace = this.app.workspace;
        const line = Math.max(0, question.lineNo);
        const blockId = question.questionText.obsidianBlockId;
        // A tab that shows the note already is used, so repeated jumps do not pile tabs up. The review is never
        // that tab, and neither is whatever note the person happens to be in.
        let leaf: WorkspaceLeaf | null = null;
        workspace.iterateAllLeaves((candidate) => {
            if (leaf === null && candidate.view.getViewType() === "markdown") {
                const shown = (candidate.view as { file?: TFile }).file;
                if (shown?.path === filePath) leaf = candidate;
            }
        });
        const target: WorkspaceLeaf = leaf ?? workspace.getLeaf("tab");
        const eState = blockId ? { subpath: `#^${blockId}` } : { line };
        await target.openFile(file, { eState });
        workspace.setActiveLeaf(target, { focus: true });
        const view = target.view as {
            editor?: {
                setCursor: (pos: { line: number; ch: number }) => void;
                scrollIntoView: (
                    range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
                    center?: boolean,
                ) => void;
            };
        };
        if (!blockId && view.editor) {
            const position = { line, ch: 0 };
            view.editor.setCursor(position);
            view.editor.scrollIntoView({ from: position, to: position }, true);
        }
    }

    /** Takes the card out of this session; nothing is written, so it is back in the next one. */
    public async _skipCurrentCard(): Promise<void> {
        await this._exclusive(async () => {
            if (!this._hasCardOnScreen) return;
            this.queueSeq?.skipCurrentCard();
            await this._advance();
        });
    }

    /** Opens the info window of the card on screen. */
    public _showCardInfo(): void {
        if (this.sessionState === null || this.sessionState.cardData.currentCard === null) return;
        // Keep the review shortcuts from reacting to keys typed in the info window
        const wasInFocus = this.ui.isStudioInFocus;
        this.ui.setStudioViewInFocus(false);
        new CardInfoModal(
            this.app,
            this.plugin,
            this.sessionState.cardData.currentCard,
            this.sessionState.currentNote.filePath,
            () => this.ui.setStudioViewInFocus(wasInFocus),
        ).open();
    }

    /**
     * Answers the card on screen. Only the back of a card can be answered, and only once: a second press while the
     * first is being saved is dropped, so a double tap or a held key rates one card once.
     */
    public async _processReview(response: ReviewResponse): Promise<void> {
        await this._exclusive(async () => {
            const reviewSession = this.queueSeq;
            if (
                reviewSession === null ||
                !this._hasCardOnScreen ||
                this.sessionState?.cardData.cardState !== CardState.Back ||
                this._pressedTooSoon()
            ) {
                return;
            }
            const durationMs: number = activeWindow.performance.now() - this.cardShownAt;
            await reviewSession.processReview(response, durationMs);

            // An answer that was not saved (the note changed under it) has no entry, and is not counted
            const entry = reviewSession.lastLoggedEntry;
            if (entry !== null) {
                if (response !== ReviewResponse.Reset) {
                    this.sessionAnswers.push(response);
                    this.cardPane.setSessionAnswers(this.sessionAnswers);
                }
                this._noteAnswerLogged(entry);
            }
            await this._advance();

            // The session summary has its own undo button; the toast would sit on top of its buttons
            if (
                entry !== null &&
                this.reviewMode === FlashcardReviewMode.Review &&
                !this.cardPane.isShowingSessionSummary
            ) {
                this.cardPane.showAnswerToast(entry);
            }
        });
    }

    // #endregion

    // #region -> Card actions (undo, bury, suspend, flag)

    private _createCardActions(): CardActions {
        return {
            undo: () => this._undoLastAnswer(),
            canUndo: () => this.queueSeq?.canUndo ?? false,
            suspend: () =>
                this._changeCurrentCard((reviewSession) => reviewSession.suspendCurrentCard()),
            bury: () => this._changeCurrentCard((reviewSession) => reviewSession.buryCurrentCard()),
            setFlag: async (flag: number) => {
                if (this.queueSeq === null || !this._hasCardOnScreen) return;
                await this.queueSeq.setFlagCurrentCard(flag);
                this.cardPane.showFlag(flag);
            },
            currentFlag: () => this.queueSeq?.currentCard?.meta.flag ?? 0,
        };
    }

    private async _changeCurrentCard(
        action: (reviewSession: IReviewSession) => Promise<void>,
    ): Promise<void> {
        await this._exclusive(async () => {
            if (this.queueSeq === null || !this._hasCardOnScreen) return;
            await action(this.queueSeq);
            await this._advance();
        });
    }

    /** Takes back the last answer. */
    public async _undoLastAnswer(): Promise<void> {
        await this._exclusive(async () => {
            if (this.queueSeq === null) return;
            this.cardPane.hideAnswerToast();
            const result: UndoResult = await this.queueSeq.undoLastAnswer();
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
                    this.queueSeq = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
                    if (this.sessionState === null) {
                        await this._gotoDeckList();
                    } else {
                        await this._beginDeck(this.sessionState.deckData.chosenDeck);
                    }
                    return;
                case UndoResult.Requeued:
                    this.sessionAnswers.pop();
                    this.cardPane.setSessionAnswers(this.sessionAnswers);
                    this._cancelResume();
                    await this._advance();
                    // Undoing from the summary brings the card back where the deck list was drawn over it
                    if (this.sessionState !== null) {
                        this.deckPane.closeList();
                        await this.cardPane.openSession(this.sessionState, this.settings);
                    }
                    return;
            }
        });
    }

    // #endregion

    private async _beginDeck(deck: Deck): Promise<void> {
        if (this.queueSeq === null) return;
        this.queueSeq.setCurrentDeck(deck.getTopicPath());
        if (this.queueSeq.hasCurrentCard) await this._enterDeck(deck);
        else await this._gotoDeckList();
    }

    private async _switchMode(reviewMode: FlashcardReviewMode): Promise<void> {
        // Picking a mode goes back to the normal decks
        this.returnAfterCustomStudy = null;
        this.reviewQueueLoader.setCustomStudy(null);
        this.reviewMode = reviewMode;
        this.reviewQueueLoader.setReviewMode(reviewMode);
        this.queueSeq = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);
        this.deckPane.closeList();
        await this._gotoDeckList();
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

    // MARK: Custom study

    private _openCustomStudy(): void {
        new CustomStudyModal(this.app, this.plugin, {
            onLimitsChanged: () => void this._gotoDeckList(true),
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
        const reviewSession = await this.reviewQueueLoader.loadReviewQueue(this.undoHistory);

        const tree = reviewSession.originalRoot;
        const found = tree.getDistinctReviewItemCount(ReviewItemState.AnyItem, true);
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
        this.queueSeq = reviewSession;
        this.deckPane.closeList();
        if (startNow) {
            this.returnAfterCustomStudy = previousMode;
            await this._beginDeck(reviewSession.originalRoot);
            return true;
        }
        this.returnAfterCustomStudy = null;
        await this._gotoDeckList();
        return true;
    }

    // MARK: Desktop

    /**
     * What the navigation of the desktop shell does.
     */
    private _desktopActions(): DesktopShellActions {
        return {
            // What replaces the main area first asks about an exam that is going, whose answers would be lost
            openHome: () => this._afterExam(() => void this._gotoDeckList()),
            startReviewOfDeck: (deck) => this._afterExam(() => void this._beginDeck(deck)),
            openExams: () => this._openExams(),
            // The card browser is still to come; until then this opens the custom study filter
            openBrowse: () => this._afterExam(() => this._openCustomStudy()),
            openStatistics: () => void this.ui.openStatisticsView(),
            openAiGenerator: () => this._openAiGenerator(),
            openSettings: () => this._openPluginSettings(),
        };
    }

    // MARK: Exams

    /** The exam setup; Start takes the exam here, in the main area on the desktop, in a tab on the phone. */
    private _openExams(): void {
        // A click on Exams during an exam stays on the exam
        if (this.examRunner?.isRunning === true) return;
        void this.ui.openExamSetup((start) => {
            if (this.desktop !== null) {
                this.runExam(start);
                return;
            }
            this.closeModal?.();
            void this.ui.startExam(start);
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
        this._cancelResume();
        this.deckPane.closeList();
        this.cardPane.closeSession();
        this.sessionStartMs = 0;
        this.ui.setUIState(UIState.DeckList);
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
                void this._gotoDeckList();
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
        new NotePickerModal(
            this.app,
            (file) => {
                void this.app.vault
                    .cachedRead(file)
                    .then((text) => openGenerateCards(this.plugin, file, text, false));
            },
            (path) => isInExamsFolder(path) || this.dataManager.isInReviewLogFolder(path),
        ).open();
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
            resetMode: () => void this._switchMode(FlashcardReviewMode.Review),
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
                this.queueSeq === null
                    ? []
                    : collectStatsCards(this.queueSeq.originalRoot, todayKey).cards;
            return { entries, cards, todayKey, dayKeyOf, weekStart };
        } catch (error) {
            console.error(
                "Flashcard Studio: could not read the history for the home screen",
                error,
            );
            return { entries: [], cards: [], todayKey, dayKeyOf, weekStart };
        }
    }

    /** The sidebar's deck hierarchy and count follow the home; the frame shows the home section. */
    private _showDesktopHome(reviewSession: IReviewSession): void {
        if (this.desktop === null) return;
        this._stopStudyClock();
        this.desktop.setClock(null);
        this.desktop.setSection("home");
        const root = reviewSession.originalRoot;
        this.desktop.renderDeckList(root, (path) => reviewSession.getDeckStats(path));
        const stats = reviewSession.getDeckStats(root.getTopicPath());
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
        const reviewSession = this.queueSeq;
        if (desktop === null || reviewSession === null || this.sessionState === null) return;

        const card = reviewSession.hasCurrentCard ? this.sessionState.cardData.currentCard : null;
        const draw = () => {
            if (this.sessionState === null) return;
            const left = reviewSession.hasCurrentCard
                ? Math.max(0, this.sessionState.deckData.chosenDeckStats.cardsInQueueCount - 1)
                : 0;
            renderStudySidePanel(desktop.asideEl, {
                card: card === null ? null : this._cardInfoData(card),
                session: {
                    ...summarizeSessionAnswers(this.sessionAnswers),
                    elapsedMs: Date.now() - this.sessionStartMs,
                    left,
                },
                keys: card === null ? [] : this._studyKeys(this.cardPane.choosesByNumber),
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
                if (this.sessionState?.cardData.currentCard === card) draw();
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

    /**
     * The shortcuts the side panel lists, as the card screen has them. None with custom hotkeys, which replace them.
     *
     * @param choosing - The card is a multiple choice card that has not been answered: the number keys choose an option.
     */
    private _studyKeys(choosing: boolean): [string, string][] {
        if (this.settings.useCustomHotkeys) return [];
        const anki = this.settings.answerKeys === "anki";
        const keys: [string, string][] = [];
        if (choosing) keys.push(["1–9", t("DESKTOP_KEY_CHOOSE")]);
        keys.push([anki ? "1–4" : "1–3", t("DESKTOP_KEY_RATE")]);
        if (!anki) keys.push(["0", t("RESET_CARD_PROGRESS")]);
        keys.push(
            ["Space / Enter", t("DESKTOP_KEY_SPACE")],
            ["U", t("UNDO_LAST_ANSWER")],
            ["-", t("BURY_CARD")],
            ["@", t("SUSPEND_CARD")],
            ["S", t("SKIP")],
            ["J", t("DESKTOP_KEY_JUMP")],
        );
        if (speechAvailable()) keys.push(["R", t("READ_ALOUD")]);
        keys.push([`${Platform.isMacOS ? "⌘" : "Ctrl"} 1–7`, t("FLAG_CARD")]);
        return keys;
    }
}
