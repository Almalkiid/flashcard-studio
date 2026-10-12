import { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import { Deck } from "src/data/decks/deck";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

export type Status = "new" | "due" | "future";

/** A question that lists these deck tags (a tag-less list puts the card in the deck it is appended to). */
export function questionFor(tags: string[]): Question {
    const list = tags.map((tag) => TopicPath.getTopicPathFromTag(tag));
    return { topicPathList: new TopicPathList(list), cards: [] } as unknown as Question;
}

export function makeCard(
    front: string,
    tags: string[] = [],
    status: Status = "new",
    question: Question = questionFor(tags),
): Card {
    const schedule = status === "new" ? null : ({ isDue: () => status === "due" } as ScheduleState);
    const card = new Card({ front, back: "", question, scheduleInfo: schedule });
    question.cards.push(card);
    return card;
}

/** Puts every card into the decks its question names. */
export function treeOf(...cards: Card[]): Deck {
    const root = new Deck("root", null);
    for (const card of cards) root.appendReviewItem(card.question.topicPathList, card);
    return root;
}

const label = (card: Card): string =>
    card.front + (card.isNew ? "" : card.isDue ? " [due]" : " [scheduled-not-due]");

export interface Snapshot {
    name: string;
    new: string[];
    due: string[];
    sub: Snapshot[];
}

/** The golden files' tree shape. */
export function snapshot(deck: Deck): Snapshot {
    return {
        name: deck.deckName,
        new: deck.newReviewItems.map(label),
        due: deck.dueReviewItems.map(label),
        sub: deck.subdecks.map(snapshot),
    };
}
