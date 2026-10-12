import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore, DataStoreAlgorithm, IFileModifier } from "src/data/data-store/store";
import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { Deck, DeckFilter } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { DeckOrder, DeckWalker, IIteratorOrder, PickOrder } from "src/data/decks/walker";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { DailyLimits, TodayCounts } from "src/scheduling/daily-limits";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import {
    FlashcardReviewMode,
    IReviewLogSink,
    ReviewSession,
    UndoRecord,
} from "src/scheduling/review/review-session";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { UndoHistory } from "src/scheduling/undo-history";

import { UnitTestNoteFile } from "../support/memory-note";
import { SampleItemDecks } from "../support/sample-decks";

export const ORDER_SEQUENTIAL: IIteratorOrder = {
    pickOrder: PickOrder.DueFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

/**
 * In-memory review log used by the review session tests.
 */
export class FakeReviewLog implements IReviewLogSink {
    entries: ReviewLogEntry[] = [];
    failAppends: boolean = false;

    async append(entry: ReviewLogEntry): Promise<void> {
        if (this.failAppends) throw new Error("disk full");
        this.entries.push(entry);
    }

    async remove(entry: ReviewLogEntry): Promise<boolean> {
        const index = this.entries.lastIndexOf(entry);
        if (index < 0) return false;
        this.entries.splice(index, 1);
        return true;
    }
}

export interface SessionOptions {
    algorithm?: SchedulerKind;
    mode?: FlashcardReviewMode;
    settings?: Partial<StudioSettings>;
    limits?: { newCardsPerDay: number; reviewsPerDay: number; counts?: TodayCounts } | null;
    path?: string;
}

/**
 * A review session over one note held in memory, wired the same way ReviewQueueLoader wires the real one.
 */
export class ReviewSessionContext {
    settings: StudioSettings;
    file: UnitTestNoteFile;
    log: FakeReviewLog = new FakeReviewLog();
    limits: DailyLimits | null = null;
    reviewSession: ReviewSession;
    buriedCards: BuriedCards;
    histogram: CardDueDateHistogram = new CardDueDateHistogram();
    /** Shared across reopen(), as the review screen shares it across queue reloads. */
    undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>();
    private mode: FlashcardReviewMode;

    static async create(text: string, options: SessionOptions = {}): Promise<ReviewSessionContext> {
        const context = new ReviewSessionContext();
        context.settings = {
            ...DEFAULT_SETTINGS,
            algorithm: options.algorithm ?? SchedulerKind.FSRS,
            ...options.settings,
        };
        context.mode = options.mode ?? FlashcardReviewMode.Review;
        context.file = new UnitTestNoteFile(text, options.path ?? "CIA/Part1/Deck.md");

        DataStore.instance = new NotesDataStore(context.settings, {} as IFileModifier);
        DataStoreAlgorithm.instance = new Sm2NoteStore(context.settings);
        ActiveScheduler.instance =
            context.settings.algorithm === SchedulerKind.FSRS
                ? new FsrsCardScheduler(context.settings)
                : new Sm2Scheduler(context.settings);

        context.buriedCards = new BuriedCards(null, context.settings, []);
        if (options.limits) {
            context.limits = new DailyLimits(
                {
                    dailyLimitsEnabled: true,
                    newCardsPerDay: options.limits.newCardsPerDay,
                    reviewsPerDay: options.limits.reviewsPerDay,
                },
                options.limits.counts ?? { newDone: 0, reviewsDone: 0 },
            );
        }
        await context.reopen();
        return context;
    }

    /**
     * Re-reads the note and starts a new session, as if the user closed and reopened the review.
     */
    async reopen(): Promise<void> {
        this.reviewSession = new ReviewSession(
            this.mode,
            new DeckWalker(ORDER_SEQUENTIAL, null),
            this.settings,
            ActiveScheduler.getInstance(),
            this.buriedCards,
            this.histogram,
            this.log,
            this.limits,
            this.undoHistory,
        );
        const deckRoot: Deck = await SampleItemDecks.createDeckFromFile(
            this.file,
            new TopicPath(["Root"]),
        );
        const remaining = DeckFilter.filterForRemainingReviewItems(
            this.buriedCards,
            deckRoot,
            this.mode,
        );
        this.reviewSession.setDeckRoot(deckRoot, remaining);
    }

    get text(): string {
        return this.file.content;
    }

    get currentFront(): string | null {
        return this.reviewSession.currentCard?.front ?? null;
    }
}
