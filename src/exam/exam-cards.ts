import { Card } from "src/data/data-structures/card/card";
import { CardType } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { ExamCardInput } from "src/exam/exam";
import { cardKey } from "src/scheduling/custom-study";

/**
 * Every card of the deck tree, for an exam to pick its questions from: once for each deck the card is in, under the
 * same id. The id is the card's own, or, for a card never answered yet, the key custom study uses, so "Study the ones
 * I missed" finds the same cards again.
 */
export function collectExamCards(tree: Deck): ExamCardInput[] {
    const cards: ExamCardInput[] = [];
    for (const deck of tree.toDeckArray()) {
        const path = deck.getTopicPath().path.join("/");
        for (const item of [...deck.newRepItems, ...deck.dueRepItems]) {
            if (!(item instanceof Card)) continue;
            cards.push({
                id: cardKey(item),
                deck: path,
                front: item.front,
                back: item.back,
                isCloze: item.question.questionType === CardType.Cloze,
                suspended: item.meta.suspended,
                sourcePath: item.question.note?.filePath ?? "",
            });
        }
    }
    return cards;
}
