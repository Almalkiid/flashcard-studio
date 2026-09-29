/**
 * 0 manual (reset or rescheduled), 1 Again, 2 Hard, 3 Good, 4 Easy. Same values as Anki's revlog `ease`, plus 0.
 */
export type Rating = 0 | 1 | 2 | 3 | 4;

/**
 * 0 learn, 1 review, 2 relearn, 3 cram (no rescheduling), 4 manual. Same values as Anki's revlog `type`.
 */
export type ReviewKind = 0 | 1 | 2 | 3 | 4;

/**
 * One answer, as stored in the review log. Field names are short because there is one line per review.
 *
 * @property {number} t - Time of the answer, epoch milliseconds.
 * @property {string} c - Card id (see `CardMeta.id`).
 * @property {Rating} r - Rating.
 * @property {ReviewKind} k - Kind of review, decided by the card's state before the answer.
 * @property {1} [n] - Present when the card was new before this answer.
 * @property {number} ivl - New interval in days (fractional for learning steps).
 * @property {number} li - Previous interval in days.
 * @property {number} [s] - FSRS stability after the answer.
 * @property {number} [d] - FSRS difficulty after the answer.
 * @property {number} ms - Time taken to answer, in milliseconds.
 * @property {string} dk - Deck path.
 * @property {string} f - Note path.
 */
export interface ReviewLogEntry {
    t: number;
    c: string;
    r: Rating;
    k: ReviewKind;
    n?: 1;
    ivl: number;
    li: number;
    s?: number;
    d?: number;
    ms: number;
    dk: string;
    f: string;
}

const KEY_ORDER: (keyof ReviewLogEntry)[] = [
    "t",
    "c",
    "r",
    "k",
    "n",
    "ivl",
    "li",
    "s",
    "d",
    "ms",
    "dk",
    "f",
];

/**
 * Serializes an entry as one JSON line with a fixed key order, so identical entries give identical lines.
 */
export function serializeEntry(entry: ReviewLogEntry): string {
    const ordered: Record<string, unknown> = {};
    for (const key of KEY_ORDER) {
        if (entry[key] !== undefined) ordered[key] = entry[key];
    }
    return JSON.stringify(ordered);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Parses one log line. Returns null for anything that is not a complete, well-typed entry, so a partially
 * synced or hand-edited line never breaks reading the rest of the log.
 */
export function parseEntryLine(line: string): ReviewLogEntry | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const raw = parsed as Record<string, unknown>;
    const numbersOk = ["t", "ivl", "li", "ms"].every((key) => isFiniteNumber(raw[key]));
    const stringsOk = ["c", "dk", "f"].every((key) => typeof raw[key] === "string");
    if (!numbersOk || !stringsOk) return null;
    if (!isIntInRange(raw.r, 0, 4) || !isIntInRange(raw.k, 0, 4)) return null;
    if (raw.n !== undefined && raw.n !== 1) return null;
    if (raw.s !== undefined && !isFiniteNumber(raw.s)) return null;
    if (raw.d !== undefined && !isFiniteNumber(raw.d)) return null;

    const entry: ReviewLogEntry = {
        t: raw.t as number,
        c: raw.c as string,
        r: raw.r as Rating,
        k: raw.k as ReviewKind,
        ivl: raw.ivl as number,
        li: raw.li as number,
        ms: raw.ms as number,
        dk: raw.dk as string,
        f: raw.f as string,
    };
    if (raw.n === 1) entry.n = 1;
    if (raw.s !== undefined) entry.s = raw.s as number;
    if (raw.d !== undefined) entry.d = raw.d as number;
    return entry;
}
