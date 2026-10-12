import { readSchedules } from "src/data/data-store/schedule-comment";
import { IDataStore, IFileModifier } from "src/data/data-store/store";
import type { Question, Rewrite } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

/** Keeps the schedule of every card in the note the card is in. */
export class NotesDataStore implements IDataStore {
    constructor(
        private readonly settings: StudioSettings,
        public fileModifier: IFileModifier,
    ) {}

    createSchedule(questionText: string, _unused?: unknown): ScheduleState[] {
        return readSchedules(questionText);
    }

    writeSchedule(question: Question): Promise<boolean> {
        return this.write(question);
    }

    write(question: Question): Promise<boolean> {
        return question.writeQuestion(this.settings);
    }

    async delete(question: Question): Promise<boolean> {
        let removal: Rewrite | null = null;
        const written = await question.note.file.edit((noteText) => {
            removal = question.planRemoval(noteText);
            return removal?.noteText ?? null;
        });
        if (written && removal !== null) question.applyRemoval(removal);
        return written;
    }
}
