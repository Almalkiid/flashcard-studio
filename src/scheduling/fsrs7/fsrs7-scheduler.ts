import type { Moment } from "moment";

import type { StudioSettings } from "src/data/settings-model";
import type { DueDateHistogram } from "src/scheduling/due-histogram";
import { pickFsrsBalancedInterval } from "src/scheduling/fsrs/load-balance";
import { Fsrs7Card, Fsrs7Engine, Fsrs7Grade } from "src/scheduling/fsrs7/fsrs7-engine";
import type { Fsrs7Answer } from "src/scheduling/fsrs7/fsrs7-history";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { moment } from "src/utils/moment-en";

const DAY_MS = 86_400_000;
const GRADE_LIST = [1, 2, 3, 4] as const;

/**
 * FSRS-7 counts exact time, so a button's interval could change between showing the card and pressing the button. The
 * answers worked out when a card is shown are kept this long and applied at the press, moved to its time.
 */
const SHOWN_ANSWERS_MS = 30 * 60_000;
const GRADES: Partial<Record<ReviewResponse, Fsrs7Grade>> = {
    [ReviewResponse.Again]: 1,
    [ReviewResponse.Hard]: 2,
    [ReviewResponse.Good]: 3,
    [ReviewResponse.Easy]: 4,
};

/** Values as FSRS-6 writes them: 8 decimals. */
const round8 = (value: number): number => Math.round(value * 1e8) / 1e8;

/**
 * Answers cards with FSRS-7 and gives the plugin's FSRS schedules back: field 3 holds S90, the traces go in the
 * `f7` token. Load balancing follows the FSRS-6 rules (quiet day inside the fuzz window, Hard < Good < Easy).
 */
export class Fsrs7Scheduler {
    private readonly engine: Fsrs7Engine;
    private readonly loadBalance: { maximumInterval: number; easyDays: readonly number[] } | null;
    private shown: {
        identity: string;
        at: number;
        answers: Record<Fsrs7Grade, Fsrs7Card>;
    } | null = null;

    constructor(settings: StudioSettings) {
        // Balancing picks the day inside the fuzz window itself, so the model's own fuzz is off (as for FSRS-6)
        this.engine = new Fsrs7Engine(
            settings.fsrsLoadBalance ? { ...settings, fsrsEnableFuzz: false } : settings,
        );
        this.loadBalance = settings.fsrsLoadBalance
            ? { maximumInterval: settings.maximumInterval, easyDays: settings.fsrsEasyDays }
            : null;
    }

    /** The first answer to a card never reviewed (also a reset card). */
    scheduleNew(
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
        notePath: string,
    ): FsrsState {
        const card = this.engine.newCard(now.toDate());
        return this.answer(card, response, now, histogram, `new:${notePath}`, `new:${notePath}`);
    }

    /** A later answer to an FSRS-7 card. `cardId` (when known) is part of what tells cards apart. */
    schedule(
        card: FsrsState,
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
        cardId?: string | null,
    ): FsrsState {
        const input = Fsrs7Scheduler.toEngine(card);
        // Everything the answers depend on: the card's id and every field of its schedule
        const identity = `${cardId ?? ""}|${JSON.stringify(input)}`;
        return this.answer(input, response, now, histogram, Fsrs7Scheduler.seed(card), identity);
    }

    /**
     * The FSRS-7 card an FSRS-6 card becomes when its whole history is replayed, or null when the history does not
     * end at the card's last review (an answer missing from the log): then the card stays on FSRS-6.
     */
    fromHistory(card: FsrsState, answers: readonly Fsrs7Answer[]): FsrsState | null {
        const replayed = this.engine.replay(answers.filter((answer) => answer.t > 0));
        const last = card.lastReview?.valueOf();
        if (replayed === null || replayed.lastReview === null || last === undefined) return null;
        // The log's time is taken a few milliseconds after the note's, so a minute apart is the same answer
        if (
            Math.abs(replayed.lastReview.valueOf() - last) > 60_000 ||
            replayed.reps !== card.reps
        ) {
            return null;
        }
        // Only the memory is FSRS-7's now: the card keeps its state, step, counts, times and due date
        return Fsrs7Scheduler.toState(
            { ...Fsrs7Scheduler.toEngine(card), memory: replayed.memory },
            this.engine,
        );
    }

