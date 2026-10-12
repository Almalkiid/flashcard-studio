import { Notice } from "obsidian";

import { DataStore } from "src/data/data-store/store";
import { importLegacySettings } from "src/data/legacy-settings-migration";
import type { StoredKey } from "src/settings/adapters";
import type { SettingsContext } from "src/settings/context";
import { resetSettingsInPlace } from "src/settings/fresh-defaults";

/** What went wrong, as text for a notice: an Error's message, or whatever else was thrown turned into text. */
export function errorMessage(error: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- String() is the correct way to convert unknown to string
    return error instanceof Error ? error.message : String(error);
}

/** Says that an action did not finish and why, in a notice and in the console; for a task nobody awaits. */
export function reportFailure(error: unknown): void {
    new Notice("Couldn't finish: " + errorMessage(error));
    console.error("Couldn't finish the action", error);
}

/**
 * Puts every option back to how a new install starts, in the settings object itself, then applies and saves it.
 * Anything kept outside `settings` (the bury list, today's limit override) is not touched.
 */
export async function resetAllSettings(ctx: SettingsContext): Promise<void> {
    const changed = resetSettingsInPlace(ctx.settings);
    await ctx.commit(changed);
    ctx.rebuild();
    new Notice("Settings reset.");
}

/**
 * Copies the original Spaced Repetition plugin's settings in. The import saves and says how many it copied; this
 * applies every effect again and redraws. It does nothing more when there was nothing to import, and it never
 * rejects: a failure is shown.
 */
export async function importFromLegacyPlugin(ctx: SettingsContext): Promise<void> {
    try {
        const imported = await importLegacySettings(ctx.plugin);
        if (imported === null) return;
        // The provider never comes from the import, and committing it would reset the chosen model.
        const keys = (Object.keys(ctx.settings) as StoredKey[]).filter(
            (key) => key !== "aiProvider",
        );
        await ctx.commit(keys);
        ctx.rebuild();
    } catch (error) {
        // The row runs this without waiting, so a failure has nowhere to go but the person.
        reportFailure(error);
    }
}

/**
 * Removes the schedules from every note in the vault, from the notes only, or from the cards only, and the tags too
 * when that option is on. The file modifier says when it is done.
 */
export async function deleteSchedules(
    ctx: SettingsContext,
    which: "all" | "notes" | "cards",
): Promise<void> {
    const {
        deleteTagsOnSchedulingDataDeletion: deleteTags,
        flashcardTags,
        tagsToReview,
    } = ctx.settings;
    const fileModifier = DataStore.instance.fileModifier;
    switch (which) {
        case "all":
            await fileModifier.deleteAllSchedulingData(deleteTags, flashcardTags, tagsToReview);
            break;
        case "notes":
            await fileModifier.deleteAllSchedulingDataInNotes(deleteTags, tagsToReview);
            break;
        case "cards":
            await fileModifier.deleteAllSchedulingDataInCards(deleteTags, flashcardTags);
            break;
    }
}

/** Rewrites the schedules kept in comments as callouts, in every note that has one. */
export async function moveCommentsIntoCallouts(_ctx: SettingsContext): Promise<void> {
    const skipped = await DataStore.instance.fileModifier.migrateCommentsToCallouts();
    new Notice(
        skipped
            ? `Schedules moved. ${skipped} stayed where they were, in a table or a list.`
            : "Schedules moved.",
    );
}
