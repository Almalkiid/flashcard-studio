import { Notice } from "obsidian";
import { State } from "ts-fsrs";

import { CardFrontBackUtil } from "src/cards/expand";
import { CardMeta, cloneCardMeta } from "src/data/card-meta";
import { DataStore } from "src/data/data-store/store";
import type { IBuriedCards } from "src/data/data-structures/card/buried-cards";
import type { Card } from "src/data/data-structures/card/flashcard";
import { Question, QuestionText } from "src/data/data-structures/card/question";
import type { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import type { IDeckWalker } from "src/data/decks/walker";
import type { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import type { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import type { Note } from "src/note-review/note";
import type { DailyLimits } from "src/scheduling/daily-limits";
import { cardDueDayKey, DueDateHistogram } from "src/scheduling/due-histogram";
import { DeckStats } from "src/scheduling/review/deck-stats";
import { PendingCards } from "src/scheduling/review/pending-cards";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { buildReviewLogEntry } from "src/scheduling/review-log-builder";
import { FsrsState, isReviewCard } from "src/scheduling/schedule/fsrs-state";
import { ReviewItemState, ReviewResponse } from "src/scheduling/schedule/review-item";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import type { IScheduler } from "src/scheduling/schedule/scheduler-kind";
import { UndoHistory, UndoResult } from "src/scheduling/undo-history";
import { globalDateProvider } from "src/utils/clock";

// The session's whole surface from one module, as callers have always imported it
export { DeckStats, FlashcardReviewMode };

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
    owner: ReviewSession;
    card: Card;
    question: Question;
    prevSchedule: ScheduleState | null;
    prevMeta: CardMeta;
    preAnswerText: string;
    postAnswerText: string;
    entry: ReviewLogEntry;
    histogramIncrementKey: number | null;
    histogramDecrementKey: number | null;
    wasPostponed: boolean;
}

/** One review session over a deck hierarchy: which card is up, and what an answer, a skip or an edit does to it. */
export interface IReviewSession {
    get hasCurrentCard(): boolean;
    get hasPendingCards(): boolean;
    get hasDuePendingCards(): boolean;
    get currentCard(): Card | null;
    get currentQuestion(): Question;
    get currentNote(): Note;
    get currentDeck(): Deck | null;
    get nextPendingDueUnix(): number | null;
    get originalRoot(): Deck;

    setDeckRoot(originalRoot: Deck, remainingRoot: Deck): void;
    setCurrentDeck(topicPath: TopicPath): void;
    refreshCurrentDeck(): void;
    learnAhead(limitMs: number): boolean;
    getDeckStats(topicPath: TopicPath): DeckStats;
    getSubDecksWithCardsInQueue(deck: Deck): Deck[];
    skipCurrentCard(): void;
    determineCardSchedule(response: ReviewResponse, card: Card): ScheduleState;
    processReview(response: ReviewResponse, durationMs?: number): Promise<void>;
    updateCurrentQuestionTextAndCards(text: string): Promise<void>;
    /** @returns Whether the question was removed; false when the note changed since it was read, and nothing was done. */
    deleteCurrentCardFromNote(): Promise<boolean>;

    get canUndo(): boolean;
    get lastLoggedEntry(): ReviewLogEntry | null;
    undoLastAnswer(): Promise<UndoResult>;
    suspendCurrentCard(): Promise<void>;
    buryCurrentCard(): Promise<void>;
    setFlagCurrentCard(flag: number): Promise<void>;
}

/** What happens to an answered card in this session. */
type Requeue = "none" | "immediate" | "pending";

/**
 * After an answer the card leaves the session ("none": its next review is a day or more away), goes to the back of the
 * queue ("immediate": a step that is already due, such as SM-2's Again) or waits for its step ("pending"). A step
 * without a readable due time is never due, so it waits (§10.7) and never wakes.
 */
function requeueOf(schedule: ScheduleState | null): Requeue {
    if (schedule === null || schedule.interval >= 1) return "none";
    return schedule.isDue() ? "immediate" : "pending";
}

/**
 * Takes cards from a deck hierarchy for review and records each answer: in the note, the card histogram, the review log,
 * today's limits and the undo history. Only the remaining tree is consumed; the original one keeps the totals.
 */
export class ReviewSession implements IReviewSession {
    private _originalRoot: Deck;
    private remainingRoot: Deck;
    private currentTopicPath: TopicPath = TopicPath.emptyPath;
    private pending = new PendingCards();
    /** The card answered last, until another card has been put up: it is not shown twice in a row (D3 #9). */
    private justAnswered: Card | null = null;
    private _lastLoggedEntry: ReviewLogEntry | null = null;

    constructor(
        private readonly reviewMode: FlashcardReviewMode,
        private readonly walker: IDeckWalker,
        private readonly settings: StudioSettings,
        private readonly algorithm: IScheduler,
        private readonly postponed: IBuriedCards,
        private readonly histogram: DueDateHistogram,
        private readonly reviewLog: IReviewLogSink | null = null,
        private readonly dailyLimits: DailyLimits | null = null,
        private readonly undoHistory = new UndoHistory<UndoRecord>(),
    ) {}

    // #region -> State

    get hasCurrentCard(): boolean {
        return this.currentCard !== null;
    }

    get currentCard(): Card | null {
        return this.walker.currentReviewItem ?? null;
    }

    get currentQuestion(): Question {
        return this.currentCard?.question;
    }

    get currentNote(): Note {
        return this.currentQuestion.note;
    }

    get currentDeck(): Deck | null {
        return this.walker.currentDeck;
    }

    get originalRoot(): Deck {
        return this._originalRoot;
    }

    get hasPendingCards(): boolean {
        return this.pending.size > 0;
    }

    /** Whether a waiting card is due now. Only reads; nothing is woken. */
    get hasDuePendingCards(): boolean {
        return this.pending.hasDueBy(globalDateProvider.nowMs);
    }

    get nextPendingDueUnix(): number | null {
        return this.pending.nextDueUnix;
    }

    get canUndo(): boolean {
        return this.undoHistory.size > 0;
    }

    /** The entry the last answer logged; null when it logged none (a Reset of a new card, a note that changed). */
    get lastLoggedEntry(): ReviewLogEntry | null {
        return this._lastLoggedEntry;
    }

    // #endregion

    // #region -> Walking the decks

    /** Starts a session: cards are taken from `remainingRoot`, and nothing waits for a step yet. */
    setDeckRoot(originalRoot: Deck, remainingRoot: Deck): void {
        this.walker.setBaseDeck(remainingRoot);
        this._originalRoot = originalRoot;
        this.remainingRoot = remainingRoot;
        this.pending = new PendingCards();
        this.justAnswered = null;
        this.setCurrentDeck(TopicPath.emptyPath);
    }

    /** Reviews the deck at `topicPath` (empty: everything), starting with any waiting card that is due now. */
    setCurrentDeck(topicPath: TopicPath): void {
        this.currentTopicPath = topicPath;
        this.wakeDuePendingCards(globalDateProvider.nowMs);
        this.walker.setIteratorTopicPath(topicPath);
        this.walker.nextReviewItem();
        this.showAnotherThanJustAnswered();
        this.skipOverLimitedCards();
    }

    refreshCurrentDeck(): void {
        const here = this.currentTopicPath;
        this.setCurrentDeck(here);
    }

    /**
     * Like Anki's learn ahead limit: when no card is left, pending cards due within `limitMs` from now are shown
     * straight away instead of being waited for. Cards still in the queue always come first.
     *
     * @returns Whether there is a card to show.
     */
    learnAhead(limitMs: number): boolean {
        if (this.hasCurrentCard) return true;
        const horizon = globalDateProvider.nowMs + limitMs;
        const anyWaiting = this.pending.hasDueBy(horizon);
        if (anyWaiting) {
            this.wakeDuePendingCards(horizon);
            this.refreshCurrentDeck();
        }
        return anyWaiting && this.hasCurrentCard;
    }

    /**
     * Puts the waiting cards due by `untilUnix` back at the front of their decks, the first to fall due first, and of
     * cards due at the same time the first answered first (D2 #13).
     */
    private wakeDuePendingCards(untilUnix: number): void {
        // Prepending one by one reverses the order, so the last one due goes in first
        for (const card of [...this.pending.takeDue(untilUnix)].reverse()) {
            this.remainingRoot.prependReviewItem(card.question.topicPathList, card);
        }
    }

    /** Removes the current question from this session and moves on. Nothing is written, logged or buried. */
    skipCurrentCard(): void {
        this.walker.deleteCurrentQuestionFromAllDecks();
        this.skipOverLimitedCards();
    }

    /**
     * D3 #9: when the card just answered comes straight back while another card can be shown, the other card goes
     * first and the answered one waits behind it. Only the very next card is affected.
     */
    private showAnotherThanJustAnswered(): void {
        const answered = this.justAnswered;
        if (answered === null || !this.hasCurrentCard) return;
        this.justAnswered = null;
        if (this.currentCard !== answered) return;

        // See what the queue would give without it, then put it back exactly where it was
        const places = this.takeOutOfRemainingTree(answered);
        this.walker.setIteratorTopicPath(this.currentTopicPath);
        const another = this.walker.nextReviewItem() ? this.currentCard : null;
        for (const { list, index } of places.reverse()) list.splice(index, 0, answered);

        if (another === null || !this.walker.setCurrentReviewItem(another, this.currentTopicPath)) {
            this.walker.setIteratorTopicPath(this.currentTopicPath);
            this.walker.nextReviewItem();
        }
    }

    private takeOutOfRemainingTree(card: Card): { list: Card[]; index: number }[] {
        const places: { list: Card[]; index: number }[] = [];
        for (const deck of this.remainingRoot.toDeckArray()) {
            for (const list of [deck.newReviewItems, deck.dueReviewItems]) {
                const index = list.indexOf(card);
                if (index >= 0) {
                    list.splice(index, 1);
                    places.push({ list, index });
                }
            }
        }
        return places;
    }

    // #endregion

    // #region -> Counts

    /**
     * The counts of the deck at `topicPath`. With today's limits, the new and due counts are what the limits still
     * allow (learning cards are never limited), and the rest is reported as held back by the limit.
     */
    getDeckStats(topicPath: TopicPath): DeckStats {
        const left = this.remainingRoot.getDeck(topicPath);
        const countIn = (deck: Deck, state: ReviewItemState, withSubdecks: boolean) =>
            deck.getDistinctReviewItemCount(state, withSubdecks);

        const newLeft = countIn(left, ReviewItemState.NewItem, true);
        const dueLeft = countIn(left, ReviewItemState.DueItem, true);
        // Learning cards are never limited, so only the review-state share of the due count is capped
        const limits = this.limitsApply ? this.dailyLimits : null;
        const newCount = limits ? Math.min(newLeft, limits.remainingNew()) : newLeft;
        const dueCount = limits
            ? Math.min(dueLeft, this.countDistinctLearningCards(left) + limits.remainingReviews())
            : dueLeft;

        const newHere = countIn(left, ReviewItemState.NewItem, false);
        const dueHere = countIn(left, ReviewItemState.DueItem, false);
        const cardsHere = newHere + dueHere;
        const subDecks = this.getSubDecksWithCardsInQueue(left).length;
        return new DeckStats(
            countIn(this._originalRoot.getDeck(topicPath), ReviewItemState.AnyItem, true),
            dueCount,
            newCount,
            dueCount + newCount,
            dueHere,
            newHere,
            cardsHere,
            subDecks,
            subDecks + (cardsHere > 0 ? 1 : 0),
            newLeft - newCount,
            dueLeft - dueCount,
        );
    }

    /** The decks below `deck`, at any depth, that hold a card themselves; each deck's own subdecks come before it. */
    getSubDecksWithCardsInQueue(deck: Deck): Deck[] {
        return deck.subdecks.flatMap((sub) => {
            const deeper = this.getSubDecksWithCardsInQueue(sub);
            const holdsCards = sub.getReviewItemCount(ReviewItemState.AnyItem, false) > 0;
            return holdsCards ? [...deeper, sub] : deeper;
        });
    }

    // #endregion

    // #region -> Answering

    /** The schedule an answer would give the card. Changes nothing; the answer buttons use it for their labels. */
    determineCardSchedule(response: ReviewResponse, card: Card): ScheduleState {
        if (response === ReviewResponse.Reset) return this.algorithm.cardGetResetSchedule();
        return card.hasSchedule
            ? this.algorithm.cardCalcUpdatedSchedule(response, card.scheduleInfo, this.histogram)
            : this.algorithm.cardGetNewSchedule(
                  response,
                  card.question.note.filePath,
                  this.histogram,
              );
    }

    async processReview(response: ReviewResponse, durationMs: number = 0): Promise<void> {
        // The entry is the one this answer logs, so an answer that logs none (D2 #2) leaves none to report
        if (this.hasCurrentCard) this._lastLoggedEntry = null;
        if (this.reviewMode === FlashcardReviewMode.Review) {
            await this.processReviewReviewMode(response, durationMs);
        } else if (this.reviewMode === FlashcardReviewMode.Cram) {
            const answered = this.currentCard;
            this.processReviewCramMode(response);
            const entry = buildReviewLogEntry(
                answered,
                response,
                answered.scheduleInfo,
                durationMs,
                true,
                globalDateProvider.nowMs,
            );
            await this.appendToReviewLog(entry);
        }
        this.skipOverLimitedCards();
    }

    /** Easy takes the card out of the cram session; any other answer sends it to the back. Nothing is rescheduled. */
    processReviewCramMode(response: ReviewResponse): void {
        this.justAnswered = this.currentCard;
        if (response === ReviewResponse.Easy) this.walker.deleteCurrentReviewItemFromAllDecks();
        else this.sendCurrentCardToBack();
        this.showAnotherThanJustAnswered();
    }

    /**
     * Reschedules the current card and writes it to its note; then the card histogram, the review log, today's limits
     * and the undo history follow, in that order. A Reset of a card never reviewed changes nothing. When the note no
     * longer holds the question as it was read, nothing is saved or recorded (D2 #2).
     */
    async processReviewReviewMode(response: ReviewResponse, durationMs: number = 0): Promise<void> {
        const card: Card = this.currentCard;
        const oldSchedule = card.scheduleInfo;
        const question: Question = card.question;

        let requeue: Requeue = "immediate";
        let removeFromSession = false;
        if (response !== ReviewResponse.Reset || oldSchedule !== null) {
            const prevMeta: CardMeta = cloneCardMeta(card.meta);
            const preAnswerText: string = question.questionText.original;
            const wasPostponed: boolean = this.postponed.includes(question);

            card.scheduleInfo = this.determineCardSchedule(response, card);
            const leech: boolean = this.markLeech(response, oldSchedule, card);
            removeFromSession = card.meta.suspended;
            requeue = removeFromSession ? "none" : requeueOf(card.scheduleInfo);

            if (!(await DataStore.getInstance().writeSchedule(question))) {
                // The question's text is stale, so later answers could not be saved either: it leaves this session
                card.scheduleInfo = oldSchedule;
                card.meta = prevMeta;
                new Notice(t("ANSWER_NOT_SAVED_NOTE_CHANGED"));
                this.walker.deleteCurrentQuestionFromAllDecks();
                return;
            }

            const nowMs = globalDateProvider.nowMs;
            const todayMs = globalDateProvider.today.valueOf();
            // A schedule without a due time (a learning step written as "-") has no day to count
            const dayKey = (schedule: ScheduleState | null): number | null =>
                schedule?.dueDate?.isValid() ? cardDueDayKey(schedule, nowMs, todayMs) : null;
            const histogramDecrementKey = dayKey(oldSchedule);
            const histogramIncrementKey = dayKey(card.scheduleInfo);
            if (histogramDecrementKey !== null) {
                this.histogram.decrement(histogramDecrementKey);
            }
            if (histogramIncrementKey !== null) {
                this.histogram.increment(histogramIncrementKey);
            }

            // Built after the write, which gives a card its id
            const entry = buildReviewLogEntry(
                card,
                response,
                oldSchedule,
                durationMs,
                false,
                nowMs,
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
                const lapses = (card.scheduleInfo as FsrsState).lapses;
                new Notice(
                    t(card.meta.suspended ? "LEECH_SUSPENDED" : "LEECH_TAGGED", {
                        lapses,
                    }),
                );
            }
        }

        await this.requeueAnsweredCard(response, requeue, removeFromSession);
    }

    /** Where the answered card, still current, goes next; see `requeueOf`. */
    private async requeueAnsweredCard(
        response: ReviewResponse,
        requeue: Requeue,
        removeFromSession: boolean,
    ): Promise<void> {
        const card = this.currentCard;
        this.justAnswered = card;
        if (removeFromSession) {
            // A leech that was just suspended: its siblings stay
            this.walker.deleteCurrentReviewItemFromAllDecks();
        } else if (requeue === "pending") {
            const dueUnix = card.scheduleInfo.dueDate ? card.scheduleInfo.dueDateAsUnix : NaN;
            await this.removeAnsweredCard();
            this.pending.push(card, dueUnix);
        } else if (requeue === "immediate" || response === ReviewResponse.Reset) {
            if (this.settings.burySiblingCards) {
                await this.burySiblings(card.question);
                for (const sibling of card.question.cards) {
                    if (sibling !== card) this.remainingRoot.deleteCardFromAllDecks(sibling, false);
                }
            }
            this.sendCurrentCardToBack();
        } else {
            await this.removeAnsweredCard();
        }
        this.showAnotherThanJustAnswered();
    }

    /** Takes the current card out of the session; with `burySiblingCards`, its whole question, burying the siblings. */
    private async removeAnsweredCard(): Promise<void> {
        if (this.settings.burySiblingCards) {
            await this.burySiblings(this.currentQuestion);
            this.walker.deleteCurrentQuestionFromAllDecks();
        } else {
            this.walker.deleteCurrentReviewItemFromAllDecks();
        }
    }

    private sendCurrentCardToBack(): void {
        this.walker.moveCurrentReviewItemToEndOfList();
        this.walker.nextReviewItem();
    }

    /**
     * Hides the question's other cards for the rest of the day, also in later sessions. A question with one card in the
     * current deck is left alone, as in the original plugin.
     */
    private async burySiblings(question: Question): Promise<void> {
        if (this.currentDeck.getQuestionReviewItemCount(question) > 1) {
            this.postponed.add(question);
            await this.postponed.write();
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
        oldSchedule: ScheduleState | null,
        card: Card,
    ): boolean {
        const threshold: number = this.settings.leechThreshold;
        const schedule = card.scheduleInfo;
        if (
            response !== ReviewResponse.Again ||
            !threshold ||
            threshold <= 0 ||
            !(oldSchedule instanceof FsrsState) ||
            oldSchedule.state !== State.Review ||
            !(schedule instanceof FsrsState)
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

    // #endregion

    // #region -> Editing the note

    /**
     * Saves an edit of the current question's text (without its deck tag) and redraws its cards. An edit that changes
     * how many cards the question makes is refused before anything is written (D2 #22): the session's cards and their
     * schedules would no longer match the note.
     */
    async updateCurrentQuestionTextAndCards(text: string): Promise<void> {
        const { currentQuestion: question, settings } = this;
        const sides = CardFrontBackUtil.expand(question.questionType, text, settings);
        if (sides.length !== question.cards.length) {
            new Notice(t("EDIT_CHANGES_CARD_COUNT"));
            return;
        }

        const previousText = question.questionText.actualQuestion;
        question.questionText.actualQuestion = text;
        if (!(await question.writeQuestion(this.settings))) {
            question.questionText.actualQuestion = previousText;
            new Notice(t("CHANGE_NOT_SAVED_NOTE_CHANGED"));
            return;
        }
        sides.forEach((side, index) => {
            question.cards[index].front = side.front;
            question.cards[index].back = side.back;
        });
    }

    /** Deletes the current question from its note and from this session, with any of its cards waiting for a step. */
    async deleteCurrentCardFromNote(): Promise<boolean> {
        const question = this.currentQuestion;
        if (!(await DataStore.getInstance().delete(question))) {
            new Notice(t("CHANGE_NOT_SAVED_NOTE_CHANGED"));
            return false;
        }
        this._originalRoot.deleteQuestionFromAllDecks(question, false);
        this.walker.deleteCurrentQuestionFromAllDecks();
        // D2 #7: a waiting card would come back with its text gone from the note
        this.pending.removeWhere((card) => card.question === question);
        this.skipOverLimitedCards();
        return true;
    }

    // #endregion

    // #region -> Undo, suspend, bury, flag

    /**
     * Reverts the most recent answer: the note, the review log, today's limits, the histogram, the buried siblings and,
     * when the answer was given in this session, the queue. When the note changed since the answer nothing is touched.
     */
    async undoLastAnswer(): Promise<UndoResult> {
        const record = this.undoHistory.pop();
        if (!record) return UndoResult.Nothing;

        const { card, question } = record;
        // Put back the exact text the question had before the answer, so undo leaves no trace in the note
        const restored =
            question.questionText.original === record.postAnswerText &&
            (await question.replaceOriginalText(record.preAnswerText));
        if (!restored) {
            new Notice(t("UNDO_FAILED_NOTE_CHANGED"));
            return UndoResult.Failed;
        }

        // D5b: the list knows the question by the text it has after the answer, so this comes before the text goes back
        if (!record.wasPostponed && this.postponed.includes(question)) {
            this.postponed.remove(question);
            await this.postponed.write();
        }
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

        if (record.histogramIncrementKey !== null) {
            this.histogram.decrement(record.histogramIncrementKey);
        }
        if (record.histogramDecrementKey !== null) {
            this.histogram.increment(record.histogramDecrementKey);
        }

        // An answer from an earlier session refers to cards that are no longer in this queue
        if (record.owner !== this) return UndoResult.NeedsReload;

        this.justAnswered = null;
        this.pending.removeWhere((waiting) => waiting === card);
        this.remainingRoot.deleteCardFromAllDecks(card, false);
        this.remainingRoot.prependReviewItem(question.topicPathList, card);
        if (!this.walker.setCurrentReviewItem(card, this.currentTopicPath)) {
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
        const card = this.currentCard;
        const previous = cloneCardMeta(card.meta);
        mutate(card.meta);
        if (!(await DataStore.getInstance().writeSchedule(card.question))) {
            card.meta = previous;
            new Notice(t("CHANGE_NOT_SAVED_NOTE_CHANGED"));
            return;
        }
        if (removeFromSession) {
            this.walker.deleteCurrentReviewItemFromAllDecks();
            this.skipOverLimitedCards();
        }
    }

    // #endregion

    // #region -> Daily limits

    private get limitsApply(): boolean {
        return this.dailyLimits !== null && this.reviewMode === FlashcardReviewMode.Review;
    }

    /**
     * A review card spends the review allowance, unless it already did today (an SM-2 card answered Again stays due).
     * New, learning and relearning cards never do (D2 #4).
     */
    private isLimitedByReviewAllowance(card: Card): boolean {
        return isReviewCard(card.scheduleInfo) && !this.dailyLimits.countedToday(card.meta.id);
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
            this.walker.deleteCurrentReviewItemFromAllDecks();
        }
    }

    private countDistinctLearningCards(deck: Deck): number {
        const learning = new Set<Card>();
        const visit = (current: Deck): void => {
            for (const card of current.dueReviewItems) {
                if (!card.isNew && !this.isLimitedByReviewAllowance(card)) learning.add(card);
            }
            current.subdecks.forEach(visit);
        };
        visit(deck);
        return learning.size;
    }

    // #endregion
}

/** What the dialog for removing the current card says: removing one card of several removes the whole question. */
export function removalConfirmation(question: Question): string {
    const count = question.cards.length;
    return count > 1 ? t("DELETE_QUESTION_CONFIRMATION", { count }) : t("DELETE_CARD_CONFIRMATION");
}
