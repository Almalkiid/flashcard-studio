import { TFile } from "obsidian";

import { Deck, DeckFilter } from "src/data/decks/deck";
import { DeckOrder, DeckWalker, IIteratorOrder, PickOrder } from "src/data/decks/walker";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { StudioSettings } from "src/data/settings-model";
import { VaultIndex } from "src/data/vault-core";
import {
    allowanceFor,
    buildCustomStudyTree,
    CustomStudyContext,
    CustomStudySpec,
    forgottenCardIds,
    monthsBetween,
} from "src/scheduling/custom-study";
import { countToday, DailyLimits, monthsCovering } from "src/scheduling/daily-limits";
import { createCardRisk, reviewOrderOf } from "src/scheduling/review/review-order";
import {
    FlashcardReviewMode,
    IReviewSession,
    ReviewSession,
    UndoRecord,
} from "src/scheduling/review/review-session";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";
import { UndoHistory } from "src/scheduling/undo-history";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { globalDateProvider } from "src/utils/clock";

/** The enum member called `name`, or `fallback` when the settings hold a name the enum does not have. */
function member<E extends Record<string, string | number>>(
    names: E,
    name: string,
    fallback: E[keyof E],
): E[keyof E] {
    const value = names[name];
    return typeof value === "number" ? (value as E[keyof E]) : fallback;
}

/** The order in which a session serves its cards and decks, from the two settings that choose it. */
export function iteratorOrderFor(settings: StudioSettings): IIteratorOrder {
    return {
        pickOrder: member(PickOrder, settings.flashcardCardOrder, PickOrder.DueFirstSequential),
        deckOrder: member(
            DeckOrder,
            settings.flashcardDeckOrder,
            DeckOrder.PrevDeckComplete_Sequential,
        ),
        reviewOrder: reviewOrderOf(settings.reviewOrder),
        riskOf: createCardRisk(settings, globalDateProvider.nowMs),
    };
}

/**
 * Builds the queue of one study session: which cards, in which order, under which limits. The review screen asks
 * for a new queue each time it needs one (after a deck, a mode change or an undo), and the loader scans the vault
 * first so that a queue is never built from a half-loaded one.
 */
export class ReviewQueueLoader {
    constructor(
        private readonly plugin: FlashcardStudioPlugin,
        private readonly vaultIndex: VaultIndex,
        private readonly singleNote: TFile | null,
        private reviewMode: FlashcardReviewMode,
        // A custom study session serves its own cards in place of the normal queue
        private customStudy: CustomStudySpec | null = null,
        // Show the deck list even when only one deck has cards, which would otherwise open that deck's cards at once
        private readonly stayOnDeckList: boolean = false,
    ) {}

    public opensOnDeckList(): boolean {
        return this.stayOnDeckList;
    }

    public getCustomStudy(): CustomStudySpec | null {
        return this.customStudy;
    }

    public setCustomStudy(customStudy: CustomStudySpec | null): void {
        this.customStudy = customStudy;
    }

    public getSingleNote(): TFile | null {
        return this.singleNote;
    }

    public getReviewMode(): FlashcardReviewMode {
        return this.reviewMode;
    }

    public setReviewMode(reviewMode: FlashcardReviewMode): void {
        this.reviewMode = reviewMode;
    }

    /**
     * @param undoHistory - Answers that can still be undone, shared across the queues of one review screen.
     */
    public async loadReviewQueue(
        undoHistory: UndoHistory<UndoRecord> = new UndoHistory<UndoRecord>(),
    ): Promise<IReviewSession> {
        const data = this.plugin.dataManager;
        await data.sync();

        let fullTree: Deck;
        let remainingTree: Deck;
        if (this.customStudy !== null) {
            fullTree = buildCustomStudyTree(
                this.vaultIndex.reviewableRoot,
                this.customStudy,
                await this.loadCustomStudyContext(this.customStudy),
            );
            // The review session removes cards from the remaining tree as they are answered; the full tree keeps the counts
            remainingTree = fullTree.clone();
        } else if (this.singleNote !== null) {
            fullTree = new Deck("root", null);
            (await data.loadNote(this.singleNote))?.appendCardsToDeck(fullTree);
            remainingTree = DeckFilter.filterForRemainingReviewItems(
                this.vaultIndex.buriedCards,
                fullTree,
                this.reviewMode,
            );
        } else {
            fullTree = this.vaultIndex.reviewableRoot;
            // The session uses its cards up, so it gets a copy and the scan's trees stay whole
            remainingTree = this.vaultIndex.sessionTree(this.reviewMode);
        }

        // Custom study is not held to the daily limits, as in Anki's filtered decks
        const dailyLimits =
            this.reviewMode === FlashcardReviewMode.Review && this.customStudy === null
                ? await this.loadDailyLimits()
                : null;

        const settings = data.data.settings;
        const reviewSession = new ReviewSession(
            this.reviewMode,
            new DeckWalker(iteratorOrderFor(settings), null),
            settings,
            ActiveScheduler.getInstance(),
            this.vaultIndex.buriedCards,
            this.vaultIndex.dueDateFlashcardHistogram,
            data.reviewLog,
            dailyLimits,
            undoHistory,
        );
        reviewSession.setDeckRoot(fullTree, remainingTree);
        return reviewSession;
    }

    /**
     * Today's new and review allowance, from the review logs of every device.
     */
    private async loadDailyLimits(): Promise<DailyLimits> {
        const settings: StudioSettings = this.plugin.dataManager.data.settings;
        const dayStartMs: number = globalDateProvider.today.valueOf();
        const nowMs: number = globalDateProvider.now.valueOf();
        let entries: ReviewLogEntry[] = [];
        try {
            entries = await this.plugin.dataManager.reviewLog.readMonths(
                monthsCovering(dayStartMs, nowMs),
            );
        } catch (error) {
            console.error(
                "Flashcard Studio: could not read the review log for daily limits",
                error,
            );
        }
        const todayYmd: string = globalDateProvider.today.format("YYYY-MM-DD");
        return new DailyLimits(
            settings,
            countToday(entries, dayStartMs),
            allowanceFor(this.plugin.dataManager.data.limitOverride, todayYmd),
        );
    }

    /**
     * What a custom study session needs to know about now, and, for forgotten cards, the ids of the cards answered
     * Again in the period from the review log of every device.
     */
    private async loadCustomStudyContext(spec: CustomStudySpec): Promise<CustomStudyContext> {
        const nowMs: number = globalDateProvider.now.valueOf();
        const context: CustomStudyContext = {
            nowMs,
            todayYmd: globalDateProvider.today.format("YYYY-MM-DD"),
            forgottenIds: new Set<string>(),
        };
        if (spec.type !== "forgotten") return context;

        // "The last N days" counts today as the first day
        const sinceMs: number =
            spec.sinceMs ??
            globalDateProvider.today
                .clone()
                .subtract(Math.max(1, spec.days) - 1, "d")
                .valueOf();
        try {
            const entries = await this.plugin.dataManager.reviewLog.readMonths(
                monthsBetween(sinceMs, nowMs),
            );
            context.forgottenIds = forgottenCardIds(entries, sinceMs);
        } catch (error) {
            console.error(
                "Flashcard Studio: could not read the review log for custom study",
                error,
            );
        }
        return context;
    }
}
