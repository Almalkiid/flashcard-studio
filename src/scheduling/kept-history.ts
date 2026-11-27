import { DataStoreAlgorithm } from "src/data/data-store/store";
import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";

/** A question whose schedule comment keeps the history of card numbers no card uses any more. */
export interface KeptHistory {
    question: Question;
    numbers: number[];
}

/** The questions of some cards that keep the history of removed card numbers, each once, with those numbers. */
export function keptHistories(cards: Card[]): KeptHistory[] {
    const result: KeptHistory[] = [];
    const seen = new Set<Question>();
    for (const { question } of cards) {
        if (seen.has(question)) continue;
        seen.add(question);
        const numbers = DataStoreAlgorithm.getInstance()
            .keptSegments(question)
            .map(({ number }) => number);
        if (numbers.length > 0) result.push({ question, numbers });
    }
    return result;
}

/**
 * Removes the kept history of removed card numbers from each question (Anki: "Empty Cards"), in one write of the
 * question as a review writes it, with that history left out. A question whose write fails (its note changed since it
 * was read, or the write threw) is left as it is and counted.
 */
export async function removeKeptHistories(
    questions: Question[],
    settings: StudioSettings,
): Promise<{ done: number; failed: number }> {
    let done = 0;
    let failed = 0;
    for (const question of questions) {
        // A question with a second schedule comment (two cards' lines with no blank line between them) is written
        // with only its first one: removing the history could drop the other's schedules, so it is left as it is
        if ((question.questionText.original.match(/<!--SR:/g) ?? []).length > 1) {
            failed++;
            continue;
        }
        let written = false;
        question.keepRemovedHistory = false;
        try {
            written = await question.writeQuestion(settings);
        } catch (error) {
            console.error(
                "Flashcard Studio: the history of removed cards could not be removed",
                error,
            );
        } finally {
            question.keepRemovedHistory = true;
        }
        if (written) done++;
        else failed++;
    }
    return { done, failed };
}