    private answer(
        card: Fsrs7Card,
        response: ReviewResponse,
        now: Moment,
        histogram: DueDateHistogram,
        seed: string,
        identity: string,
    ): FsrsState {
        const grade = GRADES[response];
        if (grade === undefined) throw new Error(`Unsupported FSRS response: ${response}`);
        const answers = this.finalAnswers(card, now, histogram, seed, identity);
        return Fsrs7Scheduler.toState(answers[grade], this.engine);
    }

    /**
     * The card each button gives, after load balancing. FSRS-7 counts exact time, so these are worked out once when
     * the card is shown and kept for half an hour for the same card (same id and the very same schedule), then
     * applied at the press, moved to its time: the interval on a button is the one applied.
     */
    private finalAnswers(
        card: Fsrs7Card,
        now: Moment,
        histogram: DueDateHistogram,
        seed: string,
        identity: string,
    ): Record<Fsrs7Grade, Fsrs7Card> {
        const at = now.valueOf();
        const shown = this.shown;
        if (shown?.identity === identity && at >= shown.at && at - shown.at <= SHOWN_ANSWERS_MS) {
            const moved = {} as Record<Fsrs7Grade, Fsrs7Card>;
            for (const grade of GRADE_LIST) {
                const answer = shown.answers[grade];
                moved[grade] = {
                    ...answer,
                    due: new Date(answer.due.valueOf() + (at - shown.at)),
                    lastReview: now.toDate(),
                };
            }
            return moved;
        }
        const raw = this.engine.answers(card, now.toDate(), seed);
        const answers = this.balanced(card, raw, now, histogram, seed);
        this.shown = { identity, at, answers };
        return answers;
    }

    /**
     * With load balancing, Hard, Good and Easy in turn each get a quiet day at least a day after the grade below,
     * never past the maximum (at the maximum two grades may share a day). Again and learning steps are left alone.
     */
    private balanced(
        card: Fsrs7Card,
        answers: Record<Fsrs7Grade, Fsrs7Card>,
        now: Moment,
        histogram: DueDateHistogram,
        seed: string,
    ): Record<Fsrs7Grade, Fsrs7Card> {
        const balance = this.loadBalance;
        if (balance === null) return answers;
        const elapsedDays = card.lastReview
            ? Math.max(0, Math.floor((now.valueOf() - card.lastReview.valueOf()) / DAY_MS))
            : 0;
        const cap = balance.maximumInterval;
        const result = { ...answers };
        let below = 0;
        for (const grade of [2, 3, 4] as const) {
            const target = answers[grade];
            if (target.state !== 2 || target.intervalDays < 1) continue;
            const minimum = below >= 1 ? below + 1 : undefined;
            const picked =
                minimum !== undefined && minimum > cap
                    ? cap
                    : pickFsrsBalancedInterval({
                          targetInterval: Math.max(
                              Math.min(target.intervalDays, cap),
                              minimum ?? 1,
                          ),
                          elapsedDays,
                          maximumInterval: cap,
                          histogram,
                          now,
                          seed,
                          easyDays: balance.easyDays,
                          currentDueUnix: card.state === 0 ? undefined : card.due.valueOf(),
                          minimumInterval: minimum,
                      });
            below = Math.max(below, Math.min(picked, cap));
            result[grade] = {
                ...target,
                intervalDays: below,
                due: new Date(now.valueOf() + below * DAY_MS),
            };
        }
        return result;
    }

    /** Stable for a card from showing the buttons to answering: its last review and memory. */
    private static seed(card: FsrsState): string {
        return `${card.lastReview?.valueOf() ?? "new"}_${card.reps}_${card.fsrs7?.stability}_${card.difficulty}`;
    }

    private static toEngine(card: FsrsState): Fsrs7Card {
        const traces = card.fsrs7 ?? { stability: card.stability, stabilityFast: card.stability };
        return {
            due: card.dueDate.toDate(),
            intervalDays: card.interval,
            state: card.state,
            memory: { ...traces, difficulty: card.difficulty },
            reps: card.reps,
            lapses: card.lapses,
            learningStep: card.learningSteps,
            lastReview: card.lastReview?.toDate() ?? null,
        };
    }

    private static toState(card: Fsrs7Card, engine: Fsrs7Engine): FsrsState {
        return new FsrsState(
            moment(card.due),
            card.intervalDays,
            round8(card.memory.difficulty),
            round8(engine.s90(card.memory)),
            card.state,
            card.reps,
            card.lapses,
            card.learningStep,
            card.lastReview ? moment(card.lastReview) : null,
            {
                stability: round8(card.memory.stability),
                stabilityFast: round8(card.memory.stabilityFast),
            },
        );
    }
}
