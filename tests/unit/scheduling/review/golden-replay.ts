import { Notice } from "obsidian";

import { TopicPath } from "src/data/decks/topic-path";
import { formatScheduleInterval } from "src/scheduling/display";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { UndoResult } from "src/scheduling/undo-history";
import { globalDateProvider } from "src/utils/clock";

import { clockAt } from "../fsrs/clock-at";
import { Session } from "./session";

/** One snapshot of `review-session.json` (golden/README.md): the state after a step. */
export type Snapshot = Record<string, unknown>;

export interface Scenario {
    id: string;
    source: string;
    setup: {
        text: string;
        algorithm: "SM2" | "FSRS";
        mode: "review" | "cram";
        settings: Record<string, unknown>;
        limits: { newCardsPerDay: number; reviewsPerDay: number; counts?: never } | null;
        clock: string;
        statsTags: string[];
    };
    steps: Snapshot[];
}

/** The argument of each `updateCurrentQuestionTextAndCards` step, which the golden file names only by its effect. */
const EDITED_TEXT: Record<string, string> = {
    "sm2/update-text-then-review": "A much more in depth question::A much more detailed answer",
    "sm2/update-text-schedule-following-line":
        "A much more in depth question::A much more detailed answer",
    "sm2/update-text-schedule-same-line-moves":
        "A much more in depth question::A much more detailed answer",
    "sm2/update-text-schedule-same-line-setting":
        "A much more in depth question::A much more detailed answer",
    "sm2/update-text-multiline":
        "Multiline question\nQuestion starting immediately after tag\n?\nA2 (answer now includes more detail)\nextra answer line 2",
    "sm2/update-text-multiline-after-tag-line":
        "Multiline question\nQuestion starting line after tag\n?\nA2 (answer now includes more detail)\nextra answer line 2",
    "sm2/update-text-new-multiline":
        "Multiline question\nQuestion starting immediately after tag\n?\nA2 (answer now includes more detail)\nextra answer line 2",
    "sm2/update-text-cloze-count-changes":
        "This single ==question== turns into 2 separate ==cards==",
    "sm2/update-text-cloze-same-count":
        "This single ==question== turns into ==4 separate== ==cards==",
};

const RESPONSES = ["Again", "Hard", "Good", "Easy", "Reset"] as const;
const STAT_FIELDS = [
    "totalCount",
    "dueCount",
    "newCount",
    "cardsInQueueCount",
    "dueCardsInQueueOfThisDeckCount",
    "newCardsInQueueOfThisDeckCount",
    "cardsInQueueOfThisDeckCount",
    "subDecksInQueueOfThisDeckCount",
    "decksInQueueOfThisDeckCount",
] as const;

function iso(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
}

function captureThrow(run: () => unknown): unknown {
    try {
        return run();
    } catch (error) {
        return { throws: (error as Error).message };
    }
}

/** The state after a step, in the shape of the golden file. */
export function snapshot(session: Session, statsTags: string[]): Snapshot {
    const { reviewSession } = session;
    const card = reviewSession.currentCard;
    const entry = reviewSession.lastLoggedEntry;
    const pending = reviewSession["pending"].inWakeOrder();
    const deckStats: Record<string, unknown> = {};
    for (const tag of statsTags) {
        deckStats[tag === "" ? "(all)" : tag] = captureThrow(() => {
            const path = tag === "" ? TopicPath.emptyPath : TopicPath.getTopicPathFromTag(tag);
            const stats = reviewSession.getDeckStats(path);
            return Object.fromEntries(STAT_FIELDS.map((field) => [field, stats[field]]));
        });
    }
    const result: Snapshot = {
        noteText: session.text,
        reviewLog: session.log.entries.map((logged) => ({ ...logged })),
        lastLoggedEntryIsLastInLog:
            entry === null ? null : entry === session.log.entries[session.log.entries.length - 1],
        current:
            card === null
                ? null
                : {
                      front: card.front,
                      schedule: card.scheduleInfo?.formatScheduleAsComment() ?? null,
                      hasSchedule: card.hasSchedule,
                      meta: {
                          id: card.meta.id,
                          suspended: card.meta.suspended,
                          buryUntil: card.meta.buryUntil,
                          flag: card.meta.flag,
                          leech: card.meta.leech,
                      },
                  },
        hasCurrentCard: reviewSession.hasCurrentCard,
        queue: queueOf(session),
        deckStats,
        pending: pending.map((waiting) => [waiting.card.front, iso(waiting.dueUnix)]),
        hasPendingCards: reviewSession.hasPendingCards,
        hasDuePendingCards: reviewSession.hasDuePendingCards,
        nextPendingDueIso: iso(reviewSession.nextPendingDueUnix),
        canUndo: reviewSession.canUndo,
        cardHistogram: Object.fromEntries(session.histogram.dueDatesMap),
        buriedCards: {
            size: session.buriedCards.list.length,
            entries: [...session.buriedCards.list],
        },
        previews: card === null ? null : previewsOf(session),
    };
    if (session.limits !== null) {
        result.dailyLimits = {
            remainingNew: session.limits.remainingNew(),
            remainingReviews: session.limits.remainingReviews(),
        };
    }
    return result;
}

function queueOf(session: Session): [string, string][] {
    return session
        .queue()
        .map((card) => [card.front, card.scheduleInfo?.formatScheduleAsComment() ?? "new"]);
}

function previewsOf(session: Session): Snapshot {
    const card = session.reviewSession.currentCard;
    const previews: Snapshot = {};
    for (const name of RESPONSES) {
        previews[name] = captureThrow(() => {
            const schedule = session.reviewSession.determineCardSchedule(
                ReviewResponse[name],
                card,
            );
            const text = schedule.formatScheduleAsComment();
            return name === "Reset"
                ? { text }
                : { text, label: formatScheduleInterval(schedule, false) };
        });
    }
    return previews;
}

