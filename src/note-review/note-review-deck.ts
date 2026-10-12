import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import { globalDateProvider } from "src/utils/clock";
import { globalRandomNumberProvider } from "src/utils/random";

export class SchedNote {
    constructor(
        public note: IVaultNoteFile,
        public dueUnix: number,
    ) {}

    isDue(todayUnix: number): boolean {
        return todayUnix >= this.dueUnix;
    }
}

export class NoteReviewDeck {
    private readonly _newNotes: IVaultNoteFile[] = [];
    private readonly _scheduledNotes: SchedNote[] = [];
    private _dueNotesCount = 0;
    /** The keys of the pane folders shown open: the deck, the group of today, and what the user opened. */
    readonly activeFolders: Set<string>;

    constructor(
        private readonly name: string,
        activeFolders?: Set<string>,
    ) {
        this.activeFolders = activeFolders ?? new Set([name, "Today"]);
    }

    get deckName() {
        return this.name;
    }

    get newNotes() {
        return this._newNotes;
    }

    get scheduledNotes() {
        return this._scheduledNotes;
    }

    get dueNotesCount() {
        return this._dueNotesCount;
    }

    calcDueNotesCount(todayUnix: number): void {
        const due = this._scheduledNotes.filter((item) => item.isDue(todayUnix));
        this._dueNotesCount = due.length;
    }

    sortNotesByDateAndImportance(pageranks: Record<string, number>): void {
        const rank = (file: IVaultNoteFile) => pageranks[file.path] ?? 0;
        this._newNotes.sort((a, b) => rank(b) - rank(a));
        this._scheduledNotes.sort((a, b) => a.dueUnix - b.dueUnix || rank(b.note) - rank(a.note));
    }

    determineNextNote(openRandomNote: boolean): IVaultNoteFile | null {
        const due = this._scheduledNotes.filter((item) =>
            item.isDue(globalDateProvider.today.valueOf()),
        );
        const pool = due.length ? due.map((item) => item.note) : this._newNotes;
        if (!pool.length) return null;
        return openRandomNote
            ? pool[globalRandomNumberProvider.getInteger(0, pool.length - 1)]
            : pool[0];
    }
}
