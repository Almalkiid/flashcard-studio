import { Notice } from "obsidian";
import { State } from "ts-fsrs";

import { CardMeta, cloneCardMeta } from "src/data/card-meta";
import { TICKS_PER_DAY } from "src/data/constants";
import { DataStore } from "src/data/data-store/base/data-store";
import { Card } from "src/data/data-structures/card/card";
import { Question, QuestionText } from "src/data/data-structures/card/questions/question";
import { IQuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import {
    CardFrontBack,
    CardFrontBackUtil,
} from "src/data/data-structures/card/questions/question-type";
import { Deck } from "src/data/data-structures/deck/deck";
import { IDeckTreeIterator } from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { Note } from "src/note/note";
import { ISRAlgorithm } from "src/scheduling/algorithms/base/isr-algorithm";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { RepItemState, ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { DailyLimits } from "src/scheduling/daily-limits";
import { DueDateHistogram } from "src/scheduling/due-date-histogram";
import { buildReviewLogEntry } from "src/scheduling/review-log-builder";
import { UndoHistory, UndoResult } from "src/scheduling/undo-history";
import { globalDateProvider } from "src/utils/dates";
import { MultiLineTextFinder } from "src/utils/strings";

/**
 * Where answers are recorded. Implemented by ReviewLogStore; tests use an in-memory fake.
 */
export interface IReviewLogSink {
    append(entry: ReviewLogEntry): Promise<void>;
    remove(entry: ReviewLogEntry): Promise<boolean>;
}

/**
 * Everything needed to revert one answer.
 */
export interface UndoRecord {
    owner: FlashcardReviewSequencer;
    card: Card;
    question: Question;
    prevSchedule: RepItemScheduleInfo | null;
    prevMeta: CardMeta;
    preAnswerText: string;
    postAnswerText: string;
    entry: ReviewLogEntry;
    histogramIncrementKey: number;
    histogramDecrementKey: number | null;
    wasPostponed: boolean;
}

export interface IFlashcardReviewSequencer {
    get hasCurrentCard(): boolean;
    get hasPendingCards(): boolean;
    get hasDuePendingCards(): boolean;
    get currentCard(): Card | null;
    get currentQuestion(): Question;
    get currentNote(): Note;
    get currentDeck(): Deck | null;
    get nextPendingDueUnix(): number | null;
    get originalDeckTree(): Deck;

    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void;
    setCurrentDeck(topicPath: TopicPath): void;
    refreshCurrentDeck(): void;
    getDeckStats(topicPath: TopicPath): DeckStats;
    getSubDecksWithCardsInQueue(deck: Deck): Deck[];
    skipCurrentCard(): void;
    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo;
    processReview(response: ReviewResponse, durationMs?: number): Promise<void>;
    updateCurrentQuestionTextAndCards(text: string): Promise<void>;
    deleteCurrentCardFromNote(): Promise<void>;

    get canUndo(): boolean;
    get lastLoggedEntry(): ReviewLogEntry | null;
    undoLastAnswer(): Promise<UndoResult>;
    suspendCurrentCard(): Promise<void>;
    buryCurrentCard(): Promise<void>;
    setFlagCurrentCard(flag: number): Promise<void>;
}

/**
 * Represents statistics for a deck and its subdecks.
 *
 * @property {number} totalCount - Total number of cards in this deck and all subdecks.
 * @property {number} dueCount - Number of due cards in this deck and all subdecks.
 * @property {number} newCount - Number of new cards in this deck and all subdecks.
 * @property {number} cardsInQueueCount - Number of cards in the queue of this deck and all subdecks.
 * @property {number} dueCardsInQueueOfThisDeckCount - Number of due cards just in this deck.
 * @property {number} newCardsInQueueOfThisDeckCount - Number of new cards just in this deck.
 * @property {number} cardsInQueueOfThisDeckCount - Total number of cards in queue just in this deck.
 * @property {number} subDecksInQueueOfThisDeckCount - Number of subdecks in the queue just in this deck.
 * @property {number} decksInQueueOfThisDeckCount - Total number of decks in the queue including this deck and its subdecks.
 *
 * @constructor
 * @param {number} totalCount - Initializes the total count of cards.
 * @param {number} dueCount - Initializes the due count of cards.
 * @param {number} newCount - Initializes the new count of cards.
 * @param {number} cardsInQueueCount - Initializes the count of cards in the queue.
 * @param {number} dueCardsInQueueOfThisDeckCount - Initializes the count of due cards just in this deck.
 * @param {number} newCardsInQueueOfThisDeckCount - Initializes the count of new cards just in this deck.
 * @param {number} cardsInQueueOfThisDeckCount - Initializes the count of all cards in the queue just in this deck.
 * @param {number} subDecksInQueueOfThisDeckCount - Initializes the count of subdecks in the queue just in this deck.
 * @param {number} decksInQueueOfThisDeckCount - Initializes the count of all decks in the queue including this deck and its subdecks.
 */
export class DeckStats {
    totalCount: number;
    dueCount: number;
    newCount: number;
    cardsInQueueCount: number;
    dueCardsInQueueOfThisDeckCount: number;
    newCardsInQueueOfThisDeckCount: number;
    cardsInQueueOfThisDeckCount: number;
    subDecksInQueueOfThisDeckCount: number;
    decksInQueueOfThisDeckCount: number;

    constructor(
        totalCount: number,
        dueCount: number,
        newCount: number,
        cardsInQueueCount: number,
        dueCardsInQueueOfThisDeckCount: number,
        newCardsInQueueOfThisDeckCount: number,
        cardsInQueueOfThisDeckCount: number,
        subDecksInQueueOfThisDeckCount: number,
        decksInQueueOfThisDeckCount: number,
    ) {
        this.dueCount = dueCount;
        this.newCount = newCount;
        this.totalCount = totalCount;
        this.cardsInQueueCount = cardsInQueueCount;
        this.dueCardsInQueueOfThisDeckCount = dueCardsInQueueOfThisDeckCount;
        this.newCardsInQueueOfThisDeckCount = newCardsInQueueOfThisDeckCount;
        this.cardsInQueueOfThisDeckCount = cardsInQueueOfThisDeckCount;
        this.subDecksInQueueOfThisDeckCount = subDecksInQueueOfThisDeckCount;
        this.decksInQueueOfThisDeckCount = decksInQueueOfThisDeckCount;
    }
}

export enum FlashcardReviewMode {
    Cram,
    Review,
}

interface PendingCard {
    card: Card;
    dueUnix: number;
}

/**
 * Whole days until a schedule falls due, matching the key space that
 * CardDueDateHistogram.calculateFromDeckTree builds the histogram with.
 *
 * Note that this is not the same as the scheduled interval: an FSRS short-term step has an
 * interval of 0 but a real sub-day due time.
 */
function dueDateHistogramKey(schedule: RepItemScheduleInfo): number {
    const now: number = globalDateProvider.now.valueOf();
    return Math.ceil((schedule.dueDateAsUnix - now) / TICKS_PER_DAY);
}

export class FlashcardReviewSequencer implements IFlashcardReviewSequencer {
    // We need the original deck tree so that we can still provide the total cards in each deck
    private _originalDeckTree: Deck;

    // This is set by the caller, and must have the same deck hierarchy as originalDeckTree.
    private remainingDeckTree: Deck;

    private reviewMode: FlashcardReviewMode;
    private cardSequencer: IDeckTreeIterator;
    private settings: SRSettings;
    private srsAlgorithm: ISRAlgorithm;
    private questionPostponementList: IQuestionPostponementList;
    private dueDateFlashcardHistogram: DueDateHistogram;
    private pendingCards: PendingCard[] = [];
    private currentTopicPath: TopicPath = TopicPath.emptyPath;
    private reviewLog: IReviewLogSink | null;
    private dailyLimits: DailyLimits | null;
    private undoHistory: UndoHistory<UndoRecord>;
    private _lastLoggedEntry: ReviewLogEntry | null = null;

    constructor(
        reviewMode: FlashcardReviewMode,
        cardSequencer: IDeckTreeIterator,
        settings: SRSettings,
        srsAlgorithm: ISRAlgorithm,
        questionPostponementList: IQuestionPostponementList,
        dueDateFlashcardHistogram: DueDateHistogram,
        reviewLog: IReviewLogSink | null = null,
        dailyLimits: DailyLimits | null = null,
        undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>(),
    ) {
        this.reviewMode = reviewMode;
        this.cardSequencer = cardSequencer;
        this.settings = settings;
        this.srsAlgorithm = srsAlgorithm;
        this.questionPostponementList = questionPostponementList;
        this.dueDateFlashcardHistogram = dueDateFlashcardHistogram;
        this.reviewLog = reviewLog;
        this.dailyLimits = dailyLimits;
        this.undoHistory = undoHistory;
    }

    get canUndo(): boolean {
        return this.undoHistory.size > 0;
    }

    get lastLoggedEntry(): ReviewLogEntry | null {
        return this._lastLoggedEntry;
    }

    get hasCurrentCard(): boolean {
        return (
            this.cardSequencer.currentRepItem !== null &&
            this.cardSequencer.currentRepItem !== undefined
        );
    }

    get hasPendingCards(): boolean {
        return this.pendingCards.length > 0;
    }

    /**
     * This is deliberately a side-effect-free check. Pending cards must only be
     * moved back into the deck while advancing between cards, never while UI
     * code is merely reading queue statistics for the currently displayed card.
     */
    get hasDuePendingCards(): boolean {
        const nowUnix = globalDateProvider.now.valueOf();
        return this.pendingCards.some((pendingCard) => pendingCard.dueUnix <= nowUnix);
    }

    get currentCard(): Card | null {
        if (this.cardSequencer.currentRepItem === null) return null;

        return this.cardSequencer.currentRepItem as Card;
    }

    get currentQuestion(): Question {
        return this.currentCard?.question;
    }

    get currentDeck(): Deck | null {
        return this.cardSequencer.currentDeck;
    }

    get nextPendingDueUnix(): number | null {
        return this.pendingCards.length > 0
            ? Math.min(...this.pendingCards.map((pendingCard) => pendingCard.dueUnix))
            : null;
    }

    get currentNote(): Note {
        return this.currentQuestion.note;
    }

    // originalDeckTree isn't modified by the review process
    // Only remainingDeckTree
    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void {
        this.cardSequencer.setBaseDeck(remainingDeckTree);
        this._originalDeckTree = originalDeckTree;
        this.remainingDeckTree = remainingDeckTree;
        this.pendingCards = [];
        this.setCurrentDeck(TopicPath.emptyPath);
    }

    setCurrentDeck(topicPath: TopicPath): void {
        this.currentTopicPath = topicPath;
        this.wakeDuePendingCards();
        this.cardSequencer.setIteratorTopicPath(topicPath);
        this.cardSequencer.nextRepItem();
        this.skipOverLimitedCards();
    }

    refreshCurrentDeck(): void {
        this.setCurrentDeck(this.currentTopicPath);
    }

    get originalDeckTree(): Deck {
        return this._originalDeckTree;
    }

    getDeckStats(topicPath: TopicPath): DeckStats {
        const totalCount: number = this._originalDeckTree
            .getDeck(topicPath)
            .getDistinctRepItemCount(RepItemState.AnyItem, true);
        const remainingDeck: Deck = this.remainingDeckTree.getDeck(topicPath);
        let newCount: number = remainingDeck.getDistinctRepItemCount(RepItemState.NewItem, true);
        let dueCount: number = remainingDeck.getDistinctRepItemCount(RepItemState.DueItem, true);
        if (this.limitsApply) {
            // Learning cards are never limited, so only the review-state share of the due count is capped
            const learningCount = this.countDistinctLearningCards(remainingDeck);
            newCount = Math.min(newCount, this.dailyLimits.remainingNew());
            dueCount = Math.min(dueCount, learningCount + this.dailyLimits.remainingReviews());
        }

        // Sry for the long variable names, but I needed all these distinct counts in the UI
        const newCardsInQueueOfThisDeckCount = remainingDeck.getDistinctRepItemCount(
            RepItemState.NewItem,
            false,
        );
        const dueCardsInQueueOfThisDeckCount = remainingDeck.getDistinctRepItemCount(
            RepItemState.DueItem,
            false,
        );
        const cardsInQueueOfThisDeckCount =
            newCardsInQueueOfThisDeckCount + dueCardsInQueueOfThisDeckCount;

        const subDecksInQueueOfThisDeckCount =
            this.getSubDecksWithCardsInQueue(remainingDeck).length;
        const decksInQueueOfThisDeckCount =
            cardsInQueueOfThisDeckCount > 0
                ? subDecksInQueueOfThisDeckCount + 1
                : subDecksInQueueOfThisDeckCount;

        return new DeckStats(
            totalCount,
            dueCount,
            newCount,
            dueCount + newCount,
            dueCardsInQueueOfThisDeckCount,
            newCardsInQueueOfThisDeckCount,
            cardsInQueueOfThisDeckCount,
            subDecksInQueueOfThisDeckCount,
            decksInQueueOfThisDeckCount,
        );
    }

    getSubDecksWithCardsInQueue(deck: Deck): Deck[] {
        let subDecksWithCardsInQueue: Deck[] = [];

        deck.subdecks.forEach((subDeck) => {
            subDecksWithCardsInQueue = subDecksWithCardsInQueue.concat(
                this.getSubDecksWithCardsInQueue(subDeck),
            );

            const newCount: number = subDeck.getDistinctRepItemCount(RepItemState.NewItem, false);
            const dueCount: number = subDeck.getDistinctRepItemCount(RepItemState.DueItem, false);
            if (newCount + dueCount > 0) subDecksWithCardsInQueue.push(subDeck);
        });

        return subDecksWithCardsInQueue;
    }

    skipCurrentCard(): void {
        this.cardSequencer.deleteCurrentQuestionFromAllDecks();
        this.skipOverLimitedCards();
    }

    private deleteCurrentCard(): void {
        this.cardSequencer.deleteCurrentRepItemFromAllDecks();
    }

    async processReview(response: ReviewResponse, durationMs: number = 0): Promise<void> {
        switch (this.reviewMode) {
            case FlashcardReviewMode.Review:
                await this.processReviewReviewMode(response, durationMs);
                break;

            case FlashcardReviewMode.Cram: {
                const card = this.currentCard;
                this.processReviewCramMode(response);
                await this.appendToReviewLog(
                    buildReviewLogEntry(
                        card,
                        response,
                        card.scheduleInfo,
                        durationMs,
                        true,
                        globalDateProvider.now.valueOf(),
                    ),
                );
                break;
            }
        }
        this.skipOverLimitedCards();
    }

    async processReviewReviewMode(response: ReviewResponse, durationMs: number = 0): Promise<void> {
        let shortTermRequeue: "none" | "immediate" | "pending" = "none";
        let removeFromSession = false;
        if (response !== ReviewResponse.Reset || this.currentCard.hasSchedule) {
            const card: Card = this.currentCard;
            const question: Question = this.currentQuestion;
            const oldSchedule = card.scheduleInfo;
            const prevMeta: CardMeta = cloneCardMeta(card.meta);
            const preAnswerText: string = question.questionText.original;
            const wasPostponed: boolean = this.questionPostponementList.includes(question);

            // We need to update the schedule if:
            //  (1) the user reviewed with easy/good/hard (either a new or due card),
            //  (2) or reset a due card
            // Nothing to do if a user resets a new card
            card.scheduleInfo = this.determineCardSchedule(response, card);
            const leech: boolean = this.markLeech(response, oldSchedule, card);
            removeFromSession = card.meta.suspended;
            shortTermRequeue = removeFromSession
                ? "none"
                : this.getShortTermRequeueMode(card.scheduleInfo);

            // Update the source file with the updated schedule
            await DataStore.getInstance().writeSchedule(question);

            const histogramDecrementKey: number | null = oldSchedule
                ? dueDateHistogramKey(oldSchedule)
                : null;
            const histogramIncrementKey: number = dueDateHistogramKey(card.scheduleInfo);
            if (histogramDecrementKey !== null) {
                this.dueDateFlashcardHistogram.decrement(histogramDecrementKey);
            }
            this.dueDateFlashcardHistogram.increment(histogramIncrementKey);

            const entry = buildReviewLogEntry(
                card,
                response,
                oldSchedule,
                durationMs,
                false,
                globalDateProvider.now.valueOf(),
            );
            await this.appendToReviewLog(entry);
            this.dailyLimits?.record(entry);

            this.undoHistory.push({
                owner: this,
                card,
                question,
                prevSchedule: oldSchedule,
                prevMeta,
                preAnswerText,
                postAnswerText: question.questionText.original,
                entry,
                histogramIncrementKey,
                histogramDecrementKey,
                wasPostponed,
            });

            if (leech) {
                const lapses = (card.scheduleInfo as RepItemScheduleInfoFsrs).lapses;
                new Notice(
                    t(card.meta.suspended ? "LEECH_SUSPENDED" : "LEECH_TAGGED", {
                        lapses,
                    }),
                );
            }
        } else if (response === ReviewResponse.Reset) {
            shortTermRequeue = "immediate";
        }

        if (removeFromSession) {
            this.deleteCurrentCard();
        } else if (shortTermRequeue === "pending") {
            await this.handlePendingRequeue();
        } else if (shortTermRequeue === "immediate" || response === ReviewResponse.Reset) {
            if (this.settings.burySiblingCards) {
                await this.burySiblingCards();
                this.deleteSiblingCardsFromAllDecks();
            }
            this.cardSequencer.moveCurrentRepItemToEndOfList();
            this.cardSequencer.nextRepItem();
        } else {
            if (this.settings.burySiblingCards) {
                await this.burySiblingCards();
                this.cardSequencer.deleteCurrentQuestionFromAllDecks();
            } else {
                this.deleteCurrentCard();
            }
        }
    }

    private async burySiblingCards(): Promise<void> {
        // We check if there are any sibling cards still in the deck,
        // We do this because otherwise we would be adding every reviewed card to the postponement list, even for a
        // question with a single card. That isn't consistent with the 1.10.1 behavior
        const remaining = this.currentDeck.getQuestionRepItemCount(this.currentQuestion);
        if (remaining > 1) {
            this.questionPostponementList.add(this.currentQuestion);
            await this.questionPostponementList.write();
        }
    }

    private deleteSiblingCardsFromAllDecks(): void {
        for (const siblingCard of this.currentQuestion.cards) {
            if (Object.is(siblingCard, this.currentCard)) {
                continue;
            }

            this.remainingDeckTree.deleteCardFromAllDecks(siblingCard, false);
        }
    }

    private async handlePendingRequeue(): Promise<void> {
        const pendingCard = this.currentCard;
        const dueUnix = pendingCard.scheduleInfo?.dueDateAsUnix;

        if (this.settings.burySiblingCards) {
            await this.burySiblingCards();
            this.cardSequencer.deleteCurrentQuestionFromAllDecks();
        } else {
            this.cardSequencer.deleteCurrentRepItemFromAllDecks();
        }

        this.pendingCards.push({ card: pendingCard, dueUnix });
    }

    processReviewCramMode(response: ReviewResponse): void {
        if (response === ReviewResponse.Easy) this.deleteCurrentCard();
        else {
            this.cardSequencer.moveCurrentRepItemToEndOfList();
            this.cardSequencer.nextRepItem();
        }
    }

    private getShortTermRequeueMode(
        scheduleInfo: RepItemScheduleInfo | null,
    ): "none" | "immediate" | "pending" {
        if (!scheduleInfo || scheduleInfo.interval >= 1) {
            return "none";
        }

        return scheduleInfo.isDue() ? "immediate" : "pending";
    }

    private wakeDuePendingCards(): void {
        if (this.pendingCards.length === 0) {
            return;
        }

        const nowUnix = globalDateProvider.now.valueOf();
        const duePendingCards: PendingCard[] = [];
        const remainingPendingCards: PendingCard[] = [];
        for (const pendingCard of this.pendingCards) {
            if (pendingCard.dueUnix <= nowUnix) {
                duePendingCards.push(pendingCard);
            } else {
                remainingPendingCards.push(pendingCard);
            }
        }

        // Prepend the latest due cards first so the earliest due card remains
        // at the front of the sequential queue.
        duePendingCards.sort((a, b) => b.dueUnix - a.dueUnix);
        for (const pendingCard of duePendingCards) {
            this.remainingDeckTree.prependRepItem(
                pendingCard.card.question.topicPathList,
                pendingCard.card,
            );
        }

        this.pendingCards = remainingPendingCards;
    }

    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo {
        let result: RepItemScheduleInfo;

        if (response === ReviewResponse.Reset) {
            // Resetting the card schedule
            result = this.srsAlgorithm.cardGetResetSchedule();
        } else {
            // scheduled card
            if (card.hasSchedule) {
                result = this.srsAlgorithm.cardCalcUpdatedSchedule(
                    response,
                    card.scheduleInfo,
                    this.dueDateFlashcardHistogram,
                );
            } else {
                const currentNote: Note = card.question.note;
                result = this.srsAlgorithm.cardGetNewSchedule(
                    response,
                    currentNote.filePath,
                    this.dueDateFlashcardHistogram,
                );
            }
        }
        return result;
    }

    async updateCurrentQuestionTextAndCards(text: string): Promise<void> {
        const question = this.currentQuestion;
        const q: QuestionText = question.questionText;

        // Update front/back properties of all cards which question is linked to
        const cardFrontBackList: CardFrontBack[] = CardFrontBackUtil.expand(
            question.questionType,
            text,
            this.settings,
        );

        q.actualQuestion = text;

        await this.currentQuestion.writeQuestion(this.settings);

        if (cardFrontBackList.length !== question.cards.length) {
            console.warn("SR: Cards count does not match question text. Skipping redraw.");
            new Notice("Cards count does not match cards from question text. Skipping redraw.");
            return;
        }
        question.cards.forEach((card, i) => {
            const { front, back } = cardFrontBackList[i];
            card.front = front;
            card.back = back;
        });
    }

    async deleteCurrentCardFromNote(): Promise<void> {
        const question = this.currentQuestion;
        await DataStore.getInstance().delete(question);
        this._originalDeckTree.deleteQuestionFromAllDecks(question, false);
        this.cardSequencer.deleteCurrentQuestionFromAllDecks();
    }

    /**
     * Reverts the most recent answer: the note, the review log, today's limits and, when the answer was given in this
     * session, the queue. When the note changed since the answer nothing is touched.
     */
    async undoLastAnswer(): Promise<UndoResult> {
        const record = this.undoHistory.pop();
        if (!record) return UndoResult.Nothing;

        const { card, question } = record;
        const fileText: string = await question.note.file.read();

        // Put back the exact text the question had before the answer, so undo leaves no trace in the note
        const restoredText: string | null =
            question.questionText.original === record.postAnswerText
                ? MultiLineTextFinder.findAndReplace(
                      fileText,
                      record.postAnswerText,
                      record.preAnswerText,
                  )
                : null;
        if (restoredText === null) {
            new Notice(t("UNDO_FAILED_NOTE_CHANGED"));
            return UndoResult.Failed;
        }
        await question.note.file.write(restoredText);
        question.questionText = QuestionText.create(
            record.preAnswerText,
            question.questionText.textDirection,
            this.settings,
        );
        card.scheduleInfo = record.prevSchedule;
        card.meta = cloneCardMeta(record.prevMeta);

        if (this.reviewLog) {
            try {
                await this.reviewLog.remove(record.entry);
            } catch (error) {
                console.error(
                    "Flashcard Studio: could not remove the undone answer from the review log",
                    error,
                );
            }
        }
        this.dailyLimits?.unrecord(record.entry);
        if (this._lastLoggedEntry === record.entry) this._lastLoggedEntry = null;

        this.dueDateFlashcardHistogram.decrement(record.histogramIncrementKey);
        if (record.histogramDecrementKey !== null) {
            this.dueDateFlashcardHistogram.increment(record.histogramDecrementKey);
        }
        if (!record.wasPostponed && this.questionPostponementList.includes(question)) {
            this.questionPostponementList.remove(question);
            await this.questionPostponementList.write();
        }

        // An answer from an earlier session refers to cards that are no longer in this queue
        if (record.owner !== this) return UndoResult.NeedsReload;

        this.pendingCards = this.pendingCards.filter((pending) => pending.card !== card);
        this.remainingDeckTree.deleteCardFromAllDecks(card, false);
        this.remainingDeckTree.prependRepItem(question.topicPathList, card);
        if (!this.cardSequencer.setCurrentRepItem(card, this.currentTopicPath)) {
            this.refreshCurrentDeck();
        }
        return UndoResult.Requeued;
    }

    async suspendCurrentCard(): Promise<void> {
        await this.updateCurrentCardMeta((meta) => {
            meta.suspended = true;
        }, true);
    }

    /**
     * Hides the current card until tomorrow (after the day boundary).
     */
    async buryCurrentCard(): Promise<void> {
        const tomorrow: string = globalDateProvider.today.clone().add(1, "d").format("YYYY-MM-DD");
        await this.updateCurrentCardMeta((meta) => {
            meta.buryUntil = tomorrow;
        }, true);
    }

    /**
     * @param flag - 1 to 7 for Anki's flag colours, 0 to remove the flag.
     */
    async setFlagCurrentCard(flag: number): Promise<void> {
        if (!Number.isInteger(flag) || flag < 0 || flag > 7) return;
        await this.updateCurrentCardMeta((meta) => {
            meta.flag = flag;
        }, false);
    }

    private async updateCurrentCardMeta(
        mutate: (meta: CardMeta) => void,
        removeFromSession: boolean,
    ): Promise<void> {
        if (!this.hasCurrentCard) return;
        mutate(this.currentCard.meta);
        await DataStore.getInstance().writeSchedule(this.currentQuestion);
        if (removeFromSession) {
            this.cardSequencer.deleteCurrentRepItemFromAllDecks();
            this.skipOverLimitedCards();
        }
    }

    /**
     * Marks the card as a leech when an Again on a review card brings its lapses to the threshold, and again every
     * half threshold after that, as Anki does.
     *
     * @returns Whether the card was marked in this answer.
     */
    private markLeech(
        response: ReviewResponse,
        oldSchedule: RepItemScheduleInfo | null,
        card: Card,
    ): boolean {
        const threshold: number = this.settings.leechThreshold;
        const schedule = card.scheduleInfo;
        if (
            response !== ReviewResponse.Again ||
            !threshold ||
            threshold <= 0 ||
            !(oldSchedule instanceof RepItemScheduleInfoFsrs) ||
            oldSchedule.state !== State.Review ||
            !(schedule instanceof RepItemScheduleInfoFsrs)
        ) {
            return false;
        }

        const repeatEvery: number = Math.max(1, Math.ceil(threshold / 2));
        const lapses: number = schedule.lapses;
        if (lapses < threshold || (lapses - threshold) % repeatEvery !== 0) return false;

        card.meta.leech = true;
        if (this.settings.leechAction === "suspend") card.meta.suspended = true;
        return true;
    }

    private async appendToReviewLog(entry: ReviewLogEntry): Promise<void> {
        this._lastLoggedEntry = entry;
        if (!this.reviewLog) return;
        try {
            await this.reviewLog.append(entry);
        } catch (error) {
            console.error("Flashcard Studio: could not write the review log", error);
        }
    }

    private get limitsApply(): boolean {
        return this.dailyLimits !== null && this.reviewMode === FlashcardReviewMode.Review;
    }

    private isLimitedByReviewAllowance(card: Card): boolean {
        const schedule = card.scheduleInfo;
        if (schedule instanceof RepItemScheduleInfoFsrs) return schedule.state === State.Review;
        return schedule !== null;
    }

    /**
     * Drops cards from this session while the current card is over today's new or review allowance.
     * Learning and relearning cards are never limited.
     */
    private skipOverLimitedCards(): void {
        if (!this.limitsApply) return;
        while (this.hasCurrentCard) {
            const card: Card = this.currentCard;
            const overLimit: boolean = card.isNew
                ? this.dailyLimits.remainingNew() <= 0
                : this.isLimitedByReviewAllowance(card) && this.dailyLimits.remainingReviews() <= 0;
            if (!overLimit) break;
            this.cardSequencer.deleteCurrentRepItemFromAllDecks();
        }
    }

    private countDistinctLearningCards(deck: Deck): number {
        const learning = new Set<Card>();
        const visit = (current: Deck): void => {
            for (const item of current.dueRepItems) {
                const card = item;
                if (!card.isNew && !this.isLimitedByReviewAllowance(card)) learning.add(card);
            }
            current.subdecks.forEach(visit);
        };
        visit(deck);
        return learning.size;
    }
}
