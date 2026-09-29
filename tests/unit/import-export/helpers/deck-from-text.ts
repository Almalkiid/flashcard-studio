import { Deck } from "src/data/data-structures/deck/deck";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "../../helpers/unit-test-file";
import { createTestNoteQuestionParser } from "../../sample-items";

/** The deck tree of a note held in memory, read with the given settings (which the shared sample helpers do not take). */
export async function deckFromText(
    text: string,
    settings: SRSettings,
    path = "Notes/a.md",
): Promise<Deck> {
    const file = new UnitTestSRFile(text, path);
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
