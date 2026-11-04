import { App, normalizePath, TFile } from "obsidian";

import { ExamResult } from "src/exam/exam";
import {
    examFileNameMs,
    examFilePath,
    EXAMS_FOLDER,
    formatExamFile,
    lastExams,
    parseExamFile,
} from "src/exam/exam-results-file";

/**
 * Where exams are kept in the vault: one plain file each in `Flashcard Studio/Exams/`. Nothing else in the plugin
 * touches these files, and an exam is only ever written once.
 */

async function ensureFolder(app: App, folder: string): Promise<void> {
    let current = "";
    for (const part of folder.split("/")) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getFolderByPath(current)) await app.vault.createFolder(current);
    }
}

/**
 * Writes the exam's file, creating the folder when it is missing.
 *
 * @returns The path of the file.
 */
export async function saveExamResult(app: App, result: ExamResult): Promise<string> {
    await ensureFolder(app, EXAMS_FOLDER);
    const path = normalizePath(
        examFilePath(result.endedMs, (candidate) => app.vault.getFileByPath(candidate) !== null),
    );
    await app.vault.create(path, formatExamFile(result));
    return path;
}

/**
 * How far the time in a file name can run against the order the exams ended in. The name has the local time, and time
 * zones are up to 26 hours apart (UTC-12 to UTC+14); the hour when the clocks go back is well inside that.
 */
const NAME_CLOCK_SLACK_MS = 26 * 3600 * 1000;

/**
 * The newest `n` exams, newest first. A file that is not an exam (or is broken) is skipped. The files are read newest
 * first by name, and reading stops once there are enough exams, so a long history stays cheap. A name only gives the
 * local minute, so the files named up to NAME_CLOCK_SLACK_MS before the n-th exam are read as well: another exam that
 * ended in the same minute (`... exam 2.md`), after the clocks went back, or in another time zone can be newer than its
 * name says.
 */
export async function readExamResults(app: App, n: number): Promise<ExamResult[]> {
    const folder = app.vault.getFolderByPath(EXAMS_FOLDER);
    if (folder === null) return [];
    const files = folder.children
        .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
        .sort((a, b) => b.name.localeCompare(a.name));

    const texts: { name: string; text: string }[] = [];
    let found = 0;
    // Once there are n exams, only a file named from this time on can have ended after one of them
    let readFromMs = Infinity;
    for (const file of files) {
        const nameMs = examFileNameMs(file.name);
        if (found >= n) {
            if (nameMs === null) continue;
            if (nameMs < readFromMs) break;
        }
        const text = await app.vault.cachedRead(file);
        texts.push({ name: file.name, text });
        if (parseExamFile(text) === null) continue;
        found++;
        if (found === n && nameMs !== null) readFromMs = nameMs - NAME_CLOCK_SLACK_MS;
    }
    return lastExams(texts, n);
}
