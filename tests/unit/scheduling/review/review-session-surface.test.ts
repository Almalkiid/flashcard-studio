import { TopicPath } from "src/data/decks/topic-path";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { UndoResult } from "src/scheduling/undo-history";

import { clockAt } from "../fsrs/clock-at";
import { NOTE_PATH, Session } from "./session";

beforeEach(() => clockAt("2023-09-06T00:00:00.000Z"));

afterEach(() => jest.restoreAllMocks());

test("the current note, question and deck are those of the current card", async () => {
    const c = await Session.open("#flashcards/a A::a\n");
    expect(c.reviewSession.currentNote.filePath).toBe(NOTE_PATH);
    expect(c.reviewSession.currentQuestion.cards).toEqual([c.reviewSession.currentCard]);
    expect(c.reviewSession.currentDeck.deckName).toBe("a");
    expect(c.reviewSession.originalRoot).toBe(c.deckRoot);
});

test("undo goes on when the review log cannot remove the entry", async () => {
    const c = await Session.open("#flashcards Q1::A1\n");
    await c.reviewSession.processReview(ReviewResponse.Easy);
    jest.spyOn(c.log, "remove").mockRejectedValue(new Error("disk full"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
    expect(c.text).toBe("#flashcards Q1::A1\n");
    expect(error).toHaveBeenCalledTimes(1);
});

test("undo of a card outside the deck now reviewed puts it back and stays on that deck", async () => {
    const c = await Session.open("#flashcards/a A::a\n#flashcards/b B::b\n");
    await c.reviewSession.processReview(ReviewResponse.Easy);
    c.setCurrentDeck("#flashcards/b");
    expect(await c.reviewSession.undoLastAnswer()).toBe(UndoResult.Requeued);
    expect(c.front).toBe("B");
    c.setCurrentDeck("#flashcards/a");
    expect(c.front).toBe("A");
});

test("subdecks holding cards come deepest first, and a deck that does not exist cannot be counted", async () => {
    const c = await Session.open(
        "#flashcards/a A::a\n#flashcards/a/x X::x\n#flashcards/b B::b\n#flashcards Top::t\n",
    );
    const names = c.reviewSession
        .getSubDecksWithCardsInQueue(c.reviewSession.originalRoot)
        .map((deck) => deck.getTopicPath().path.join("/"));
    expect(names).toEqual(["flashcards/a/x", "flashcards/a", "flashcards/b", "flashcards"]);
    expect(() => c.reviewSession.getDeckStats(new TopicPath(["nowhere"]))).toThrow();
});

test("skipping removes every card of the question and logs nothing", async () => {
    const c = await Session.open("#flashcards\nQ ==a== ==b==\n\n#flashcards Q2::A2\n");
    c.reviewSession.skipCurrentCard();
    expect(c.front).toBe("Q2");
    expect(c.log.entries).toEqual([]);
});
