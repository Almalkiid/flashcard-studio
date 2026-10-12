import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore, DataStoreAlgorithm, type IFileModifier } from "src/data/data-store/store";
import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { Card } from "src/data/data-structures/card/flashcard";
import { Deck, DeckFilter } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { DeckOrder, DeckWalker, IIteratorOrder, PickOrder } from "src/data/decks/walker";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import { DailyLimits, TodayCounts } from "src/scheduling/daily-limits";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { IReviewLogSink, ReviewSession, UndoRecord } from "src/scheduling/review/review-session";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { UndoHistory } from "src/scheduling/undo-history";
import { TextDirection } from "src/utils/text";

import { FakeVault } from "../sm2/fake-vault";

export const NOTE_PATH = "CIA/Part1/Deck.md";

/** The order the golden sessions ran with: due cards first, decks one after another. */
export const DUE_FIRST: IIteratorOrder = {
    pickOrder: PickOrder.DueFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

/** A review log in memory; `failAppends` makes every append throw, as a full disk would. */
export class MemoryReviewLog implements IReviewLogSink {
    entries: ReviewLogEntry[] = [];
    failAppends = false;

    async append(entry: ReviewLogEntry): Promise<void> {
        if (this.failAppends) throw new Error("disk full");
        this.entries.push(entry);
    }

    async remove(entry: ReviewLogEntry): Promise<boolean> {
        const index = this.entries.lastIndexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        return index >= 0;
    }
}

export interface SessionOptions {
    algorithm?: SchedulerKind;
    mode?: FlashcardReviewMode;
    settings?: Partial<StudioSettings>;
    limits?: { newCardsPerDay: number; reviewsPerDay: number; counts?: TodayCounts } | null;
    order?: IIteratorOrder;
}

/**
 * A review over one note held in memory, wired as the review screen wires it: the real schedulers, data store and
 * deck iterator, an in-memory review log, and the histogram, buried-cards list and undo history kept across reopens.
 */
export class Session {
    readonly vault: FakeVault;
    readonly settings: StudioSettings;
    readonly log = new MemoryReviewLog();
    readonly histogram = new CardDueDateHistogram();
    readonly undoHistory = new UndoHistory<UndoRecord>();
    readonly buriedCards: BuriedCards;
    readonly limits: DailyLimits | null;
    readonly mode: FlashcardReviewMode;
    readonly order: IIteratorOrder;
    reviewSession: ReviewSession;
    deckRoot: Deck;
    /** The tree the review session takes cards out of; it is the object handed to `setDeckRoot`. */
    remaining: Deck;
    /** The deck being reviewed, as the reviewSession was last told. */
    topicPath: TopicPath = TopicPath.emptyPath;

    private constructor(text: string, options: SessionOptions) {
        this.vault = new FakeVault({ [NOTE_PATH]: text });
        this.settings = {
            ...DEFAULT_SETTINGS,
            algorithm: options.algorithm ?? SchedulerKind.FSRS,
            ...options.settings,
        };
        this.mode = options.mode ?? FlashcardReviewMode.Review;
        this.order = options.order ?? DUE_FIRST;
        this.buriedCards = new BuriedCards(null, this.settings, []);
        this.limits = options.limits
            ? new DailyLimits(
                  { dailyLimitsEnabled: true, ...options.limits },
                  options.limits.counts ?? { newDone: 0, reviewsDone: 0 },
              )
            : null;
    }

    static async open(text: string, options: SessionOptions = {}): Promise<Session> {
        const session = new Session(text, options);
        DataStore.instance = new NotesDataStore(session.settings, {} as IFileModifier);
        DataStoreAlgorithm.instance = new Sm2NoteStore(session.settings);
        ActiveScheduler.instance =
            session.settings.algorithm === SchedulerKind.FSRS
                ? new FsrsCardScheduler(session.settings)
                : new Sm2Scheduler(session.settings);
        await session.reopen();
        session.histogram.calculateFromRoot(session.deckRoot);
        return session;
    }

    /** Reads the note again and starts a new session over it, as closing and reopening the review does. */
    async reopen(): Promise<void> {
        const note = await new NoteFileLoader(this.settings).load(
            this.vault.file(NOTE_PATH),
            TextDirection.Ltr,
            new TopicPath(["Root"]),
        );
        this.deckRoot = new Deck("Root", null);
        note.appendCardsToDeck(this.deckRoot);
        this.remaining = DeckFilter.filterForRemainingReviewItems(
            this.buriedCards,
            this.deckRoot,
            this.mode,
        );
        this.reviewSession = new ReviewSession(
            this.mode,
            new DeckWalker(this.order, null),
            this.settings,
            ActiveScheduler.getInstance(),
            this.buriedCards,
            this.histogram,
            this.log,
            this.limits,
            this.undoHistory,
        );
        this.topicPath = TopicPath.emptyPath;
        this.reviewSession.setDeckRoot(this.deckRoot, this.remaining);
    }

    setCurrentDeck(tag: string): void {
        this.topicPath = TopicPath.getTopicPathFromTag(tag);
        this.reviewSession.setCurrentDeck(this.topicPath);
    }

    get text(): string {
        return this.vault.texts.get(NOTE_PATH);
    }

    set text(text: string) {
        this.vault.texts.set(NOTE_PATH, text);
    }

    get front(): string | null {
        return this.reviewSession.currentCard?.front ?? null;
    }

    /** The cards the remaining tree would show from the current deck, in order, without touching the session. */
    queue(): Card[] {
        const iterator = new DeckWalker(this.order, this.remaining.clone());
        iterator.setIteratorTopicPath(this.topicPath);
        const cards: Card[] = [];
        while (iterator.nextReviewItem()) cards.push(iterator.currentReviewItem);
        return cards;
    }

    queueFronts(): string[] {
        return this.queue().map((card) => card.front);
    }
}
