import { ExamDraft, unfinishedDrafts } from "src/exam/exam-draft";
import type SRPlugin from "src/main";

/**
 * Where unfinished exams are kept: the plugin's data (`data.json`), not a file in the vault, so a draft never shows up
 * as a note and never syncs as one. Progress is saved after every answer, flag and move, and every few seconds while
 * the clock runs; saves that pile up are written as one.
 */

// The exams on screen in this session. They are open, not unfinished, so they are not offered for resuming
const live = new Set<string>();

export function markExamLive(id: string): void {
    live.add(id);
}

export function markExamGone(id: string): void {
    live.delete(id);
}

/** The unfinished exams, newest first. */
export function unfinishedExams(plugin: SRPlugin): ExamDraft[] {
    return unfinishedDrafts(plugin.dataManager.data.examDrafts, live);
}

interface Writer {
    writing: boolean;
    dirty: boolean;
}

const writers = new WeakMap<SRPlugin, Writer>();

/** Writes the plugin's data; a request made during a write is written after it, once, so saves never overlap. */
async function flush(plugin: SRPlugin): Promise<void> {
    let writer = writers.get(plugin);
    if (writer === undefined) {
        writer = { writing: false, dirty: false };
        writers.set(plugin, writer);
    }
    if (writer.writing) {
        writer.dirty = true;
        return;
    }
    writer.writing = true;
    try {
        do {
            writer.dirty = false;
            await plugin.dataManager.pluginDataManager.savePluginData();
        } while (writer.dirty);
    } catch (error) {
        // The exam goes on; the next save tries again
        console.error("Flashcard Studio: could not save the progress of the exam", error);
    } finally {
        writer.writing = false;
    }
}

export function saveExamDraft(plugin: SRPlugin, draft: ExamDraft): void {
    const data = plugin.dataManager.data;
    data.examDrafts ??= {};
    data.examDrafts[draft.id] = draft;
    void flush(plugin);
}

/** Forgets a draft: the exam was submitted or discarded. */
export function discardExamDraft(plugin: SRPlugin, id: string): void {
    const drafts = plugin.dataManager.data.examDrafts;
    if (drafts === undefined || !(id in drafts)) return;

    delete drafts[id];
    void flush(plugin);
}

/** What an exam screen needs to save its progress and to drop it, for the plugin. */
export function persistenceFor(plugin: SRPlugin): {
    persist: (draft: ExamDraft) => void;
    discard: (id: string) => void;
} {
    return {
        persist: (draft) => saveExamDraft(plugin, draft),
        discard: (id) => discardExamDraft(plugin, id),
    };
}
