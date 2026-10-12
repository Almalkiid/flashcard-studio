import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { NoteReviewDeck, SchedNote } from "src/note-review/note-review-deck";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

export class NoteReviewQueue {
    private _reviewDecks = new Map<string, NoteReviewDeck>();
    private _dueNotesCount: number | undefined;
    /** The fold state of each deck by name. A rescan builds new decks but they take the state back. */
    private readonly foldState = new Map<string, Set<string>>();

    get reviewDecks(): Map<string, NoteReviewDeck> {
        return this._reviewDecks;
    }
    /** Notes due today, each counted once however many decks list it. */
    get dueNotesCount(): number {
        return this._dueNotesCount ?? 0;
    }
    get reviewDeckNameList(): string[] {
        return [...this._reviewDecks.keys()];
    }

    init(): void {
        for (const deck of this._reviewDecks.values())
            this.foldState.set(deck.deckName, deck.activeFolders);
        this._reviewDecks = new Map();
    }

    calcDueNotesCount(todayUnix: number): void {
        const due = new Set<string>();
        for (const deck of this._reviewDecks.values()) {
            deck.calcDueNotesCount(todayUnix);
            for (const item of deck.scheduledNotes)
                if (item.isDue(todayUnix)) due.add(item.note.path);
        }
        this._dueNotesCount = due.size;
    }

    addNoteToQueue(note: IVaultNoteFile, schedule: ScheduleState | null, tags: string[]): void {
        for (const tag of new Set(tags)) {
            let deck = this._reviewDecks.get(tag);
            if (!deck) {
                deck = new NoteReviewDeck(tag, this.foldState.get(tag));
                this._reviewDecks.set(tag, deck);
            }
            if (schedule) deck.scheduledNotes.push(new SchedNote(note, schedule.dueDateAsUnix));
            else deck.newNotes.push(note);
        }
    }

    /** A note rated in the pane or by a command moves in every deck that lists it. */
    updateScheduleInfo(note: IVaultNoteFile, schedule: ScheduleState): void {
        for (const deck of this._reviewDecks.values()) {
            const newIndex = deck.newNotes.findIndex((item) => item.path === note.path);
            if (newIndex >= 0) {
                deck.newNotes.splice(newIndex, 1);
                deck.scheduledNotes.push(new SchedNote(note, schedule.dueDateAsUnix));
                continue;
            }
            const scheduled = deck.scheduledNotes.find((item) => item.note.path === note.path);
            if (scheduled) scheduled.dueUnix = schedule.dueDateAsUnix;
        }
    }

    /** Drops a deleted note from every deck. */
    removeNote(path: string): void {
        for (const deck of this._reviewDecks.values()) {
            const news = deck.newNotes;
            const scheduled = deck.scheduledNotes;
            for (let i = news.length - 1; i >= 0; i--) if (news[i].path === path) news.splice(i, 1);
            for (let i = scheduled.length - 1; i >= 0; i--)
                if (scheduled[i].note.path === path) scheduled.splice(i, 1);
        }
    }
}