/** Runs one step; returns what the golden file records as its result, if anything. */
async function runStep(session: Session, scenario: Scenario, step: Snapshot): Promise<unknown> {
    const label = step.label as string;
    const { reviewSession } = session;
    let match: RegExpMatchArray | null;
    if ((match = /^answer (\w+)(?: after (\d+) ms)?$/.exec(label))) {
        const response = ReviewResponse[match[1] as keyof typeof ReviewResponse];
        await reviewSession.processReview(response, match[2] === undefined ? 0 : Number(match[2]));
    } else if (label === "skip current question") {
        reviewSession.skipCurrentCard();
    } else if (label.startsWith("clock -> ")) {
        clockAt(step.clock as string);
    } else if (label === "refreshCurrentDeck") {
        reviewSession.refreshCurrentDeck();
    } else if ((match = /^learnAhead\((\d+) ms\)$/.exec(label))) {
        return reviewSession.learnAhead(Number(match[1]));
    } else if ((match = /^setCurrentDeck\((.+)\)$/.exec(label))) {
        session.setCurrentDeck(match[1]);
    } else if (label === "reading stats must not wake pending cards") {
        return reviewSession.getDeckStats(TopicPath.emptyPath).cardsInQueueCount;
    } else if (label === "undoLastAnswer") {
        return UndoResult[await reviewSession.undoLastAnswer()];
    } else if (label === "suspendCurrentCard") {
        await reviewSession.suspendCurrentCard();
    } else if (label === "buryCurrentCard") {
        await reviewSession.buryCurrentCard();
    } else if ((match = /^setFlagCurrentCard\((\d+)\)$/.exec(label))) {
        await reviewSession.setFlagCurrentCard(Number(match[1]));
    } else if (label === "deleteCurrentCardFromNote") {
        await reviewSession.deleteCurrentCardFromNote();
    } else if (label === "updateCurrentQuestionTextAndCards") {
        await reviewSession.updateCurrentQuestionTextAndCards(EDITED_TEXT[scenario.id]);
    } else if (
        (match = /^edit the note behind the session's back: "(.*)" -> "(.*)"$/.exec(label))
    ) {
        session.text = session.text.replace(match[1], match[2]);
    } else if (label === "make the review log fail every append") {
        session.log.failAppends = true;
    } else if (label.startsWith("reopen ")) {
        await session.reopen();
    } else if (label.startsWith("clear the buried-cards list")) {
        session.buriedCards.clear();
    } else {
        throw new Error(`unknown step: ${label}`);
    }
    return undefined;
}

/** Replays a scenario and returns a snapshot after every step, with the card ids numbered as the golden file does. */
export async function replay(scenario: Scenario): Promise<Snapshot[]> {
    const { setup } = scenario;
    clockAt(scenario.steps[0].clock as string);
    const session = await Session.open(setup.text, {
        algorithm: setup.algorithm === "SM2" ? SchedulerKind.SM2 : SchedulerKind.FSRS,
        mode: setup.mode === "cram" ? FlashcardReviewMode.Cram : FlashcardReviewMode.Review,
        settings: setup.settings,
        limits: setup.limits,
    });

    const notices = Notice as unknown as jest.Mock;
    const output: string[] = [];
    const record = (level: string) => (message: string) => output.push(`${level}: ${message}`);
    const warn = jest.spyOn(console, "warn").mockImplementation(record("warn"));
    const error = jest.spyOn(console, "error").mockImplementation(record("error"));

    const snapshots: Snapshot[] = [];
    try {
        for (const step of scenario.steps) {
            notices.mockClear();
            output.splice(0);
            let result: unknown;
            if (step.step !== 0) {
                try {
                    result = await runStep(session, scenario, step);
                } catch (thrown) {
                    result = { throws: (thrown as Error).message };
                }
            }
            const taken: Snapshot = {
                step: step.step,
                label: step.label,
                clock: globalDateProvider.now.toISOString(),
            };
            if (result !== undefined) taken.result = result;
            if (notices.mock.calls.length > 0)
                taken.notices = (notices.mock.calls as string[][]).map((call) => call[0]);
            if (output.length > 0) taken.console = [...output];
            snapshots.push({ ...taken, ...snapshot(session, setup.statsTags) });
        }
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
    return numberCardIds(snapshots);
}

/** Card ids in order of first appearance become c1, c2, ...: in each snapshot's note text, then its log entries. */
export function numberCardIds(snapshots: Snapshot[]): Snapshot[] {
    const names = new Map<string, string>();
    const nameOf = (id: string): string => {
        if (!names.has(id)) names.set(id, `c${names.size + 1}`);
        return names.get(id);
    };
    return snapshots.map((taken) => {
        const copy: Snapshot = { ...taken };
        if (typeof copy.noteText === "string") {
            copy.noteText = copy.noteText.replace(
                /,id=([0-9a-z]+)/g,
                (_all, id: string) => `,id=${nameOf(id)}`,
            );
        }
        if (Array.isArray(copy.reviewLog)) {
            // As the golden file does, an empty id (a cram answer to a card that never had one) is numbered too
            copy.reviewLog = copy.reviewLog.map((entry: { c: string }) => ({
                ...entry,
                c: nameOf(entry.c),
            }));
        }
        const current = copy.current as { meta: { id: string | null } } | null;
        if (current && current.meta.id !== null) {
            copy.current = { ...current, meta: { ...current.meta, id: nameOf(current.meta.id) } };
        }
        return copy;
    });
}
