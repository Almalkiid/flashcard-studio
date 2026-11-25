import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import type { Deck } from "src/data/decks/deck";
import { isInDeck } from "src/scheduling/custom-study";
import { ReviewItemState } from "src/scheduling/schedule/review-item";

/** Every suspended card of a deck hierarchy, each once however many decks it is in. */
export function suspendedCards(root: Deck): Card[] {
    const cards = root.getFlattenedReviewItemArray(ReviewItemState.AnyItem, true);
    return [...new Set(cards)].filter((card) => card.meta.suspended);
}

/**
 * The cards whose front, back or note path contains the query (as plain text, any case), in the deck (or a subdeck of
 * it). An empty query or deck does not filter.
 */
export function filterSuspended(cards: Card[], query: string, deckPath: string): Card[] {
    const wanted = query.trim().toLowerCase();
    return cards.filter((card) => {
        if (deckPath !== "" && !isInDeck(card, deckPath)) return false;
        if (wanted === "") return true;
        return [card.front, card.back, card.question.note.filePath].some((text) =>
            text.toLowerCase().includes(wanted),
        );
    });
}

/** The cards by question, so each question is written once. */
export function groupByQuestion(cards: Card[]): Map<Question, Card[]> {
    const groups = new Map<Question, Card[]>();
    for (const card of cards) {
        const group = groups.get(card.question);
        if (group === undefined) groups.set(card.question, [card]);
        else group.push(card);
    }
    return groups;
}
