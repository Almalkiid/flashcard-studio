import { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { StudioSettings } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import { TextDirection } from "src/utils/text";

import { UnitTestNoteFile } from "../../support/memory-note";
import { createTestNoteQuestionParser } from "../../support/sample-decks";

/** The deck hierarchy of a note held in memory, read with the given settings (which the shared sample helpers do not take). */
export async function deckFromText(
    text: string,
    settings: StudioSettings,
    path = "Notes/a.md",
): Promise<Deck> {
    const file = new UnitTestNoteFile(text, path);
    const questions = await createTestNoteQuestionParser(settings).createQuestionList(
        file,
        TextDirection.Ltr,
        TopicPath.emptyPath,
        true,
    );
    const deck = new Deck("Root", null);
    new Note(file, questions).appendCardsToDeck(deck);
    return deck;
}
