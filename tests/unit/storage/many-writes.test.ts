import { ParsedQuestionInfo } from "src/cards/parse";
import { Note } from "src/note-review/note";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

import { Card, CardType, Question, QuestionText } from "./api";
import { settingsWith, setUp } from "./helpers";

// A note with many cards, written in an order that is not the order of the note: every write has to find its card
// after the writes before it moved the lines, and has to do so without looking at the whole note again.

const settings = settingsWith();
const COUNT = 2000;

function noteOf(count: number): { text: string; note: Note } {
    const lines = ["#flashcards"];
    const questions: Question[] = [];
    for (let i = 0; i < count; i++) {
        const text = `Q${i}::A${i}`;
        lines.push(text);
        const question = new Question({
            parsedQuestionInfo: new ParsedQuestionInfo(
                CardType.SingleLineBasic,
                text,
                i + 1,
                i + 1,
            ),
            questionText: QuestionText.create(text, 1, settings),
        });
        question.setCardList([
            new Card({
                cardIdx: 0,
                scheduleInfo: new Sm2State(moment("2026-11-01", "YYYY-MM-DD"), i + 1, 250),
            }),
        ]);
        questions.push(question);
    }
    return { text: lines.join("\n"), note: new Note(undefined, questions) };
}

test("every card of a big note gets its own comment, whatever the order of the writes", () => {
    setUp(settings);
    const { text, note } = noteOf(COUNT);
    // A fixed shuffle: 7 is coprime with the count, so every card is visited once
    const order = Array.from({ length: COUNT }, (_, i) => (i * 7) % COUNT);

    const started = performance.now();
    let current = text;
    for (const index of order) {
        const next = note.questionList[index].rewriteWithinNoteText(current, settings);
        expect(next).not.toBeNull();
        current = next;
    }
    const took = performance.now() - started;

    const lines = current.split("\n");
    expect(lines).toHaveLength(1 + 2 * COUNT);
    expect(lines[0]).toBe("#flashcards");
    for (let i = 0; i < COUNT; i++) {
        expect(lines[1 + 2 * i]).toBe(`Q${i}::A${i}`);
        expect(lines[2 + 2 * i]).toMatch(
            new RegExp(`^<!--SR:!2026-11-01,${i + 1},250,id=[0-9a-z]{6}-->$`),
        );
    }
    // 2000 writes into a 4000-line note take well under a second; the bound only catches a write that reads every line
    expect(took).toBeLessThan(5000);
});
