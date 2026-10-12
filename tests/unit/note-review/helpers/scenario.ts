import { DEFAULT_SETTINGS, SettingsUtil, StudioSettings } from "src/data/settings-model";
import { VaultIndex } from "src/data/vault-core";
import { isInExamsFolder } from "src/exam/exam-results-file";
import { NoteReviewQueue } from "src/note-review/note-review-queue";

import { FakeVault } from "../../scheduling/sm2/fake-vault";

/** Freezes the wall clock (Date, so moment() and Date.now() agree). `iso` is read in the process time zone. */
export function freezeAt(iso: string): void {
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            "setTimeout",
            "setInterval",
            "setImmediate",
            "clearTimeout",
            "clearInterval",
            "clearImmediate",
            "nextTick",
            "queueMicrotask",
            "performance",
        ],
    });
}

/** Local "YYYY-MM-DD HH:mm" of a millisecond value, with the raw value. */
export function when(ms: number): { local: string; ms: number } {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return {
        local: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
        ms,
    };
}

export function settingsWith(over: Partial<StudioSettings> = {}): StudioSettings {
    return {
        ...DEFAULT_SETTINGS,
        tagsToReview: [...DEFAULT_SETTINGS.tagsToReview],
        noteTagsToIgnore: [],
        noteFoldersToIgnore: [...DEFAULT_SETTINGS.noteFoldersToIgnore],
        ...over,
    };
}

/** The loop of DataManager.loadVault, built from the same helper functions (the loop needs a running plugin). */
export async function scanLikeLoadVault(
    vault: FakeVault,
    core: VaultIndex,
    settings: StudioSettings,
): Promise<string[]> {
    const skipped: string[] = [];
    core.loadInitialStateOfCore();
    for (const file of vault.files()) {
        const folder = settings.reviewLogFolder.replace(/\/+$/, "");
        const inReviewLog = folder.length > 0 && file.path.startsWith(folder + "/");
        if (inReviewLog || isInExamsFolder(file.path)) {
            skipped.push(file.path + " (history folder)");
            continue;
        }
        if (SettingsUtil.isPathInFoldersToIgnore(settings, file.path)) {
            skipped.push(file.path + " (ignored folder)");
            continue;
        }
        await core.processFile(file);
    }
    await core.finalizeLoad();
    return skipped;
}

export function queueDump(queue: NoteReviewQueue) {
    return {
        deckOrder: queue.reviewDeckNameList,
        dueNotesCount: queue.dueNotesCount,
        decks: [...queue.reviewDecks.values()].map((d) => ({
            deck: d.deckName,
            dueNotesCount: d.dueNotesCount,
            newNotes: d.newNotes.map((f) => f.path),
            scheduledNotes: d.scheduledNotes.map((s) => ({
                path: s.note.path,
                due: when(s.dueUnix),
            })),
            activeFolders: [...d.activeFolders],
        })),
    };
}
