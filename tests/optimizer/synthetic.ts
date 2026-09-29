import {
    createEmptyCard,
    default_w as defaultWeights,
    forgetting_curve as forgettingCurve,
    fsrs,
    generatorParameters,
    Rating,
} from "ts-fsrs";

import { ReviewLogEntry } from "src/data/review-log/review-log-entry";

const DAY_MS = 86400000;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A small deterministic random number generator, so a run can be repeated. */
export function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A learner whose memory is close to FSRS's default parameters. */
export const NEAR_DEFAULT_WEIGHTS: number[] = defaultWeights.map((weight, index) =>
    index < 4 ? weight * 1.4 : index === 5 ? weight * 1.2 : weight,
);

/** A learner whose memory is far from the defaults: slower first learning, more stable, less forgiving. */
export const FAR_FROM_DEFAULT_WEIGHTS: number[] = defaultWeights.map((weight, index) => {
    if (index < 4) return weight * 2;
    if (index === 8) return weight * 0.5;
    if (index === 9) return weight * 1.6;
    if (index === 15) return weight * 0.5;
    if (index === 20) return 0.35;
    return weight;
});

export interface SyntheticOptions {
    cards: number;
    /** How many days the learner studies for. */
    days: number;
    /** The weights of the simulated memory: the truth an optimizer should find. */
    trueWeights: number[];
    seed: number;
    desiredRetention?: number;
    /** Start of the study period, epoch milliseconds. */
    startMs?: number;
}

function cardId(index: number): string {
    let id = "";
    let rest = index + 36 ** 5;
    for (let i = 0; i < 6; i++) {
        id = ID_ALPHABET[rest % 36] + id;
        rest = Math.floor(rest / 36);
    }
    return id;
}

/**
 * Simulates a learner and writes what Flashcard Studio would have logged.
 *
 * Every card is answered on the days a scheduler with the true weights would show it, sometimes a few days late, and
 * the answer is recalled or forgotten by the true forgetting curve. On top of that come the entries the optimizer's
 * input rules must ignore: a second answer on the same day, cram answers and manual entries.
 */
export function generateReviewLog(options: SyntheticOptions): ReviewLogEntry[] {
    const random = mulberry32(options.seed);
    const startMs = options.startMs ?? Date.UTC(2025, 0, 1, 6);
    const endMs = startMs + options.days * DAY_MS;
    const scheduler = fsrs(
        generatorParameters({
            w: options.trueWeights,
            ["request_retention"]: options.desiredRetention ?? 0.9,
            ["enable_short_term"]: false,
            ["enable_fuzz"]: false,
        }),
    );

    const entries: ReviewLogEntry[] = [];
    const entry = (t: number, c: string, r: 0 | 1 | 2 | 3 | 4, k: 0 | 1 | 2 | 3 | 4, s = 1) => ({
        t: Math.round(t),
        c,
        r,
        k,
        ivl: 1,
        li: 1,
        s,
        d: 5,
        ms: 5000,
        dk: "Deck",
        f: "Deck.md",
    });

    for (let index = 0; index < options.cards; index++) {
        const id = cardId(index);
        // New cards are introduced over the first quarter of the period, at a time of day between 08:00 and 22:00
        let t =
            startMs +
            Math.floor(random() * (options.days / 4)) * DAY_MS +
            (2 + random() * 14) * 3600e3;
        let card = createEmptyCard(new Date(t));

        let first = true;
        while (t < endMs) {
            let rating: Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
            if (first) {
                const u = random();
                rating =
                    u < 0.1
                        ? Rating.Again
                        : u < 0.2
                          ? Rating.Hard
                          : u < 0.8
                            ? Rating.Good
                            : Rating.Easy;
            } else {
                const elapsedDays = (t - card.last_review.getTime()) / DAY_MS;
                const recall = forgettingCurve(options.trueWeights, elapsedDays, card.stability);
                if (random() > recall) rating = Rating.Again;
                else {
                    const u = random();
                    rating = u < 0.1 ? Rating.Hard : u < 0.25 ? Rating.Easy : Rating.Good;
                }
            }

            entries.push(entry(t, id, rating, first ? 0 : 1));
            // Noise the optimizer's input rules must drop
            if (random() < 0.15) entries.push(entry(t + 600e3, id, 3, 1)); // a second answer the same day
            if (random() < 0.02) entries.push(entry(t + 3600e3, id, 2, 3)); // cram
            if (random() < 0.01) entries.push(entry(t + 7200e3, id, 0, 4, 12)); // a due date change, not a reset

            card = scheduler.next(card, new Date(t), rating).card;
            first = false;
            // Sometimes a card is answered a few days late
            const lateDays = random() < 0.3 ? 1 + Math.floor(random() * 3) : 0;
            t = card.due.getTime() + lateDays * DAY_MS + (random() - 0.5) * 6 * 3600e3;
        }
    }
    return entries.sort((a, b) => a.t - b.t);
}
