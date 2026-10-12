import type { DataManager } from "src/data/data-hub";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { allowanceFor } from "src/scheduling/custom-study";
import { countToday, DailyLimits, monthsCovering } from "src/scheduling/daily-limits";
import { isReviewCard } from "src/scheduling/schedule/fsrs-state";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import type FlashcardStudioPlugin from "src/studio-plugin";
import type { UIManager } from "src/ui/studio-ui";
import { globalDateProvider } from "src/utils/clock";

const CLOSED_UI_STATE = 0 as UIManager["uiState"];
const REVIEW_MODE = 1;

/** Checks for cards that can still be studied today and sends the configured reminder. */
export class ReminderManager {
    private timer: number | null = null;
    /** Counts the starts and stops of the reminders: a check belongs to the one it began under. */
    private generation = 0;
    /** The generation whose check is running, if one is. */
    private checkingGeneration: number | null = null;

    constructor(
        private readonly plugin: FlashcardStudioPlugin,
        private readonly uiManager: UIManager,
        private readonly dataManager: DataManager,
    ) {}

    public restartReviewReminders(): void {
        this.stopReviewReminders();
        if (!this.plugin.isInitialized || !this.settings.enableReviewReminders) return;

        if (this.settings.reviewReminderCheckOnStartup) void this.check();
        this.timer = this.plugin.registerInterval(
            window.setInterval((): void => void this.check(), this.intervalMinutes() * 60_000),
        );
    }

    public stopReviewReminders(): void {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        // A check in flight is not cut off, only made stale: it ends without saying anything
        this.generation++;
    }

    private get settings() {
        return this.dataManager.settingsManager.settings;
    }

    private intervalMinutes(): number {
        const minutes = this.settings.reviewReminderIntervalMinutes;
        if (!Number.isFinite(minutes) || minutes < 1) {
            return DEFAULT_SETTINGS.reviewReminderIntervalMinutes;
        }
        return Math.min(minutes, 1440);
    }

    private async check(): Promise<void> {
        const generation = this.generation;
        if (
            !this.plugin.isInitialized ||
            !this.dataManager.isDataLoaded() ||
            !this.dataManager.isVaultIndexLoaded() ||
            this.checkingGeneration === generation ||
            !this.settings.enableReviewReminders ||
            this.reviewIsActive() ||
            this.userIsTyping() ||
            this.dataManager.syncLock
        ) {
            return;
        }

        this.checkingGeneration = generation;
        try {
            await this.dataManager.sync();
            const deck = this.dataManager.vaultIndex.remainingRoot;
            if (
                deck === null ||
                (await this.eligibleCardCount()) === 0 ||
                generation !== this.generation ||
                this.reviewIsActive() ||
                this.userIsTyping()
            ) {
                return;
            }

            await this.uiManager.notifyReviewReminder();
            if (this.settings.reviewReminderAutoOpen) {
                await this.uiManager.openDeckContainer(REVIEW_MODE);
            }
        } finally {
            if (this.checkingGeneration === generation) this.checkingGeneration = null;
        }
    }

    private reviewIsActive(): boolean {
        return this.uiManager.uiState !== CLOSED_UI_STATE || this.uiManager.isStudioInFocus;
    }

    private userIsTyping(): boolean {
        const element = activeDocument.activeElement;
        if (!element.instanceOf(HTMLElement)) return false;
        return (
            element.matches("textarea, input") ||
            element.isContentEditable ||
            element.getAttribute("contenteditable") === "true" ||
            element.closest(".cm-editor, .markdown-source-view") !== null
        );
    }

    private async eligibleCardCount(): Promise<number> {
        const limits = await this.todayLimits();
        const deck = this.dataManager.vaultIndex.remainingRoot;
        if (deck === null) return 0;

        const newAllowed = limits.remainingNew() > 0;
        const reviewsAllowed = limits.remainingReviews() > 0;
        const cards = new Set(deck.getFlattenedReviewItemArray(ReviewItemState.AnyItem, true));
        return [...cards].filter(
            (card) =>
                (!card.isNew && !isReviewCard(card.scheduleInfo)) ||
                (card.isNew ? newAllowed : reviewsAllowed),
        ).length;
    }

    private async todayLimits(): Promise<DailyLimits> {
        const dayStartMs = globalDateProvider.today.valueOf();
        const nowMs = globalDateProvider.now.valueOf();
        const entries = await this.dataManager.reviewLog.readMonths(
            monthsCovering(dayStartMs, nowMs),
        );
        return new DailyLimits(
            this.settings,
            countToday(entries, dayStartMs),
            allowanceFor(
                this.dataManager.data.limitOverride,
                globalDateProvider.today.format("YYYY-MM-DD"),
            ),
        );
    }
}
