import { ReviewLogEntry } from "src/data/review-log/review-log-entry";

/** The columns of the review log format that the FSRS optimizer reads. */
export const REVLOG_CSV_HEADER = "card_id,review_time,review_rating,review_state,review_duration";

// Base 36 ids of up to ten characters stay exact as numbers
const MAX_EXACT_ID_LENGTH = 10;
const FALLBACK_ID_BASE = 36 ** MAX_EXACT_ID_LENGTH;

/**
 * Numbers for the optimizer's `card_id` column, which is an integer. A card id is base 36, so it converts to the
 * same number every time. An unusually long id gets a number above every converted one instead.
 */
export class CardIdNumbers {
    private readonly fallback = new Map<string, number>();

    numberFor(cardId: string): number {
        const exact = cardId.length <= MAX_EXACT_ID_LENGTH ? parseInt(cardId, 36) : NaN;
        if (!Number.isNaN(exact)) return exact;
        let value = this.fallback.get(cardId);
        if (value === undefined) {
            value = FALLBACK_ID_BASE + this.fallback.size;
            this.fallback.set(cardId, value);
        }
        return value;
    }
}

/**
 * The review log as the CSV that the FSRS optimizer reads (`card_id,review_time,review_rating,review_state,
 * review_duration`), oldest answer first. `review_time` is epoch milliseconds, `review_state` is the review kind
 * (0 learn, 1 review, 2 relearn, 3 cram, 4 manual; Anki's revlog type) and `review_duration` is milliseconds.
 * Every entry is exported, as in Anki's revlog; the optimizer ignores the ones it cannot use.
 */
export function formatRevlogCsv(entries: readonly ReviewLogEntry[]): string {
    const ids = new CardIdNumbers();
    const lines = [REVLOG_CSV_HEADER];
    for (const entry of [...entries].sort((a, b) => a.t - b.t)) {
        if (entry.c === "") continue;
        lines.push([ids.numberFor(entry.c), entry.t, entry.r, entry.k, entry.ms].join(","));
    }
    return lines.join("\n") + "\n";
}

/**
 * The file name for an export made on a given day: `cardwright-revlog-2026-09-29.csv`.
 */
export function revlogCsvFileName(dateYmd: string): string {
    return `cardwright-revlog-${dateYmd}.csv`;
}
