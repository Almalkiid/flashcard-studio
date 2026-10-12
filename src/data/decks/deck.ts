import { isBuried } from "src/data/card-meta";
import type { IBuriedCards } from "src/data/data-structures/card/buried-cards";
import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { globalDateProvider } from "src/utils/clock";

/**
 * A deck: its own cards and its subdecks. Cards are in one of two lists, by their state when they were put in: no
 * schedule means new, any schedule means due (`isDue` says whether it really is). A card with several deck tags is
 * the same object in each of those decks.
 *
 * The fields are plain and are read and changed from outside (the home screen, the stats, the review session).
 */
export class Deck {
    newReviewItems: Card[] = [];
    dueReviewItems: Card[] = [];
    subdecks: Deck[] = [];

    constructor(
        public deckName: string,
        public parent: Deck | null,
    ) {}

    static get emptyDeck(): Deck {
        return new Deck("Root", null);
    }

    get isRootDeck(): boolean {
        return !this.parent;
    }

    /** The list for a state. `AnyItem` names no list. */
    listOf(state: ReviewItemState): Card[] {
        if (state === ReviewItemState.NewItem) return this.newReviewItems;
        if (state === ReviewItemState.DueItem) return this.dueReviewItems;
        throw new Error("Invalid reviewItemState");
    }

    // #region -> Counting

    /** Cards in this deck (and below). A card in several decks counts once per deck. */
    getReviewItemCount(state: ReviewItemState, includeSubdecks: boolean): number {
        let count = 0;
        if (state !== ReviewItemState.DueItem) count += this.newReviewItems.length;
        if (state !== ReviewItemState.NewItem) count += this.dueReviewItems.length;
        if (includeSubdecks) {
            for (const subdeck of this.subdecks) count += subdeck.getReviewItemCount(state, true);
        }
        return count;
    }

    /** Cards in this deck (and below), each counted once however many decks it is in. */
    getDistinctReviewItemCount(state: ReviewItemState, includeSubdecks: boolean): number {
        return new Set(this.getFlattenedReviewItemArray(state, includeSubdecks)).size;
    }

    /** A new array: own new cards, own due cards, then each subdeck's, depth first. */
    getFlattenedReviewItemArray(state: ReviewItemState, includeSubdecks: boolean): Card[] {
        const cards: Card[] = [];
        this.collectInto(cards, state, includeSubdecks);
        return cards;
    }

    private collectInto(cards: Card[], state: ReviewItemState, includeSubdecks: boolean): void {
        if (state !== ReviewItemState.DueItem) cards.push(...this.newReviewItems);
        if (state !== ReviewItemState.NewItem) cards.push(...this.dueReviewItems);
        if (includeSubdecks) {
            for (const subdeck of this.subdecks) subdeck.collectInto(cards, state, true);
        }
    }

    /** How many cards of this question are in this deck, for burying the siblings. */
    getQuestionReviewItemCount(question: Question): number {
        let count = 0;
        for (const list of [this.newReviewItems, this.dueReviewItems]) {
            for (const card of list) if (card.question === question) count++;
        }
        return count;
    }

    // #endregion

    // #region -> Finding and building decks

    /** The deck at `path` below this one (this one for the empty path), or null. Names are matched exactly. */
    getDeck(path: TopicPath): Deck | null {
        return path.path.reduce<Deck | null>(
            (deck, name) => deck?.subdecks.find((sub) => sub.deckName === name) ?? null,
            this,
        );
    }

    getDeckByTopicTag(tag: string): Deck | null {
        return this.getDeck(TopicPath.getTopicPathFromTag(tag));
    }

    /** Like `getDeck`, but missing decks are added at the end of their parent's subdecks. */
    getOrCreateDeck(path: TopicPath): Deck {
        return path.path.reduce<Deck>((deck, name) => {
            let sub = deck.subdecks.find((candidate) => candidate.deckName === name);
            if (sub === undefined) {
                sub = new Deck(name, deck);
                deck.subdecks.push(sub);
            }
            return sub;
        }, this);
    }

    /** The names from the top down, without the root; a cloned subdeck is a root. */
    getTopicPath(): TopicPath {
        if (this.parent === null) return TopicPath.emptyPath;
        return new TopicPath([...this.parent.getTopicPath().path, this.deckName]);
    }

