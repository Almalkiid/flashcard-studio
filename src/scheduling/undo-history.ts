/**
 * What happened when the user asked to undo.
 */
export enum UndoResult {
    /** There was nothing to undo. */
    Nothing,
    /** The note changed since the answer, so nothing was touched. */
    Failed,
    /** The answer was undone and the card is current again. */
    Requeued,
    /** The answer was undone, but it belonged to an earlier session; reload the queue to see the card. */
    NeedsReload,
}

/**
 * The most recent answers that can be undone, newest last. Kept outside a single review session so that the last
 * answer of a deck can still be undone after the queue has been reloaded.
 */
export class UndoHistory<T> {
    private readonly records: T[] = [];
    private readonly maxRecords: number;

    constructor(maxRecords: number = 20) {
        this.maxRecords = maxRecords;
    }

    get size(): number {
        return this.records.length;
    }

    push(record: T): void {
        this.records.push(record);
        if (this.records.length > this.maxRecords) this.records.shift();
    }

    pop(): T | undefined {
        return this.records.pop();
    }

    clear(): void {
        this.records.splice(0);
    }
}
