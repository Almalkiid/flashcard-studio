import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore, DataStoreAlgorithm, IFileModifier } from "src/data/data-store/store";
import { StudioSettings } from "src/data/settings-model";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";

/** Puts the note data store, the comment writer and the scheduling algorithm of the settings in place, for tests that read or write notes in memory. */
export function unitTestSetupStandardDataStoreAlgorithm(settings: StudioSettings): void {
    DataStore.instance = new NotesDataStore(settings, {} as IFileModifier);
    DataStoreAlgorithm.instance = new Sm2NoteStore(settings);
    ActiveScheduler.instance =
        settings.algorithm === SchedulerKind.FSRS
            ? new FsrsCardScheduler(settings)
            : new Sm2Scheduler(settings);
}

/** The text with the card ids (`,id=k3f9a2`) taken out of its schedule comments, so a test need not know them. */
export function stripCardIds(text: string): string {
    return text.replace(/,id=[0-9a-z]+/g, "");
}
