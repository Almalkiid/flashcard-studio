import { DataStore } from "src/data/data-store/base/data-store";
import { DataStoreAlgorithm } from "src/data/data-store/base/data-store-algorithm";
import { NoteDataStoreAlgorithmOsr } from "src/data/data-store/notes-data-store/note-data-store-algorithm-osr";
import { NotesDataStore } from "src/data/data-store/notes-data-store/notes-data-store";
import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { SrsAlgorithmFsrs } from "src/scheduling/algorithms/fsrs/sr-algorithm-fsrs";
import { SRAlgorithmOsr } from "src/scheduling/algorithms/osr/srs-algorithm-osr";
import { DailyLimits, TodayCounts } from "src/scheduling/daily-limits";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
    IReviewLogSink,
    UndoRecord,
} from "src/scheduling/flashcard-review-sequencer";
import { UndoHistory } from "src/scheduling/undo-history";

import { SampleItemDecks } from "../sample-items";
import { UnitTestSRFile } from "./unit-test-file";
import { UnitTestFileModifier } from "./unit-test-file-modifiers";

export const ORDER_SEQUENTIAL: IIteratorOrder = {
    repItemOrder: RepItemOrder.DueFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

/**
 * In-memory review log used by the sequencer tests.
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
    algorithm?: SRAlgorithmType;
    mode?: FlashcardReviewMode;
    settings?: Partial<SRSettings>;
    limits?: { newCardsPerDay: number; reviewsPerDay: number; counts?: TodayCounts } | null;
    path?: string;
}

/**
 * A review session over one note held in memory, wired the same way ReviewQueueLoader wires the real one.
 */
export class ReviewSessionContext {
    settings: SRSettings;
    file: UnitTestSRFile;
    log: FakeReviewLog = new FakeReviewLog();
    limits: DailyLimits | null = null;
    sequencer: FlashcardReviewSequencer;
    postponementList: QuestionPostponementList;
    histogram: CardDueDateHistogram = new CardDueDateHistogram();
    /** Shared across reopen(), as the review screen shares it across queue reloads. */
    undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>();
    private mode: FlashcardReviewMode;

    static async create(text: string, options: SessionOptions = {}): Promise<ReviewSessionContext> {
        const context = new ReviewSessionContext();
        context.settings = {
            ...DEFAULT_SETTINGS,
            algorithm: options.algorithm ?? SRAlgorithmType.FSRS,
            ...options.settings,
        };
        context.mode = options.mode ?? FlashcardReviewMode.Review;
        context.file = new UnitTestSRFile(text, options.path ?? "CIA/Part1/Deck.md");

        DataStore.instance = new NotesDataStore(context.settings, new UnitTestFileModifier());
        DataStoreAlgorithm.instance = new NoteDataStoreAlgorithmOsr(context.settings);
        SRAlgorithm.instance =
            context.settings.algorithm === SRAlgorithmType.FSRS
                ? new SrsAlgorithmFsrs(context.settings)
                : new SRAlgorithmOsr(context.settings);

        context.postponementList = new QuestionPostponementList(null, context.settings, []);
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
        this.sequencer = new FlashcardReviewSequencer(
            this.mode,
            new DeckTreeIterator(ORDER_SEQUENTIAL, null),
            this.settings,
            SRAlgorithm.getInstance(),
            this.postponementList,
            this.histogram,
            this.log,
            this.limits,
            this.undoHistory,
        );
        const deckTree: Deck = await SampleItemDecks.createDeckFromFile(
            this.file,
            new TopicPath(["Root"]),
        );
        const remaining = DeckTreeFilter.filterForRemainingRepItems(
            this.postponementList,
            deckTree,
            this.mode,
        );
        this.sequencer.setDeckTree(deckTree, remaining);
    }

    get text(): string {
        return this.file.content;
    }

    get currentFront(): string | null {
        return this.sequencer.currentCard?.front ?? null;
    }
}
