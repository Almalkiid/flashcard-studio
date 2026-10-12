import { NoteQuestionParser } from "src/cards/note-question-parser";
import { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import { TextDirection } from "src/utils/text";

import { UnitTestNoteFile } from "./memory-note";

export function createTestNoteQuestionParser(settings: StudioSettings): NoteQuestionParser {
    return new NoteQuestionParser(settings);
}

export class SampleItemDecks {
    /** The deck hierarchy of one note: a root deck with the cards of the questions that have a deck tag or a folder path. */
    static async createDeckFromFile(
        file: UnitTestNoteFile,
        folderTopicPath: TopicPath = TopicPath.emptyPath,
        settings: StudioSettings = DEFAULT_SETTINGS,
    ): Promise<Deck> {
        const questions = await createTestNoteQuestionParser(settings).createQuestionList(
            file,
            TextDirection.Ltr,
            folderTopicPath,
            true,
        );
        const deck = new Deck("Root", null);
        new Note(file, questions).appendCardsToDeck(deck);
        return deck;
    }
}
