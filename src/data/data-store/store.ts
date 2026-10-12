import type { TFile, Vault } from "obsidian";

import type { Question } from "src/data/data-structures/card/question";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

/** Where the cards of the vault keep their schedules. Only one exists: the notes themselves. */
export enum StorageType {
    NOTES = "NOTES",
}

/** The edits to many notes at once: deleting schedules and tags, and moving schedule comments into callouts. */
export interface IFileModifier {
    removeSchedulingInfoInCards(
        vault: Vault,
        file: TFile,
        deleteTags: boolean,
        tagsToDelete: string[],
    ): Promise<void>;
    removeSchedulingInfoInNotes(
        vault: Vault,
        file: TFile,
        deleteTags: boolean,
        tagsToDelete: string[],
    ): Promise<void>;
    removeTagsFromFile(vault: Vault, file: TFile, tags: string[]): Promise<void>;
    removeTagsFromFrontmatter(vault: Vault, file: TFile, tags: string[]): Promise<void>;
    deleteAllSchedulingData(
        deleteTags: boolean,
        deckTags: string[],
        noteTags: string[],
    ): Promise<void>;
    deleteAllSchedulingDataInCards(deleteTags: boolean, deckTags: string[]): Promise<void>;
    deleteAllSchedulingDataInNotes(deleteTags: boolean, noteTags: string[]): Promise<void>;
    deleteAllSchedulingDataOfCardsInNote(
        file: TFile,
        deleteTags: boolean,
        deckTags: string[],
    ): Promise<void>;
    deleteNoteSchedulingDataInNote(
        file: TFile,
        deleteTags: boolean,
        noteTags: string[],
    ): Promise<void>;
    /** @returns How many schedules were left in place, as moving them would cut a table or a list in two. */
    migrateCommentsToCallouts(): Promise<number>;
}

/** Writes and reads the schedules of the cards of a question. */
export interface IDataStore {
    fileModifier: IFileModifier;

    /** The schedules in the first schedule comment of a question's text, one per card; null for a card with none. */
    createSchedule(questionText: string, unused?: unknown): ScheduleState[];

    /**
     * Rewrites a question in its note.
     *
     * @returns Whether it was written; false when the store no longer holds the question as it was read (its note was
     * edited elsewhere), and then nothing was written.
     */
    write(question: Question): Promise<boolean>;

    /** Writes the schedules of a question's cards. @returns Whether it was written, as for `write`. */
    writeSchedule(question: Question): Promise<boolean>;

    /** Removes a question from its note. @returns Whether the note was written. */
    delete(question: Question): Promise<boolean>;
}

/** The data store in use. */
export class DataStore {
    static instance: IDataStore;

    static getInstance(): IDataStore {
        if (!DataStore.instance) throw new Error("there is no DataStore instance.");
        return DataStore.instance;
    }
}

/** Writes the schedule comment of a question. */
export interface IDataStoreAlgorithm {
    questionFormatScheduleAsHtmlComment(question: Question): string;
}

/** The comment writer in use. */
export class DataStoreAlgorithm {
    static instance: IDataStoreAlgorithm;

    static getInstance(): IDataStoreAlgorithm {
        if (!DataStoreAlgorithm.instance)
            throw new Error("there is no DataStoreAlgorithm instance.");
        return DataStoreAlgorithm.instance;
    }
}
