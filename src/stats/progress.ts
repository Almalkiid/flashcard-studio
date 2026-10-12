import { deckMatches } from "src/stats/scope";
import { MATURE_INTERVAL_DAYS, StatsCard } from "src/stats/types";

/** How far a deck has come: its cards, the ones studied at least once, and the mastered (mature) ones. */
export interface DeckProgress {
    /** The deck path (`CIA/Part1`); empty for every deck. */
    deck: string;
    total: number;
    /** Cards that are no longer new. */
    seen: number;
    /** Review cards with an interval of at least `MATURE_INTERVAL_DAYS`, Anki's mature cards. */
    mastered: number;
}

/**
 * The direct subdecks of a deck, in the order the decks are listed; the top-level decks for the empty scope. A deck
 * known only through its subdecks (`CIA` from `CIA/Part1`) counts too.
 */
export function childDecks(decks: string[], scope: string): string[] {
    const depth = scope === "" ? 0 : scope.split("/").length;
    const children: string[] = [];
    for (const deck of decks) {
        if (scope !== "" && !deck.startsWith(scope + "/")) continue;
        const parts = deck.split("/");
        if (parts.length <= depth) continue;
        const child = parts.slice(0, depth + 1).join("/");
        if (!children.includes(child)) children.push(child);
    }
    return children;
}

/**
 * The progress of a deck and its subdecks. A suspended or buried card counts by what was learnt, since pausing a card
 * does not unlearn it.
 */
export function deckProgress(cards: StatsCard[], deck: string): DeckProgress {
    const progress: DeckProgress = { deck, total: 0, seen: 0, mastered: 0 };
    for (const card of cards) {
        if (!card.decks.some((cardDeck) => deckMatches(deck, cardDeck))) continue;
        progress.total++;
        if (card.state !== "new") progress.seen++;
        if (card.state === "review" && card.intervalDays >= MATURE_INTERVAL_DAYS)
            progress.mastered++;
    }
    return progress;
}

/** The progress of the scope itself and of each of its direct subdecks. */
export function progressRows(
    cards: StatsCard[],
    decks: string[],
    scope: string,
): { scope: DeckProgress; rows: DeckProgress[] } {
    return {
        scope: deckProgress(cards, scope),
        rows: childDecks(decks, scope).map((child) => deckProgress(cards, child)),
    };
}
