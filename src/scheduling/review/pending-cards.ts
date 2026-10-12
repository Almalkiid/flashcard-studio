import type { Card } from "src/data/data-structures/card/flashcard";

interface Waiting<T> {
    card: T;
    dueUnix: number;
    /** When it was answered, relative to the others: equal due times wake in this order. */
    order: number;
}

/** A card without a due time (NaN) waits behind every dated card and never wakes. */
function keyOf(dueUnix: number): number {
    return Number.isNaN(dueUnix) ? Infinity : dueUnix;
}

function before<T>(a: Waiting<T>, b: Waiting<T>): boolean {
    const [dueA, dueB] = [keyOf(a.dueUnix), keyOf(b.dueUnix)];
    return dueA < dueB || (dueA === dueB && a.order < b.order);
}

/**
 * Cards waiting for a learning step to fall due, kept as a binary min-heap: the next due time is read at once, and an
 * answer or a wake-up costs O(log n). Cards due at the same time wake in the order they were answered.
 */
export class PendingCards<T = Card> {
    private heap: Waiting<T>[] = [];
    private answered = 0;

    get size(): number {
        return this.heap.length;
    }

    /** The earliest due time, or null when nothing waits; NaN while a card without a due time waits. */
    get nextDueUnix(): number | null {
        if (this.heap.length === 0) return null;
        return this.heap.some((waiting) => Number.isNaN(waiting.dueUnix))
            ? NaN
            : this.heap[0].dueUnix;
    }

    /** Whether a card is due at or before `untilUnix`; a card without a due time never is. */
    hasDueBy(untilUnix: number): boolean {
        return this.heap.length > 0 && this.heap[0].dueUnix <= untilUnix;
    }

    push(card: T, dueUnix: number): void {
        this.heap.push({ card, dueUnix, order: this.answered++ });
        let child = this.heap.length - 1;
        while (child > 0) {
            const parent = (child - 1) >> 1;
            if (!before(this.heap[child], this.heap[parent])) break;
            this.swap(child, parent);
            child = parent;
        }
    }

    /** Takes out every card due at or before `untilUnix`, in the order they wake. */
    takeDue(untilUnix: number): T[] {
        const woken: T[] = [];
        while (this.hasDueBy(untilUnix)) {
            woken.push(this.heap[0].card);
            const last = this.heap.pop();
            if (this.heap.length > 0) {
                this.heap[0] = last;
                this.siftDown(0);
            }
        }
        return woken;
    }

    /** Drops the cards that match, e.g. an answer that was undone or a question that was deleted. */
    removeWhere(matches: (card: T) => boolean): void {
        // A sorted array is a valid heap
        this.heap = this.heap.filter((waiting) => !matches(waiting.card)).sort(this.compare);
    }

    /** Every waiting card with its due time, in the order they would wake. */
    inWakeOrder(): { card: T; dueUnix: number }[] {
        return [...this.heap].sort(this.compare).map(({ card, dueUnix }) => ({ card, dueUnix }));
    }

    private readonly compare = (a: Waiting<T>, b: Waiting<T>): number =>
        before(a, b) ? -1 : before(b, a) ? 1 : 0;

    private siftDown(index: number): void {
        for (;;) {
            let first = index;
            for (const child of [2 * index + 1, 2 * index + 2]) {
                if (child < this.heap.length && before(this.heap[child], this.heap[first]))
                    first = child;
            }
            if (first === index) return;
            this.swap(index, first);
            index = first;
        }
    }

    private swap(i: number, j: number): void {
        [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    }
}
