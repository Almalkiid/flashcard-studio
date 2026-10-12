import { CardMeta, emptyCardMeta } from "src/data/card-meta";
import type { Question } from "src/data/data-structures/card/question";
import { ReviewItem, ReviewItemType } from "src/scheduling/schedule/review-item";

/**
 * One thing to answer: a question has one card, or several (a reversed card has two, a cloze has one for each deletion).
 * The cards of a question are told apart by their place, so `cardIdx` is also where the card's schedule is in the
 * comment of the question.
 */
export class Card extends ReviewItem {
    /** What the answer is, as shown on the card. */
    back = "";
    /** What is asked, as shown on the card. */
    front = "";
    /** What is stored for the card besides its schedule: id, suspended, buried, flag, leech. */
    meta: CardMeta = emptyCardMeta();
    /** The place of the card among the cards of its question, from 0. */
    cardIdx: number;
    /** The question the card was made from. */
    question: Question;

    constructor(init?: Partial<Card>) {
        super(ReviewItemType.Card, null);
        Object.assign(this, init);
    }

    /** The schedule as it is written in a note, or "New" for a card not answered yet. */
    formatSchedule(): string {
        return this.scheduleInfo?.formatScheduleAsComment() ?? "New";
    }

    toString(): string {
        return [this.front, this.back].join("::");
    }
}
