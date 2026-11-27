import { unsuspendCardsInText } from "src/data/card-meta";
import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import type { Deck } from "src/data/decks/deck";
import { positionsForEdit } from "src/data/segment-binding";
import { StudioSettings } from "src/data/settings-model";
import { imageClozeCardText } from "src/occlusion/image-cloze-view";
import { occlusionCardText } from "src/occlusion/occlusion-view";
import { isInDeck } from "src/scheduling/custom-study";
import { ReviewItemState } from "src/scheduling/schedule/review-item";

/** Every suspended card of a deck hierarchy, each once however many decks it is in. */
/**
 * A card as the suspended list shows it: an image card as its question and what it asks (its front is data), any
 * other card as its text on one line.
 */
export function suspendedCardText(card: Pick<Card, "front">): string {
    return (
        imageClozeCardText(card.front) ??
        occlusionCardText(card.front) ??
        card.front.replace(/\s+/g, " ").trim()
    );
}

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

/**
 * Unsuspends the cards in their notes, each question in one write. Only the `susp` flag of each card is taken out of
 * the question's text, so nothing else in the note can change. A question whose write fails (its note changed since it
 * was read, or the write threw) is left as it is and counted.
 *
 * @returns How many cards were unsuspended, and how many could not be.
 */
export async function unsuspendCards(
    cards: Card[],
    settings: StudioSettings,
): Promise<{ done: number; failed: number }> {
    let done = 0;
    let failed = 0;
    for (const [question, group] of groupByQuestion(cards)) {
        const original = question.questionText.original;
        // Each card's segment is found in the text being changed, by its card number when the question has them
        const positions = positionsForEdit(original, question, group, settings);
        if (positions === "unreadable") {
            failed += group.length;
            continue;
        }
        const text = unsuspendCardsInText(original, positions);
        let written = false;
        try {
            written = text === original || (await question.replaceOriginalText(text));
        } catch (error) {
            console.error("Flashcard Studio: a card could not be unsuspended", error);
        }
        if (written) {
            for (const card of group) card.meta.suspended = false;
            done += group.length;
        } else {
            failed += group.length;
        }
    }
    return { done, failed };
}
