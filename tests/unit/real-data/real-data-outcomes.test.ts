import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import * as path from "path";

import { cloneDefaultSettings, StudioSettings, upgradeSettings } from "src/data/settings-model";
import { CardDueDateHistogram } from "src/scheduling/due-histogram";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { FsrsState } from "src/scheduling/schedule/fsrs-state";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { retrievability } from "src/stats/cards";
import { CommentParser } from "src/utils/schedule-comment";

import { clockAt } from "../scheduling/fsrs/clock-at";

/**
 * Real-data check before a scheduling change is merged (issue #27): every schedule in a COPY of a real vault, answered
 * with every button at four moments, written as JSON lines. Run it on main and on the branch and compare the two files.
 * Skipped unless FS_REAL_DATA (the copied vault folder) and FS_REAL_DATA_OUT (the output file) are set. Holds no data.
 */
const vault = process.env.FS_REAL_DATA;
const out = process.env.FS_REAL_DATA_OUT;
const run = vault && out ? describe : describe.skip;

// Only names exported on main as well as the branch: this file runs on both and their outputs are compared
const BUTTONS = {
    Again: ReviewResponse.Again,
    Hard: ReviewResponse.Hard,
    Good: ReviewResponse.Good,
    Easy: ReviewResponse.Easy,
};
const DAY_MS = 24 * 60 * 60 * 1000;

function markdownFiles(folder: string): string[] {
    return readdirSync(folder).flatMap((name) => {
        const full = path.join(folder, name);
        if (statSync(full).isDirectory()) return name === ".obsidian" ? [] : markdownFiles(full);
        return name.endsWith(".md") ? [full] : [];
    });
}

function settingsOf(folder: string): StudioSettings {
    const data = JSON.parse(
        readFileSync(path.join(folder, ".obsidian/plugins/flashcard-studio/data.json"), "utf8"),
    ) as { settings: StudioSettings };
    upgradeSettings(data.settings);
    const kept = Object.entries(data.settings).filter(([, value]) => value !== null);
    return Object.assign(cloneDefaultSettings(), Object.fromEntries(kept)) as StudioSettings;
}

run("real data: every schedule answered with every button", () => {
    test("writes the outcomes", () => {
        const settings = settingsOf(vault);
        writeFileSync(out, "");
        let schedules = 0;
        for (const file of markdownFiles(vault)) {
            const note = path.relative(vault, file);
            const comments = readFileSync(file, "utf8").match(/<!--SR:[^>]*-->/g) ?? [];
            comments.forEach((comment, c) => {
                const body = comment.slice("<!--SR:".length, -"-->".length);
                CommentParser.parseMultiScheduleComment(body).forEach((schedule, s) => {
                    if (schedule === null) return;
                    schedules++;
                    const card = `${c}.${s}`;
                    const dueMs = schedule.dueDate
                        ? schedule.dueDate.valueOf()
                        : Date.parse("2026-11-26T09:00:00.000Z");
                    const dueDay = new Date(dueMs).toISOString().slice(0, 10);
                    const moments = [
                        new Date(dueMs).toISOString(),
                        new Date(Date.parse(`${dueDay}T09:00:00.000Z`) + DAY_MS).toISOString(),
                        "2026-11-26T09:00:00.000Z",
                        new Date(dueMs + 30 * DAY_MS).toISOString(),
                    ];
                    for (const now of moments) {
                        clockAt(now);
                        // A new scheduler per moment, as after a restart, so no answer is reused from another moment
                        const algorithm = new FsrsCardScheduler(settings);
                        for (const [grade, response] of Object.entries(BUTTONS)) {
                            const text = algorithm
                                .cardCalcUpdatedSchedule(
                                    response,
                                    schedule,
                                    new CardDueDateHistogram(),
                                )
                                .formatScheduleAsComment();
                            appendFileSync(
                                out,
                                JSON.stringify({ note, card, now, grade, text }) + "\n",
                            );
                        }
                        if (schedule instanceof FsrsState && schedule.lastReview) {
                            const r = retrievability(
                                {
                                    isFsrs: true,
                                    state: "review",
                                    stability: schedule.stability,
                                    lastReviewMs: schedule.lastReview.valueOf(),
                                } as Parameters<typeof retrievability>[0],
                                Date.parse(now),
                            );
                            appendFileSync(
                                out,
                                JSON.stringify({ note, card, now, retrievability: r }) + "\n",
                            );
                        }
                    }
                });
            });
        }
        appendFileSync(
            out,
            JSON.stringify({ schedules, settings: { algorithm: settings.algorithm } }) + "\n",
        );
        expect(schedules).toBeGreaterThan(0);
    });
});

const GRADE_OF_LOG: Record<number, ReviewResponse> = {
    1: ReviewResponse.Again,
    2: ReviewResponse.Hard,
    3: ReviewResponse.Good,
    4: ReviewResponse.Easy,
};

run("real data: the review log replayed through the scheduler", () => {
    test("writes each card's replayed schedule next to the one in its note", () => {
        const settings = settingsOf(vault);
        const logFolder = path.join(vault, "Flashcards/Flashcard Studio/Review log");
        const entries = readdirSync(logFolder)
            .flatMap((name) => readFileSync(path.join(logFolder, name), "utf8").split("\n"))
            .filter((line) => line.startsWith("{"))
            .map(
                (line) =>
                    JSON.parse(line) as { t: number; c: string; r: number; k: number; n?: number },
            )
            .sort((a, b) => a.t - b.t);
        const inNotes = new Map<string, string>();
        for (const file of markdownFiles(vault)) {
            for (const match of readFileSync(file, "utf8").matchAll(
                /<!--SR:(!fsrs,[^>]*?,id=(\w+)[^>]*)-->/g,
            )) {
                inNotes.set(match[2], match[1]);
            }
        }
        const replayed = new Map<string, string>();
        for (const entry of entries) {
            // Custom study (kind 3) never changes a schedule; a reset (kind 4) makes the card new again
            if (entry.k === 3) continue;
            if (entry.k === 4) {
                replayed.delete(entry.c);
                continue;
            }
            clockAt(new Date(entry.t).toISOString());
            const algorithm = new FsrsCardScheduler(settings);
            const response = GRADE_OF_LOG[entry.r];
            const before = replayed.get(entry.c);
            const after =
                before === undefined || entry.n === 1
                    ? algorithm.cardGetNewSchedule(response, "n.md", new CardDueDateHistogram())
                    : algorithm.cardCalcUpdatedSchedule(
                          response,
                          CommentParser.parseMultiScheduleComment(before)[0],
                          new CardDueDateHistogram(),
                      );
            replayed.set(entry.c, after.formatScheduleAsComment());
        }
        for (const [id, text] of replayed) {
            appendFileSync(
                out,
                JSON.stringify({ replay: id, replayed: text, inNote: inNotes.get(id) ?? null }) +
                    "\n",
            );
        }
        expect(replayed.size).toBeGreaterThan(0);
    });
});
