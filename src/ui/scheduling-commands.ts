import { normalizePath, Notice, TFile } from "obsidian";

import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { customStudyMode, CustomStudySpec } from "src/scheduling/custom-study";
import { formatRevlogCsv, revlogCsvFileName } from "src/scheduling/optimizer/revlog-csv";
import { cardsToPostpone, postponeInText } from "src/scheduling/postpone";
import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { PostponeModal } from "src/ui/obsidian-ui-components/modals/postpone-modal";
import { globalDateProvider } from "src/utils/dates";

/**
 * Opens the Custom study dialog from the command palette. A session it starts opens in a new review screen.
 */
export function openCustomStudy(plugin: SRPlugin): void {
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
export async function openPostpone(plugin: SRPlugin): Promise<void> {
    await plugin.dataManager.sync();
    const todayStartMs = globalDateProvider.today.valueOf();
    const count = cardsToPostpone(
        plugin.dataManager.osrCore.reviewableDeckTree.getFlattenedRepItemArray(
            RepItemState.AnyItem,
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
export async function postponeDueReviews(plugin: SRPlugin, days: number): Promise<number> {
    await plugin.dataManager.sync();
    const todayStartMs = globalDateProvider.today.valueOf();
    const cards = cardsToPostpone(
        plugin.dataManager.osrCore.reviewableDeckTree.getFlattenedRepItemArray(
            RepItemState.AnyItem,
            true,
        ),
        todayStartMs,
    );

    const files = new Map<string, TFile>();
    for (const card of cards) {
        const file = card.question.note.file;
        files.set(file.path, file.tfile);
    }

    let moved = 0;
    for (const file of files.values()) {
        await plugin.app.vault.process(file, (text) => {
            const result = postponeInText(text, { todayStartMs, days });
            moved += result.count;
            return result.text;
        });
    }
    await plugin.dataManager.sync();
    return moved;
}

/**
 * Writes the review log to the vault root as the CSV the FSRS optimizer reads, for running the official optimizer.
 */
export async function exportRevlogCsv(plugin: SRPlugin): Promise<void> {
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
