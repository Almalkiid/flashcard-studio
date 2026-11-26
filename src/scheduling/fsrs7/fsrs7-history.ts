import type { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import type { Fsrs7Grade } from "src/scheduling/fsrs7/fsrs7-engine";

/** One answer FSRS-7 replays: its time and grade. */
export interface Fsrs7Answer {
    t: number;
    rating: Fsrs7Grade;
}

const isReset = (entry: ReviewLogEntry): boolean =>
    entry.r === 0 && entry.k === 4 && (entry.s ?? 0) === 0;

/**
 * The complete answer history of each card in the review log, which FSRS-7 can replay to rebuild the card's memory
 * (Anki rebuilds it the same way). The rules are the optimizer's (`buildCardHistories`), except that every answer is
 * kept, same-day ones too, as FSRS-7 counts the hours between them:
 *
 * - a reset starts the history again; cram answers and manual entries are skipped;
 * - a card never reset whose first kept answer is not a learning answer was learnt before the log began, so it has no
 *   complete history and is left out (it stays on FSRS-6).
 */
export function fsrs7Histories(entries: readonly ReviewLogEntry[]): Map<string, Fsrs7Answer[]> {
    const byCard = new Map<string, ReviewLogEntry[]>();
    for (const entry of entries) {
        // No card, or no usable time (ts-fsrs 6 rejects the epoch itself)
        if (entry.c === "" || !(entry.t > 0)) continue;
        const list = byCard.get(entry.c);
        if (list) list.push(entry);
        else byCard.set(entry.c, [entry]);
    }

    const histories = new Map<string, Fsrs7Answer[]>();
    for (const [cardId, list] of byCard) {
        list.sort((a, b) => a.t - b.t);
        let lastReset = -1;
        list.forEach((entry, index) => {
            if (isReset(entry)) lastReset = index;
        });
        const answers: Fsrs7Answer[] = [];
        for (const entry of list.slice(lastReset + 1)) {
            if (entry.r === 0 || entry.k === 3 || entry.k === 4) continue;
            if (answers.length === 0 && lastReset < 0 && entry.k !== 0) break;
            answers.push({ t: entry.t, rating: entry.r });
        }
        if (answers.length > 0) histories.set(cardId, answers);
    }
    return histories;
}
