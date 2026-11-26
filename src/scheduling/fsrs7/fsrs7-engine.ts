import {
    dateChrono,
    defineScheduler,
    schedulerDesiredRetentionMiddleware,
    schedulerFuzzingMiddleware,
    schedulerLearningStepsMiddleware,
    schedulerMaximumIntervalMiddleware,
    schedulerMonotonicIntervalMiddleware,
    schedulerScheduledDaysMiddleware,
    schedulerStatsMiddleware,
} from "ts-fsrs-6";
import { FSRS7_DEFAULT_WEIGHTS, FSRS7Model } from "ts-fsrs-6/models/fsrs-7";

import type { StudioSettings } from "src/data/settings-model";
import {
    DEFAULT_LEARNING_STEPS,
    DEFAULT_RELEARNING_STEPS,
    parseFsrsSteps,
} from "src/scheduling/fsrs/fsrs-settings";

/** FSRS-7's memory of a card: a slow and a fast trace, and the difficulty. */
export interface Fsrs7Memory {
    stability: number;
    stabilityFast: number;
    difficulty: number;
}

/** A card as FSRS-7 schedules it. `state` is 0 new, 1 learning, 2 review, 3 relearning, as in FSRS-6. */
export interface Fsrs7Card {
    due: Date;
    /** Whole days for a review card; 0 while in a learning step. */
    intervalDays: number;
    state: 0 | 1 | 2 | 3;
    memory: Fsrs7Memory;
    reps: number;
    lapses: number;
    /** The index of the next learning step. */
    learningStep: number;
    lastReview: Date | null;
}

export type Fsrs7Grade = 1 | 2 | 3 | 4;

/** The card as ts-fsrs 6 reads and writes it (the fields this plugin uses). */
interface LibraryCard {
    stability: number;
    stabilityFast: number;
    difficulty: number;
    state: number;
    scheduleStatus: "new" | "learning" | "review";
    dueAt: Date;
    lastReviewAt: Date | null;
    cardId: string;
    reps: number;
    lapses: number;
    scheduledDays: number;
    learningStep: number;
}

const DAY_MS = 86_400_000;
const GRADES: readonly Fsrs7Grade[] = [1, 2, 3, 4];

// The standard scheduling policies, as ts-fsrs's own DefaultScheduler stacks them
const definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
    schedulerDesiredRetentionMiddleware,
    schedulerFuzzingMiddleware,
    schedulerStatsMiddleware,
    schedulerScheduledDaysMiddleware,
    schedulerLearningStepsMiddleware,
    schedulerMaximumIntervalMiddleware,
    schedulerMonotonicIntervalMiddleware,
);

type Scheduler = ReturnType<typeof definition.create>;

/**
 * FSRS-7 (ts-fsrs 6) with the plugin's settings: default FSRS-7 weights (custom weights are FSRS-6 weights), the
 * user's retention, learning steps (kept, not overridden by the model), maximum interval and fuzz, and whole-day
 * review intervals like FSRS-6. Fuzz is seeded from the card, so a button shows the interval its answer applies.
 */
export class Fsrs7Engine {
    private readonly scheduler: Scheduler;

    constructor(settings: StudioSettings) {
        const relearningSteps =
            parseFsrsSteps(settings.fsrsRelearningSteps) ?? DEFAULT_RELEARNING_STEPS.slice();
        this.scheduler = definition.create({
            config: {
                weights: FSRS7_DEFAULT_WEIGHTS,
                fractionalDays: false,
                enableShortTerm: true,
                numRelearningSteps: relearningSteps.length,
                desiredRetention: settings.fsrsDesiredRetention,
                learningSteps:
                    parseFsrsSteps(settings.fsrsLearningSteps) ?? DEFAULT_LEARNING_STEPS.slice(),
                relearningSteps,
                allowModelOverride: false,
                enableFuzz: settings.fsrsEnableFuzz,
                maximumInterval: settings.maximumInterval,
            },
        } as Parameters<typeof definition.create>[0]);
    }

    /** A card never reviewed, due now. */
    newCard(now: Date): Fsrs7Card {
        return Fsrs7Engine.fromLibrary(this.scheduler.newCard({ now }) as unknown as LibraryCard);
    }

    /**
     * The card each grade gives, answered at `now`.
     *
     * @param seed - Stable for the card between showing the buttons and answering (the fuzz is drawn from it).
     */
    answers(card: Fsrs7Card, now: Date, seed: string): Record<Fsrs7Grade, Fsrs7Card> {
        const input = this.toLibrary(card, seed, now);
        const result = {} as Record<Fsrs7Grade, Fsrs7Card>;
        for (const grade of GRADES) {
            const reviewed = this.scheduler.review({ card: input, grade, now } as never) as {
                card: LibraryCard;
            };
            result[grade] = Fsrs7Engine.fromLibrary(reviewed.card, now);
        }
        return result;
    }

    /** The card after these answers, in time order, from a new card; null for none. */
    replay(answers: readonly { t: number; rating: Fsrs7Grade }[]): Fsrs7Card | null {
        if (answers.length === 0) return null;
        let card = this.newCard(new Date(answers[0].t));
        for (const answer of answers) {
            card = this.answers(card, new Date(answer.t), "replay")[answer.rating];
        }
        return card;
    }

    /** Days until recall falls to 90%: the stability an FSRS-6 reader (older versions, statistics) understands. */
    s90(memory: Fsrs7Memory): number {
        return this.scheduler.model.nextInterval(memory, 0.9);
    }

    /** The probability of recall `days` after the review. */
    recall(memory: Fsrs7Memory, days: number): number {
        return this.scheduler.model.forgettingCurve(memory, days);
    }

    private toLibrary(card: Fsrs7Card, seed: string, now: Date): LibraryCard {
        const blank = this.scheduler.newCard({ now }) as unknown as LibraryCard;
        return {
            ...blank,
            ...card.memory,
            state: card.state,
            scheduleStatus: card.state === 0 ? "new" : card.state === 2 ? "review" : "learning",
            dueAt: card.due,
            // A last review after the answer (a clock that was ahead) counts as no time passed
            lastReviewAt:
                card.lastReview && card.lastReview.valueOf() > now.valueOf()
                    ? now
                    : card.lastReview,
            cardId: seed,
            reps: card.reps,
            lapses: card.lapses,
            scheduledDays: card.intervalDays,
            learningStep: card.learningStep,
        };
    }

    private static fromLibrary(card: LibraryCard, answeredAt?: Date): Fsrs7Card {
        const state = card.state as Fsrs7Card["state"];
        const intervalDays = state === 2 ? Math.round(card.scheduledDays) : 0;
        // A review card is due whole days after the answer, as with FSRS-6; a learning step keeps its exact time
        const due =
            state === 2 && answeredAt
                ? new Date(answeredAt.valueOf() + intervalDays * DAY_MS)
                : new Date(card.dueAt);
        return {
            due,
            intervalDays,
            state,
            memory: {
                stability: card.stability,
                stabilityFast: card.stabilityFast,
                difficulty: card.difficulty,
            },
            reps: card.reps,
            lapses: card.lapses,
            learningStep: card.learningStep,
            lastReview: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
        };
    }
}
