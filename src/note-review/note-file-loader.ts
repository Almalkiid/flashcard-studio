import { NoteQuestionParser } from "src/cards/note-question-parser";
import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { TopicPath } from "src/data/decks/topic-path";
import type { StudioSettings } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import type { TextDirection } from "src/utils/text";

export class NoteFileLoader {
    constructor(private readonly settings: StudioSettings) {}

    async load(
        file: IVaultNoteFile,
        direction: TextDirection,
        folderPath: TopicPath,
    ): Promise<Note> {
        const questions = await new NoteQuestionParser(this.settings).createQuestionList(
            file,
            direction,
            folderPath,
            true,
        );
        return new Note(file, questions);
    }
}
