import { normalizePath, Notice, TFile } from "obsidian";

import { Question, QuestionText } from "src/data/data-structures/card/question";
import { t } from "src/lang/translate";
import { customStudyMode, CustomStudySpec } from "src/scheduling/custom-study";
import { formatRevlogCsv, revlogCsvFileName } from "src/scheduling/optimizer/revlog-csv";
import { cardsToPostpone, postponeInText } from "src/scheduling/postpone";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { PostponeModal } from "src/ui/obsidian-ui-components/modals/postpone-modal";
import { globalDateProvider } from "src/utils/clock";

/**
 * Opens the Custom study dialog from the command palette. A session it starts opens in a new review screen.
 */
export function openCustomStudy(plugin: FlashcardStudioPlugin): void {
    new CustomStudyModal(plugin.app, plugin, {
        onLimitsChanged: () => {
            // Nothing is open, so the next review screen reads the new limits
        },
        onStartSession: (spec: CustomStudySpec) => {
            void plugin.uiManager.openDeckContainer(customStudyMode(spec), undefined, spec);
        },
    }).open();
}

/**
 * Asks how many days to postpone by and, after a confirmation that shows how many cards move, moves every review
 * card that is due today or overdue.
 */
export async function openPostpone(plugin: FlashcardStudioPlugin): Promise<void> {
    await plugin.dataManager.sync();
    const todayStartMs = globalDateProvider.today.valueOf();
    const count = cardsToPostpone(
        plugin.dataManager.vaultIndex.reviewableRoot.getFlattenedReviewItemArray(
            ReviewItemState.AnyItem,
            true,
        ),
        todayStartMs,
    ).length;

    new PostponeModal(plugin.app, count, (days) => postponeDueReviews(plugin, days)).open();
}

/**
 * Postpones the due review cards by `days` days. Each note is rewritten once, atomically, so a card's schedule is
 * never read and written by two steps that another change could come between.
 *
 * @returns How many cards were postponed.
 */
export async function postponeDueReviews(
    plugin: FlashcardStudioPlugin,
    days: number,
): Promise<number> {
    await plugin.dataManager.sync();
    const todayStartMs = globalDateProvider.today.valueOf();
    const cards = cardsToPostpone(
        plugin.dataManager.vaultIndex.reviewableRoot.getFlattenedReviewItemArray(
            ReviewItemState.AnyItem,
            true,
        ),
        todayStartMs,
    );

    // Only the cards that were counted and confirmed move, not every segment that happens to be due
    const chosen = new Map<Question, Set<number>>();
    for (const card of cards) {
        chosen.set(card.question, (chosen.get(card.question) ?? new Set()).add(card.cardIdx));
    }

    let moved = 0;
    const { settings } = plugin.dataManager.settingsManager;
    for (const [question, indices] of chosen) {
        const result = postponeInText(
            question.questionText.original,
            { todayStartMs, days },
            indices,
        );
        if (result.count === 0 || !(await question.replaceOriginalText(result.text))) continue;
        // The question is the new text now, which moves the questions after it
        question.questionText = QuestionText.create(
            result.text,
            question.questionText.textDirection,
            settings,
        );
        moved += result.count;
    }
    await plugin.dataManager.sync();
    return moved;
}

/**
 * Writes the review log to the vault root as the CSV the FSRS optimizer reads, for running the official optimizer.
 */
export async function exportRevlogCsv(plugin: FlashcardStudioPlugin): Promise<void> {
    const entries = (await plugin.dataManager.reviewLog.readAll()).filter(
        (entry) => entry.c !== "",
    );
    if (entries.length === 0) {
        new Notice(t("EXPORT_REVLOG_EMPTY"));
        return;
    }

    const path = normalizePath(revlogCsvFileName(globalDateProvider.today.format("YYYY-MM-DD")));
    const csv = formatRevlogCsv(entries);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await plugin.app.vault.modify(existing, csv);
    else await plugin.app.vault.create(path, csv);
    new Notice(t("EXPORT_REVLOG_DONE", { count: entries.length, path }));
}
