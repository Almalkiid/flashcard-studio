import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import type { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import type { ReviewOrder } from "src/data/settings-model";
import { globalDateProvider } from "src/utils/clock";

/** The numbers are part of the contract; the settings store the names. */
export enum PickOrder {
    NewFirstSequential,
    NewFirstRandom,
    DueFirstSequential,
    DueFirstRandom,
    EveryCardRandomDeckAndCard,
}

export enum DeckOrder {
    PrevDeckComplete_Sequential,
    PrevDeckComplete_Random,
}

export interface IIteratorOrder {
    pickOrder: PickOrder;
    deckOrder: DeckOrder;
    /** `mostAtRisk` puts the due cards the user is most likely to have forgotten first. Needs `riskOf`. */
    reviewOrder?: ReviewOrder;
    /** How likely a due card is to be remembered, lower is more at risk (see `createCardRisk`). */
    riskOf?: (card: Card) => number;
    /** What the random orders are shuffled by; the study day when left out, so an order lasts one day. */
    daySalt?: string;
}

/** What the review session needs from the walk through a deck hierarchy. */
export interface IDeckWalker {
    get currentDeck(): Deck | null;
    get currentReviewItem(): Card | null;
    get hasCurrentCard(): boolean;
    setBaseDeck(baseDeck: Deck): void;
    setIteratorTopicPath(topicPath: TopicPath): void;
    nextReviewItem(): boolean;
    deleteCurrentReviewItemFromAllDecks(): boolean;
    deleteCurrentQuestionFromAllDecks(): boolean;
    moveCurrentReviewItemToEndOfList(): void;
    /**
     * Makes a card of the base tree current, e.g. one that undo just put back, and carries on from its deck.
     *
     * @returns Whether the card was found under the topic path; if not, nothing is current.
     */
    setCurrentReviewItem(reviewItem: Card, topicPath: TopicPath): boolean;
}

/**
 * cyrb53's mixing (bryc, public domain; see THIRD-PARTY-NOTICES.md) as a number. It is the value `cyrb53` in
 * `src/utils/hash.ts` writes as hex text; building that text is what costs, and a shuffle of 50,000 cards needs only
 * the number.
 */
export function shuffleKey(text: string): number {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const sameNames = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((name, i) => name === b[i]);

type ListKind = "new" | "due";

/** A list of a visited deck, with the card that was its first when the entry was made. */
interface HeadEntry {
    card: Card;
    deckIdx: number;
    kind: ListKind;
    list: Card[];
}

/**
 * Walks the cards of a deck hierarchy, one at a time, in the configured order. The tree is the session's: the card shown
 * is taken out of every deck when the next one is asked for, and the lists are put in the order of the setting once,
 * when the tree is set. Random orders are a shuffle fixed by the study day, so a card list is the same all day.
 *
 * The walk reads the live lists, so cards that are put at the front (a waiting card that woke up, an undone answer)
 * come next, and cards that are removed behind its back are never offered. After changing the tree like that, call
 * `setIteratorTopicPath` or `setCurrentReviewItem` again to start from the first deck.
 */
export class DeckWalker implements IDeckWalker {
    private readonly order: IIteratorOrder;
    private readonly salt: string;
    private readonly hashes = new Map<Card, number>();
    private readonly risks = new Map<Card, number>();
    private base: Deck | null = null;
    /** The decks of the chosen subtree in the order they are visited; null until a topic path was set. */
    private visit: Deck[] | null = null;
    /** Where in `visit` the walk is; -1 when it has not started. */
    private deckIdx = -1;
    private current: Card | null = null;
    /** For the any-card order: the first card of each list of the visited decks, best first. Null when out of date. */
    private heads: HeadEntry[] | null = null;
    /** The list the shown card was taken from, whose next card goes into `heads`. */
    private drawnList: HeadEntry | null = null;
    private readonly deckNames = new WeakMap<Deck, string[]>();

    constructor(order: IIteratorOrder, baseDeck: Deck | null) {
        this.order = order;
        this.salt = order.daySalt ?? globalDateProvider.today.format("YYYY-MM-DD");
        if (baseDeck !== null) this.setBaseDeck(baseDeck);
    }

    // #region -> State

    get hasCurrentCard(): boolean {
        return this.current !== null;
    }

    get currentReviewItem(): Card | null {
        return this.current;
    }

    get currentQuestion(): Question | null {
        return this.current?.question ?? null;
    }

    /** The deck being walked; it stays after the card in it was taken (moved to the end, say). */
    get currentDeck(): Deck | null {
        return this.visit !== null && this.deckIdx >= 0 ? this.visit[this.deckIdx] : null;
    }

    private get isEveryCard(): boolean {
        return this.order.pickOrder === PickOrder.EveryCardRandomDeckAndCard;
    }

    // #endregion

    // #region -> Setting up

    /** Starts over on another tree: nothing is current and no deck is chosen. */
    setBaseDeck(baseDeck: Deck): void {
        this.base = baseDeck;
        this.visit = null;
        this.deckIdx = -1;
        this.current = null;
        this.heads = null;
        this.risks.clear();
        this.arrangeLists(baseDeck);
    }

    /** Chooses the deck at the path and everything below it (empty path: all), to be walked from its first deck. */
    setIteratorTopicPath(topicPath: TopicPath): void {
        this.current = null;
        this.deckIdx = -1;
        this.heads = null;
        const root = this.base?.getDeck(topicPath) ?? null;
        const decks = root === null ? [] : root.toDeckArray();
        this.visit =
            this.order.deckOrder === DeckOrder.PrevDeckComplete_Random
                ? this.shuffled(decks)
                : decks;
    }

    /** Puts every list in the order the settings ask for, once; the walk then takes the first card of a list. */
    private arrangeLists(tree: Deck): void {
        const atRisk = this.order.reviewOrder === "mostAtRisk" && this.order.riskOf !== undefined;
        const shuffle =
            this.order.pickOrder === PickOrder.NewFirstRandom ||
            this.order.pickOrder === PickOrder.DueFirstRandom ||
            this.isEveryCard;
        if (!atRisk && !shuffle) return;

        for (const deck of tree.toDeckArray()) {
            if (shuffle) this.sortByKey(deck.newReviewItems, (card) => this.hashOf(card));
            if (atRisk) this.sortDueByRisk(deck.dueReviewItems);
            else if (shuffle) this.sortByKey(deck.dueReviewItems, (card) => this.hashOf(card));
        }
    }

    private sortDueByRisk(list: Card[]): void {
        this.sortByKey(
            list,
            (card) => this.riskOfCard(card),
            (card) => this.hashOf(card),
        );
    }

    /** Stable ascending sort by one key, then the other; each key is worked out once per card. */
    private sortByKey(
        list: Card[],
        key: (card: Card) => number,
        tieBreak: (card: Card) => number = () => 0,
    ): void {
        if (list.length < 2) return;
        const keyed = list.map((card) => ({ card, a: key(card), b: tieBreak(card) }));
        keyed.sort((x, y) => x.a - y.a || x.b - y.b);
        keyed.forEach((entry, i) => (list[i] = entry.card));
    }

    private hashOf(card: Card): number {
        let hash = this.hashes.get(card);
        if (hash === undefined) {
            const id = card.meta.id ?? `${card.front}\u0001${card.back}\u0001${card.cardIdx}`;
            hash = shuffleKey(`${this.salt}|${id}`);
            this.hashes.set(card, hash);
        }
        return hash;
    }

    private riskOfCard(card: Card): number {
        let risk = this.risks.get(card);
        if (risk === undefined) {
            risk = this.order.riskOf(card);
            if (Number.isNaN(risk)) risk = Infinity;
            this.risks.set(card, risk);
        }
        return risk;
    }

    private shuffled(decks: Deck[]): Deck[] {
        const keyed = decks.map((deck) => ({
            deck,
            key: shuffleKey(`${this.salt}|deck|${this.namesOf(deck).join("/")}`),
        }));
        return keyed.sort((x, y) => x.key - y.key).map((entry) => entry.deck);
    }

    // #endregion

    // #region -> Walking

    /**
     * Takes the card shown last out of the decks and makes the next one current.
     *
     * @returns False when no card is left; the next call then starts again from the first deck.
     */
    nextReviewItem(): boolean {
        if (this.base === null) return false;
        if (this.visit === null) this.setIteratorTopicPath(TopicPath.emptyPath);
        if (this.current !== null) {
            this.takeOut(this.current);
            this.current = null;
        }
        if (!this.isEveryCard) return this.pickFromNextDeck();
        this.heads ??= this.collectHeads();
        const drawn = this.drawnList;
        this.drawnList = null;
        if (drawn !== null && drawn.list.length > 0) {
            this.pushHead({ ...drawn, card: drawn.list[0] });
        }
        return this.pickFromAnyDeck();
    }

    private pickFromNextDeck(): boolean {
        const decks = this.visit;
        if (this.deckIdx < 0) this.deckIdx = 0;
        for (; this.deckIdx < decks.length; this.deckIdx++) {
            const card = this.firstCardOf(decks[this.deckIdx]);
            if (card !== null) {
                this.current = card;
                return true;
            }
        }
        this.deckIdx = -1;
        return false;
    }

    /** The first card of the list the order prefers, else of the other. An unknown order has no cards. */
    private firstCardOf(deck: Deck): Card | null {
        switch (this.order.pickOrder) {
            case PickOrder.NewFirstSequential:
            case PickOrder.NewFirstRandom:
                return deck.newReviewItems[0] ?? deck.dueReviewItems[0] ?? null;
            case PickOrder.DueFirstSequential:
            case PickOrder.DueFirstRandom:
                return deck.dueReviewItems[0] ?? deck.newReviewItems[0] ?? null;
            default:
                return null;
        }
    }

    /** Every list is in order, so the best card is the best of the first cards of the lists. */
    private collectHeads(): HeadEntry[] {
        this.heads = [];
        this.drawnList = null;
        this.visit.forEach((deck, deckIdx) => {
            for (const kind of ["new", "due"] as const) {
                const list = kind === "new" ? deck.newReviewItems : deck.dueReviewItems;
                if (list.length > 0) this.pushHead({ card: list[0], deckIdx, kind, list });
            }
        });
        return this.heads;
    }

    private pickFromAnyDeck(): boolean {
        const heads = this.heads;
        while (heads.length > 0) {
            const best = this.popHead();
            const first = best.list[0];
            if (first === best.card) {
                this.drawnList = best;
                this.deckIdx = best.deckIdx;
                this.current = first;
                return true;
            }
            // The list changed since the entry was made (its card went elsewhere): it counts again with its new first card
            if (first !== undefined) this.pushHead({ ...best, card: first });
        }
        this.deckIdx = -1;
        this.heads = null;
        return false;
    }

    // A binary min-heap on `comesBefore`
    private pushHead(entry: HeadEntry): void {
        const heap = this.heads;
        heap.push(entry);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (!this.entryBefore(heap[i], heap[parent])) break;
            [heap[i], heap[parent]] = [heap[parent], heap[i]];
            i = parent;
        }
    }

    private popHead(): HeadEntry {
        const heap = this.heads;
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < heap.length && this.entryBefore(heap[left], heap[smallest]))
                    smallest = left;
                if (right < heap.length && this.entryBefore(heap[right], heap[smallest]))
                    smallest = right;
                if (smallest === i) break;
                [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
                i = smallest;
            }
        }
        return top;
    }

    private entryBefore(a: HeadEntry, b: HeadEntry): boolean {
        return this.comesBefore(a.card, a.kind, b.card, b.kind);
    }

    private comesBefore(a: Card, aKind: ListKind, b: Card, bKind: ListKind): boolean {
        if (this.order.reviewOrder === "mostAtRisk" && this.order.riskOf !== undefined) {
            if (aKind !== bKind) return aKind === "due";
            if (aKind === "due") {
                const byRisk = this.riskOfCard(a) - this.riskOfCard(b);
                if (byRisk !== 0) return byRisk < 0;
            }
        }
        return this.hashOf(a) < this.hashOf(b);
    }

    setCurrentReviewItem(reviewItem: Card, topicPath: TopicPath): boolean {
        this.setIteratorTopicPath(topicPath);
        const decks = this.visit;
        for (let i = 0; i < decks.length; i++) {
            if (
                decks[i].newReviewItems.includes(reviewItem) ||
                decks[i].dueReviewItems.includes(reviewItem)
            ) {
                this.deckIdx = i;
                this.current = reviewItem;
                return true;
            }
        }
        return false;
    }

    // #endregion

    // #region -> Taking cards out

    /**
     * Removes the shown card from every deck and returns the next one. Throws when no card is shown, or when a deck
     * its question names does not have it.
     */
    deleteCurrentReviewItemFromAllDecks(): boolean {
        this.base.deleteCardFromAllDecks(this.shown(), true);
        return this.nextReviewItem();
    }

    /** Removes every card of the shown card's question from every deck and returns the next one. */
    deleteCurrentQuestionFromAllDecks(): boolean {
        for (const sibling of this.shown().question.cards) this.takeOut(sibling);
        return this.nextReviewItem();
    }

    private shown(): Card {
        if (this.current === null) throw new Error("no current card");
        return this.current;
    }

    /**
     * Puts the shown card at the end of its list in the deck being walked, in the list its state now belongs to (an
     * answered new card moves to the due list). Other decks keep their copy. Nothing is current afterwards.
     */
    moveCurrentReviewItemToEndOfList(): void {
        const card = this.shown();
        const deck = this.currentDeck;
        deck.deleteCardFromThisDeck(card, false);
        deck.listOf(card.reviewItemState).push(card);
        this.current = null;
    }

    /**
     * Removes a card from the deck it was drawn from and from every deck its question names. The drawn deck is
     * emptied of it first, which is cheap as it is the head of the list.
     */
    private takeOut(card: Card): void {
        const drawnFrom = this.currentDeck;
        drawnFrom?.deleteCardFromThisDeck(card, false);
        // The deck it was drawn from is known to be done; looking the other decks up is the costly part
        let drawnNames = drawnFrom === null ? null : this.namesOf(drawnFrom);
        for (const path of card.question.topicPathList.list) {
            if (drawnNames !== null && sameNames(path.path, drawnNames)) {
                drawnNames = null;
                continue;
            }
            const deck = this.base.getDeck(path);
            if (deck !== null && deck !== drawnFrom) deck.deleteCardFromThisDeck(card, false);
        }
    }

    private namesOf(deck: Deck): string[] {
        let names = this.deckNames.get(deck);
        if (names === undefined) {
            names = deck.getTopicPath().path;
            this.deckNames.set(deck, names);
        }
        return names;
    }

    // #endregion
}
