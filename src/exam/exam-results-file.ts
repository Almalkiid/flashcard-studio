import {
    ExamAiCheck,
    ExamAiUnavailable,
    ExamAnswer,
    examBreakdown,
    ExamCardFilter,
    ExamItem,
    ExamQuestion,
    ExamQuestionKind,
    ExamResult,
    ExamSetup,
    examTypedTarget,
    plainExcerpt,
    summarizeExam,
} from "src/exam/exam";

/**
 * Each exam is saved as one plain Markdown file: a title, a summary table anyone can read, and a fenced block with a
 * JSON line for the exam and one for each question. Plain files sync without conflicts (an exam is only ever written
 * once) and other tools can read them.
 */

export const EXAMS_FOLDER = "Flashcard Studio/Exams";

const BLOCK_START = "```fs-exam";
const BLOCK_END = "```";

/** Whether a path is a file in the exams folder, which holds history rather than cards. */
export function isInExamsFolder(path: string): boolean {
    return path.startsWith(`${EXAMS_FOLDER}/`);
}

function two(value: number): string {
    return String(value).padStart(2, "0");
}

/** `2026-09-30`, in local time. */
function dateText(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** `1405`, in local time. */
function clockText(ms: number): string {
    const date = new Date(ms);
    return `${two(date.getHours())}${two(date.getMinutes())}`;
}

/** `2026-09-30 1405 exam.md`, from when the exam ended, in local time. */
export function examFileName(endedMs: number): string {
    return `${dateText(endedMs)} ${clockText(endedMs)} exam.md`;
}

/**
 * The local date and time an exam's file name starts with (`2026-09-30 1405 exam 2.md`), counted as if it were UTC, so
 * that two names can be compared in minutes. Null for a name that does not start with them.
 */
export function examFileNameMs(name: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})\b/.exec(name);
    if (match === null) return null;
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    return Date.UTC(year, month - 1, day, hour, minute);
}

/**
 * Where to save an exam: the exams folder and the file name, with ` 2`, ` 3` ... added when another exam ended in the
 * same minute and already has the name.
 */
export function examFilePath(endedMs: number, exists: (path: string) => boolean): string {
    const base = `${dateText(endedMs)} ${clockText(endedMs)} exam`;
    let path = `${EXAMS_FOLDER}/${base}.md`;
    for (let n = 2; exists(path); n++) path = `${EXAMS_FOLDER}/${base} ${n}.md`;
    return path;
}

/** `7 min 30 s`, `2 h 11 min`, `45 s`. */
function durationText(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
    return `${seconds} s`;
}

/** A table cell: the pipe would end it, a line break would end the row. */
function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ");
}

/**
 * A table cell that shows its text as it is: on one line, and every character Markdown or Obsidian would read as
 * something (a link, an embed, a tag, HTML, math, a comment, emphasis) escaped. A note path is written this way, never
 * as a link: links from the exam files would count as links to the notes, which note review weighs.
 */
