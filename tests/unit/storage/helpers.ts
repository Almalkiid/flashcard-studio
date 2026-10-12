import { readFileSync } from "fs";
import * as path from "path";

import { CardMeta } from "src/data/card-meta";
import { TopicPath } from "src/data/decks/topic-path";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";
import { TextDirection } from "src/utils/text";

import { FakeVault } from "../scheduling/sm2/fake-vault";
import { DataStore, DataStoreAlgorithm, IFileModifier, NotesDataStore, Sm2NoteStore } from "./api";

/** One golden file (tests/unit/storage/golden/<name>.json). */
export function golden<T>(name: string): T {
    return JSON.parse(readFileSync(path.join(__dirname, "golden", `${name}.json`), "utf8")) as T;
}

export function settingsWith(options: Partial<StudioSettings> = {}): StudioSettings {
    return { ...DEFAULT_SETTINGS, ...options };
}

/** The random source the golden files were made with: the bytes 0, 1, 2, 3 ... in turn, so an id is the counter in base 36. */
export function useCountingRandomBytes(): void {
    let counter = 0;
    Object.defineProperty(window, "crypto", {
        configurable: true,
        value: {
            getRandomValues: (bytes: Uint8Array) => {
                for (let i = 0; i < bytes.length; i++) bytes[i] = counter++;
                return bytes;
            },
        },
    });
}

/** The clock and the data store the golden files were made under. */
export function setUp(settings: StudioSettings): void {
    setupStaticDateProvider("2026-10-12");
    DataStore.instance = new NotesDataStore(settings, {} as IFileModifier);
    DataStoreAlgorithm.instance = new Sm2NoteStore(settings);
    useCountingRandomBytes();
}

export interface Loaded {
    vault: FakeVault;
    note: Note;
    settings: StudioSettings;
}

/** Parses a note the way the plugin loads one (the tag filter on; the deck path is the folder, empty unless given). */
export async function load(
    text: string,
    settings: StudioSettings,
    folder: string[] = [],
    file = "N.md",
): Promise<Loaded> {
    const vault = new FakeVault({ [file]: text });
    const note = await new NoteFileLoader(settings).load(
        vault.file(file),
        TextDirection.Ltr,
        new TopicPath(folder),
    );
    return { vault, note, settings };
}

/** The schedule an operation of the golden files sets. */
export function scheduleFor(op: { set: string; due?: string; interval?: number; ease?: number }) {
    if (op.set === "sm2") {
        return new Sm2State(
            moment(op.due ?? "2026-10-20", "YYYY-MM-DD"),
            op.interval ?? 12,
            op.ease ?? 260,
        );
    }
    return new FsrsState(
        moment(op.due ? `${op.due}T08:00:00.000Z` : "2026-10-20T08:00:00.000Z"),
        7,
        5.5,
        7.25,
        2,
        3,
        0,
        0,
        moment("2026-10-01T08:00:00.000Z"),
    );
}

export type MetaPatch = Partial<CardMeta>;

/** What loading a text gives back, per card, as the golden files list it. */
export function view(
    note: Note,
): { type: number; cards: { schedule: string | null; id: string | null }[] }[] {
    return note.questionList.map((question) => ({
        type: question.questionType,
        cards: question.cards.map((card) => ({
            schedule: card.scheduleInfo ? card.scheduleInfo.formatScheduleAsComment() : null,
            id: card.meta.id,
        })),
    }));
}