    /** This deck and every deck below it, parents before their children. */
    toDeckArray(): Deck[] {
        return [this as Deck].concat(...this.subdecks.map((sub) => sub.toDeckArray()));
    }

    /** Orders the subdecks by name (UTF-16 code units, upper case before lower), all the way down. */
    sortSubdecksList(): void {
        const byName = (left: Deck, right: Deck) =>
            Number(left.deckName > right.deckName) - Number(left.deckName < right.deckName);
        this.subdecks.sort(byName);
        this.subdecks.forEach((subdeck) => subdeck.sortSubdecksList());
    }

    // #endregion

    // #region -> Adding and removing cards

    /** Puts the card into the deck of each path, or into this deck when the list is empty. */
    appendReviewItem(topicPathList: TopicPathList, card: Card): void {
        this.placeIn(topicPathList, card, "append");
    }

    /** Like `appendReviewItem` but at the front of the list. */
    prependReviewItem(topicPathList: TopicPathList, card: Card): void {
        this.placeIn(topicPathList, card, "prepend");
    }

    private placeIn(topicPathList: TopicPathList, card: Card, where: "append" | "prepend"): void {
        const targets =
            topicPathList.list.length === 0
                ? [this]
                : topicPathList.list.map((path) => this.getOrCreateDeck(path));
        for (const deck of targets) {
            const list = deck.listOf(card.reviewItemState);
            if (where === "append") list.push(card);
            else list.unshift(card);
        }
    }

    /** Removes every card of the question from every deck the question names. */
    deleteQuestionFromAllDecks(question: Question, throwIfMissing: boolean): void {
        question.cards.forEach((card) => this.deleteCardFromAllDecks(card, throwIfMissing));
    }

    /**
     * Removes the card from each deck its question names. A named deck that does not exist is skipped. A card in a
     * deck but not named by its question (no paths at all) stays.
     */
    deleteCardFromAllDecks(card: Card, throwIfMissing: boolean): void {
        for (const path of card.question.topicPathList.list) {
            this.getDeck(path)?.deleteCardFromThisDeck(card, throwIfMissing);
        }
    }

    /** Removes the card's first place in each list (a card listed twice keeps one copy). */
    deleteCardFromThisDeck(card: Card, throwIfMissing: boolean): void {
        const removed = [this.newReviewItems, this.dueReviewItems].map((list) => {
            const index = list.indexOf(card);
            return index >= 0 && list.splice(index, 1).length > 0;
        });
        if (throwIfMissing && !removed.some(Boolean)) {
            const where = `deck: ${this.deckName}`;
            throw new Error(`deleteCardFromThisDeck: Card: ${card.front} not found in ${where}`);
        }
    }

    // #endregion

    // #region -> Copying

    /** A copy of the whole tree with the same card objects. Cloning a subdeck gives a root. */
    clone(): Deck {
        return this.copyWithReviewItemFilter(() => true);
    }

    /**
     * A copy with the cards the predicate keeps (asked in order: own new, own due, then each subdeck, depth first).
     * Empty decks stay. `parent` only becomes the copy's parent pointer; its subdecks are not changed.
     */
    copyWithReviewItemFilter(predicate: (card: Card) => boolean, parent: Deck | null = null): Deck {
        const copy = new Deck(this.deckName, parent);
        copy.newReviewItems = this.newReviewItems.filter(predicate);
        copy.dueReviewItems = this.dueReviewItems.filter(predicate);
        copy.subdecks = this.subdecks.map((sub) => sub.copyWithReviewItemFilter(predicate, copy));
        return copy;
    }

    // #endregion
}

export class DeckFilter {
    /**
     * The cards a session can take: not suspended, not buried until a later day, not on the buried-cards list, and
     * (in review mode) new or due. Cram takes every other card too.
     */
    static filterForRemainingReviewItems(
        postponed: IBuriedCards,
        deckRoot: Deck,
        reviewMode: FlashcardReviewMode,
    ): Deck {
        const today = globalDateProvider.today.format("YYYY-MM-DD");
        const cramming = reviewMode === FlashcardReviewMode.Cram;
        return deckRoot.copyWithReviewItemFilter((card: Card) => {
            // Suspended and buried cards are left out of every session, including cram
            const hidden = card.meta.suspended || isBuried(card.meta, today);
            const wanted = cramming || card.isNew || card.isDue;
            return !hidden && wanted && !postponed.includes(card.question);
        });
    }
}