export function literalCell(text: string): string {
    return text
        .replace(/\s*\r?\n\s*/g, " ")
        .trim()
        .replace(/[\\`*_[\]<>#|!$=~^%]/g, "\\$&");
}

/** The rows under the summary: by deck as always, or by note for an exam from several notes. */
function breakdownLines(r: ExamResult): string[] {
    const breakdown = examBreakdown(r);
    if (breakdown.by === "note") {
        return [
            "| Note | Right |",
            "|---|---|",
            ...breakdown.rows.map(
                (row) => `| ${literalCell(row.key) || "-"} | ${row.right} of ${row.total} |`,
            ),
        ];
    }
    return [
        "| Deck | Right |",
        "|---|---|",
        ...breakdown.rows.map(
            (row) => `| ${cell(row.key || "-")} | ${row.right} of ${row.total} |`,
        ),
    ];
}

/** The AI's verdict on an answer, and why it gave none, as the file says them. */
const FILE_VERDICTS: Record<ExamAiCheck["verdict"], string> = {
    equivalent: "Same meaning, counted right",
    incorrect: "Different meaning",
    uncertain: "Could not decide",
    unavailable: "Not checked",
};
const FILE_UNAVAILABLE: Record<ExamAiUnavailable, string> = {
    setup: "AI is not set up",
    timeout: "Took longer than 10 seconds",
    provider: "The provider could not complete the check",
    format: "The reply was incomplete or invalid",
    skipped: "Not sent: the checks stopped first",
    stopped: "No verdict: the checks stopped before the AI answered",
    changed: "Not sent: the AI provider changed after the exam started",
};

/**
 * The answers the AI checked, to read without the JSON: the question, the answer, the verdict and the AI's reason.
 * Every cell is literal, so nothing the model wrote can become a link, HTML or markup in the file.
 */
function aiCheckLines(r: ExamResult): string[] {
    const checked = r.items.flatMap((item, index) =>
        item.ai === undefined ? [] : [{ item, index, ai: item.ai }],
    );
    if (checked.length === 0) return [];
    return [
        "## AI checks",
        "",
        "| Question | Your answer | AI | Reason |",
        "|---|---|---|---|",
        ...checked.map(({ item, index, ai }) => {
            const question = literalCell(`${index + 1}. ${plainExcerpt(item.q.front, 80)}`);
            const reason = ai.verdict === "unavailable" ? FILE_UNAVAILABLE[ai.reason] : ai.reason;
            return `| ${question} | ${literalCell(item.a.typed)} | ${FILE_VERDICTS[ai.verdict]} | ${literalCell(reason)} |`;
        }),
        "",
    ];
}

/** `2 of 5 counted right`: the answers the AI accepted, of the ones it was asked about. */
function aiSummaryLines(r: ExamResult): string[] {
    const checked = r.items.filter((item) => item.ai !== undefined);
    if (checked.length === 0) return [];
    const accepted = checked.filter((item) => item.ai?.verdict === "equivalent").length;
    return [`| AI checks | ${accepted} of ${checked.length} counted right |`];
}

/**
 * The text of an exam's file. It has no front matter, so it stays a plain note.
 */
export function formatExamFile(r: ExamResult): string {
    const title = r.setup.title.replace(/\s*\r?\n\s*/g, " ").trim();
    const notes = r.setup.notes ?? [];
    const lines: string[] = [
        `# ${title}`,
        "",
        `| Score | ${r.percent}% (${r.right} of ${r.total}) |`,
        "|---|---|",
        `| Result | ${r.passed ? "Passed" : "Not passed"} (pass mark ${r.setup.passPercent}%) |`,
        `| Time taken | ${durationText(r.endedMs - r.startedMs)} |`,
        `| Finished | ${dateText(r.endedMs)} ${clockText(r.endedMs).replace(/^(\d{2})/, "$1:")} |`,
        `| Cards | ${r.setup.filter === "choice-only" ? "Multiple choice only" : "All cards"} |`,
        ...(notes.length > 0 ? [`| Notes | ${notes.map(literalCell).join(", ")} |`] : []),
        ...aiSummaryLines(r),
        "",
        ...breakdownLines(r),
        "",
        ...aiCheckLines(r),
        BLOCK_START,
        JSON.stringify({
            kind: "exam",
            setup: r.setup,
            startedMs: r.startedMs,
            endedMs: r.endedMs,
        }),
        // The mark already counts an answer the AI accepted, so the score stored is the score shown
        ...r.items.map((item) =>
            JSON.stringify(
                item.ai === undefined
                    ? { q: item.q, a: item.a, right: item.right }
                    : { q: item.q, a: item.a, right: item.right, ai: item.ai },
            ),
        ),
        BLOCK_END,
        "",
    ];
    return lines.join("\n");
}

// #region -> Reading a file back

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
    return value === null || isFiniteNumber(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
    return value === null || typeof value === "boolean";
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

const FILTERS: ExamCardFilter[] = ["choice-only", "all"];
const KINDS: ExamQuestionKind[] = ["choice", "typed", "self"];

export function readSetup(value: unknown): ExamSetup | null {
    if (!isObject(value)) return null;
    const {
        decks,
        count,
        minutes,
        filter,
        passPercent,
        title,
        shuffleOptions,
        notes,
        aiCheck,
        aiProvider,
    } = value;
    if (!Array.isArray(decks) || !decks.every((deck) => typeof deck === "string")) return null;
    if (!isFiniteNumber(count)) return null;
    if (!isNullableNumber(minutes)) return null;
    if (!FILTERS.includes(filter as ExamCardFilter)) return null;
    if (!isFiniteNumber(passPercent)) return null;
    if (typeof title !== "string") return null;
    const setup: ExamSetup = {
        decks,
        count,
        minutes,
        filter: filter as ExamCardFilter,
        passPercent,
        title,
    };
    if (shuffleOptions !== undefined) {
        if (typeof shuffleOptions !== "boolean") return null;
        setup.shuffleOptions = shuffleOptions;
    }
    if (notes !== undefined) {
        if (!Array.isArray(notes) || !notes.every((note) => typeof note === "string")) return null;
        // An empty list is an exam from decks, as before
        if (notes.length > 0) setup.notes = notes;
    }
    if (aiCheck !== undefined) {
        if (typeof aiCheck !== "boolean") return null;
        setup.aiCheck = aiCheck;
    }
    if (aiProvider !== undefined) {
        if (typeof aiProvider !== "string") return null;
        setup.aiProvider = aiProvider;
    }
    return setup;
}

function readChoice(value: unknown): ExamQuestion["choice"] | undefined {
    if (value === null) return null;
    if (!isObject(value)) return undefined;
    const { lead, options, explanation, multiSelect } = value;
    if (typeof lead !== "string" || typeof explanation !== "string") return undefined;
    if (typeof multiSelect !== "boolean" || !Array.isArray(options)) return undefined;
    const read: { text: string; correct: boolean }[] = [];
    for (const option of options) {
        if (!isObject(option)) return undefined;
        if (typeof option.text !== "string" || typeof option.correct !== "boolean") {
            return undefined;
        }
        read.push({ text: option.text, correct: option.correct });
    }
    return { lead, options: read, explanation, multiSelect };
}

export function readQuestion(value: unknown): ExamQuestion | null {
    if (!isObject(value)) return null;
    const { cardId, deck, kind, front, back, order, sourcePath, typedTarget } = value;
    if (typeof cardId !== "string" || typeof deck !== "string") return null;
    if (!KINDS.includes(kind as ExamQuestionKind)) return null;
    if (typeof front !== "string" || typeof back !== "string") return null;
    if (!isNumberArray(order)) return null;
    if (!isOptionalString(sourcePath)) return null;
    if (typedTarget !== null && !isOptionalString(typedTarget)) return null;
    const written = typedTarget as string | null | undefined;
    const choice = readChoice(value.choice);
    if (choice === undefined) return null;
    // A question saved without its typed text (an older file) gets it from its answer
    const target =
        written !== undefined ? written : kind === "typed" ? examTypedTarget(back) : null;
    return {
        cardId,
        deck,
        kind: kind as ExamQuestionKind,
        front,
        back,
        choice,
        order,
        sourcePath: sourcePath ?? "",
        typedTarget: target,
    };
}

export function readAnswer(value: unknown): ExamAnswer | null {
    if (!isObject(value)) return null;
    const { chosen, typed, selfRight, flagged, ms } = value;
    if (!isNumberArray(chosen) || typeof typed !== "string") return null;
    if (!isNullableBoolean(selfRight) || typeof flagged !== "boolean" || !isFiniteNumber(ms)) {
        return null;
    }
    return { chosen, typed, selfRight, flagged, ms };
}

function readItem(line: string): ExamItem | null {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return null;
    }
    if (!isObject(value)) return null;
    const q = readQuestion(value.q);
    const a = readAnswer(value.a);
    const right = value.right;
    if (q === null || a === null) return null;
    if (!isNullableBoolean(right)) return null;
    if (value.ai === undefined) return { q, a, right };
    const ai = readAiCheck(value.ai);
    if (ai === null) return null;
    return { q, a, right, ai };
}

const VERDICTS = ["equivalent", "incorrect", "uncertain"] as const;
const UNAVAILABLE: ExamAiUnavailable[] = [
    "setup",
    "timeout",
    "provider",
    "format",
    "skipped",
    "stopped",
    "changed",
];

/** The AI's check of an answer: exactly a verdict and a reason, the reason one of the codes when there is no verdict. */
function readAiCheck(value: unknown): ExamAiCheck | null {
    if (!isObject(value) || Object.keys(value).length !== 2) return null;
    const { verdict, reason } = value;
    if (typeof reason !== "string") return null;
    if (verdict === "unavailable") {
        return UNAVAILABLE.includes(reason as ExamAiUnavailable)
            ? { verdict, reason: reason as ExamAiUnavailable }
            : null;
    }
    const known = VERDICTS.find((candidate) => candidate === verdict);
    return known === undefined ? null : { verdict: known, reason };
}

/**
 * Reads an exam file back. Anything that is not an exam, or that has been edited into something that is not one (a
 * line that is not JSON, a field of the wrong kind), is null rather than an error, so a note that only looks like an
 * exam is skipped. The score is worked out again from the questions, not read from the summary table.
 */
export function parseExamFile(text: string): ExamResult | null {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === BLOCK_START);
    if (start < 0) return null;
    const end = lines.findIndex((line, index) => index > start && line.trim() === BLOCK_END);
    if (end < 0) return null;
    const body = lines.slice(start + 1, end).filter((line) => line.trim() !== "");
    if (body.length === 0) return null;

    let header: unknown;
    try {
        header = JSON.parse(body[0]);
    } catch {
        return null;
    }
    if (!isObject(header) || header.kind !== "exam") return null;
    const setup = readSetup(header.setup);
    const { startedMs, endedMs } = header;
    if (setup === null) return null;
    if (!isFiniteNumber(startedMs) || !isFiniteNumber(endedMs)) return null;

    const items: ExamItem[] = [];
    for (const line of body.slice(1)) {
        const item = readItem(line);
        if (item === null) return null;
        items.push(item);
    }
    // An exam with no questions would be the last exam, and the setup the next one starts from
    if (items.length === 0) return null;
    return summarizeExam(setup, items, startedMs, endedMs);
}

/**
 * The newest `n` exams among the files, newest first. Files that are not exams are skipped and do not count.
 */
export function lastExams(files: { name: string; text: string }[], n: number): ExamResult[] {
    const exams: ExamResult[] = [];
    for (const file of files) {
        const exam = parseExamFile(file.text);
        if (exam !== null) exams.push(exam);
    }
    return exams.sort((a, b) => b.endedMs - a.endedMs).slice(0, Math.max(0, n));
}

// #endregion
