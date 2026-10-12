import { Card } from "src/data/data-structures/card/flashcard";
import { Question } from "src/data/data-structures/card/question";
import { Deck } from "src/data/decks/deck";
import { Note } from "src/note-review/note";
import { DeckStats } from "src/scheduling/review/deck-stats";

/** Which side of the card the screen shows. */
export enum CardState {
    Front,
    Back,
    Closed,
}

export interface CardData {
    currentCard: Card | null;
    cardState: CardState;
}

export interface DeckData {
    chosenDeck: Deck;
    currentDeck: Deck;
    previousDeck: Deck | null;
    /** How many cards the current deck had in its queue when it came up. */
    currentDeckTotalCardsInQueue: number;
    chosenDeckStats: DeckStats;
    currentDeckStats: DeckStats;
    previousDeckStats: DeckStats | null;
}

/** What the card screen needs to draw the card that is up, and where the session stands. */
export interface SessionData {
    cardData: CardData;
    deckData: DeckData;
    totalCardsInSession: number;
    totalDecksInSession: number;
    currentQuestion: Question;
    currentNote: Note;
}
