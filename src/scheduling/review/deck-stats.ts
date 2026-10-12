/**
 * The counts a deck shows during a review. Cards are counted once even when they are in several decks. "In queue" counts
 * are what is left to review now; the first three include subdecks, "of this deck" ones do not.
 */
export class DeckStats {
    constructor(
        /** Every card of the deck and its subdecks, new or scheduled, reviewed already or not. */
        public totalCount: number,
        /** Due cards left, within today's review allowance. */
        public dueCount: number,
        /** New cards left, within today's new-card allowance. */
        public newCount: number,
        public cardsInQueueCount: number,
        public dueCardsInQueueOfThisDeckCount: number,
        public newCardsInQueueOfThisDeckCount: number,
        public cardsInQueueOfThisDeckCount: number,
        /** Subdecks, at any depth, holding a card left to review. */
        public subDecksInQueueOfThisDeckCount: number,
        /** Those subdecks, and this deck when it holds a card left to review itself. */
        public decksInQueueOfThisDeckCount: number,
        /** New cards left that today's new-card limit holds back (not in `newCount`). */
        public newHiddenByLimitCount = 0,
        /** Due cards left that today's review limit holds back (not in `dueCount`). */
        public dueHiddenByLimitCount = 0,
    ) {}
}
