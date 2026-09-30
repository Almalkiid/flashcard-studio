import { getDeviceId } from "src/data/review-log/device-id";
import { draftKey, draftText, ExamDraft, readDraft, unfinishedDrafts } from "src/exam/exam-draft";
import type SRPlugin from "src/main";

/**
 * Where unfinished exams are kept: a file of its own for each, in the plugin's folder (`exam-drafts/`), which is not
 * part of the notes, so a draft never shows up as a note. The file is named for the exam and for this device, as the
 * review log's are, so a draft is only ever written by the device that is taking the exam: another device's settings
 * being saved can neither drop it nor be reverted by it, and the exam is offered only where it was started.
 *
 * A draft is written when it has changed, after every answer, flag and move and when typing pauses. Saves that pile up
 * while one is being written are written as one.
 */

const FOLDER = "exam-drafts";

// The exams on screen in this session. They are open, not unfinished, so they are not offered for resuming
const live = new Set<string>();

export function markExamLive(id: string): void {
    live.add(id);
}

export function markExamGone(id: string): void {
    live.delete(id);
}

function folderOf(plugin: SRPlugin): string {
    const { manifest, app } = plugin;
    return `${manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`}/${FOLDER}`;
}

/** `<exam>-<device>.json`, e.g. `1790692103664-iphone-81c2.json`. */
function fileOf(plugin: SRPlugin, id: string): string {
    return `${folderOf(plugin)}/${id.replace(/[^\w-]/g, "_")}-${getDeviceId(plugin.app)}.json`;
}

/** One exam's file: what it holds, and the writes and the removal that are on their way, one after another. */
interface Slot {
    chain: Promise<void>;
    /** The key of the draft that is written or waiting to be written; null when the file is gone or unknown. */
    desired: string | null;
    /** The draft to write next. A newer one replaces it, so a burst of saves is written once. */
    waiting: ExamDraft | null;
}

const slots = new WeakMap<SRPlugin, Map<string, Slot>>();

function slotOf(plugin: SRPlugin, id: string): Slot {
    let all = slots.get(plugin);
    if (all === undefined) {
        all = new Map();
        slots.set(plugin, all);
    }
    let slot = all.get(id);
    if (slot === undefined) {
        slot = { chain: Promise.resolve(), desired: null, waiting: null };
        all.set(id, slot);
    }
    return slot;
}

async function ensureFolder(plugin: SRPlugin): Promise<void> {
    const adapter = plugin.app.vault.adapter;
    const folder = folderOf(plugin);
    if (await adapter.exists(folder)) return;
    try {
        await adapter.mkdir(folder);
    } catch (error) {
        // Another exam made it a moment ago
        if (!(await adapter.exists(folder))) throw error;
    }
}

async function put(plugin: SRPlugin, id: string, text: string): Promise<void> {
    await ensureFolder(plugin);
    await plugin.app.vault.adapter.write(fileOf(plugin, id), text);
}

async function flush(plugin: SRPlugin, id: string, slot: Slot): Promise<void> {
    const draft = slot.waiting;
    // An earlier flush has written the latest already
    if (draft === null) return;
    slot.waiting = null;
    const text = draftText(draft);
    try {
        try {
            await put(plugin, id, text);
        } catch {
            // Once more: a save that fails is the one the exam would be resumed from
            await put(plugin, id, text);
        }
    } catch (error) {
        // The same draft is written again the next time it is saved
        if (slot.waiting === null) slot.desired = null;
        throw error;
    }
}

/**
 * Writes the exam's file, unless it already holds what the draft says. Rejects when it could not be written, after a
 * second try.
 */
export function writeExamDraft(plugin: SRPlugin, draft: ExamDraft): Promise<void> {
    const slot = slotOf(plugin, draft.id);
    const key = draftKey(draft);
    // Written, or on its way: nothing new to save
    if (slot.desired === key) return slot.chain;
    slot.desired = key;
    slot.waiting = draft;
    const run = slot.chain.then(() => flush(plugin, draft.id, slot));
    slot.chain = run.catch((): void => undefined);
    return run;
}

function report(error: unknown): void {
    // The exam goes on; the next change tries again
    console.error("Flashcard Studio: could not save the progress of the exam", error);
}

/** Saves the draft. A failure is logged, not thrown: the exam goes on. */
export async function saveExamDraft(plugin: SRPlugin, draft: ExamDraft): Promise<void> {
    await writeExamDraft(plugin, draft).catch(report);
}

/** Forgets a draft: the exam was submitted or discarded. Nothing waiting to be written outlives it. */
export async function discardExamDraft(plugin: SRPlugin, id: string): Promise<void> {
    const slot = slotOf(plugin, id);
    slot.desired = null;
    slot.waiting = null;
    const run = slot.chain.then(async () => {
        const adapter = plugin.app.vault.adapter;
        const path = fileOf(plugin, id);
        if (await adapter.exists(path)) await adapter.remove(path);
    });
    slot.chain = run.catch((): void => undefined);
    await run.catch(report);
}

/**
 * The unfinished exams of this device, newest first. Another device's drafts are not offered here: resuming one on
 * two devices would write two results for one exam.
 */
export async function unfinishedExams(plugin: SRPlugin): Promise<ExamDraft[]> {
    await Promise.all([...(slots.get(plugin)?.values() ?? [])].map((slot) => slot.chain));
    const adapter = plugin.app.vault.adapter;
    const folder = folderOf(plugin);
    if (!(await adapter.exists(folder))) return [];

    const mine = new RegExp(`^\\d+-${getDeviceId(plugin.app)}\\.json$`);
    const stored: unknown[] = [];
    for (const path of (await adapter.list(folder)).files) {
        if (!mine.test(path.slice(path.lastIndexOf("/") + 1))) continue;
        try {
            stored.push(JSON.parse(await adapter.read(path)));
        } catch {
            // Damaged: skipped, as a draft that is not whole is
        }
    }
    return unfinishedDrafts(stored, live);
}

/**
 * Older builds kept the drafts in the plugin's data. Writes them to files, as this device's.
 *
 * @param stored - What the data held under `examDrafts`.
 * @returns Whether every draft that could be read is written (or there were none), so the data can let go of them.
 */
export async function migrateExamDrafts(plugin: SRPlugin, stored: unknown): Promise<boolean> {
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return true;
    try {
        for (const raw of Object.values(stored)) {
            // An entry that is not a whole draft was never offered, and is dropped
            const draft = readDraft(raw);
            if (draft !== null) await writeExamDraft(plugin, draft);
        }
        return true;
    } catch (error) {
        report(error);
        return false;
    }
}

/** What an exam screen needs to save its progress and to drop it, for the plugin. */
export function persistenceFor(plugin: SRPlugin): {
    persist: (draft: ExamDraft) => void;
    discard: (id: string) => void;
} {
    return {
        persist: (draft) => void saveExamDraft(plugin, draft),
        discard: (id) => void discardExamDraft(plugin, id),
    };
}
