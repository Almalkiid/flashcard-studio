import type { MeaningChecker } from "src/ai/ai-access";
import {
    meaningUnavailableText,
    SemanticGradeInput,
    SemanticOutcome,
} from "src/ai/typed-answer-grading";
import {
    ExamAiCheck,
    ExamAiUnavailable,
    ExamItem,
    ExamResult,
    ExamSetup,
    summarizeExam,
} from "src/exam/exam";
import { t } from "src/lang/translate";
import { occlusionQuestionOf } from "src/occlusion/occlusion-view";

/**
 * The AI's check of typed exam answers, when the exam was set up for it: which answers are sent, sending them a few at
 * a time with a deadline for all of them, and the marks once the AI has said what it thinks. No screens here; the
 * check itself is the review's (#4), in src/ai/typed-answer-grading.ts.
 */

/** At most this many checks are on their way at once: providers limit the rate, and a local server answers one at a time. */
export const AI_CHECK_CONCURRENCY = 3;
/** However many answers there are, the results show after this long at most. */
export const AI_CHECK_TOTAL_MS = 90_000;
/** After this many checks in a row fail, the rest are not sent: the provider is down, or too slow. */
export const AI_CHECK_FAILURES_TO_STOP = 3;

/**
 * The questions whose answer goes to the AI: only when the exam was set up for it (`setup.aiCheck`), and only typed
 * answers that were given and did not match exactly. An image occlusion card is never sent (its question is a
 * picture, as in a review). This is the one gate: with `aiCheck` off it is empty and nothing is sent.
 */
export function aiCheckIndexes(result: ExamResult): number[] {
    if (result.setup.aiCheck !== true) return [];
    const indexes: number[] = [];
    result.items.forEach((item, index) => {
        const { q } = item;
        if (
            q.kind === "typed" &&
            item.right === false &&
            typeof q.typedTarget === "string" &&
            q.typedTarget !== "" &&
            occlusionQuestionOf(q.back) === null
        ) {
            indexes.push(index);
        }
    });
    return indexes;
}

/** What is sent for a question: its front, the plain answer to type, and what was typed. Nothing else. */
export function aiCheckInput(item: ExamItem): SemanticGradeInput {
    return { question: item.q.front, expected: item.q.typedTarget ?? "", typed: item.a.typed };
}

/** The review's outcome as an exam keeps it: the verdict and its reason, or why there is none. */
export function examAiCheckOf(outcome: SemanticOutcome): ExamAiCheck {
    if (outcome.status === "unavailable") return { verdict: "unavailable", reason: outcome.reason };
    return { verdict: outcome.grade.verdict, reason: outcome.grade.reason };
}

/**
 * The result with the AI's checks: each checked item carries its check, and one the AI found to mean the same counts
 * as right; the score, the pass, the deck rows and the cards missed are worked out again. Any other verdict, or no
 * verdict, leaves the exact mark.
 */
export function applyAiChecks(
    result: ExamResult,
    checks: ReadonlyMap<number, ExamAiCheck>,
): ExamResult {
    const items = result.items.map((item, index) => {
        const check = checks.get(index);
        if (check === undefined) return item;
        return { ...item, ai: check, right: item.right === true || check.verdict === "equivalent" };
    });
    return summarizeExam(result.setup, items, result.startedMs, result.endedMs);
}

/**
 * Why none of an exam's typed answers may be sent, or null when they can go. `changed` when the AI they would go to is
 * not the one the setup named when the exam started, or the setup named none: the person agreed to send them there,
 * not wherever the settings point now. `setup` when that AI is no longer set up. Ask the snapshot the checks will use,
 * so that what is decided here is where they go.
 */
export function aiCheckHold(
    setup: ExamSetup,
    ai: Pick<MeaningChecker, "usable" | "provider">,
): "changed" | "setup" | null {
    if (setup.aiProvider === undefined || ai.provider() !== setup.aiProvider) return "changed";
    return ai.usable() ? null : "setup";
}

/** The result with each answer in `plan` not checked, for `reason`: nothing was sent, so each keeps its exact mark. */
export function withoutAiChecks(
    result: ExamResult,
    plan: number[],
    reason: ExamAiUnavailable,
): ExamResult {
    const check: ExamAiCheck = { verdict: "unavailable", reason };
    return applyAiChecks(result, new Map(plan.map((index) => [index, check])));
}

/**
 * Sends the checks, at most AI_CHECK_CONCURRENCY at once, and resolves with one check per input, in order. It never
 * waits longer than AI_CHECK_TOTAL_MS, and resolves at once when `signal` aborts or AI_CHECK_FAILURES_TO_STOP checks in
 * a row fail; inputs not answered by then are `skipped` (a failure's reason is only true of the check that had it),
 * and a reply that comes later is ignored. A "setup" outcome stops the rest at once with "setup": nothing could be
 * sent for them either. A check that throws counts as "provider".
 */
export async function runAiChecks(
    inputs: SemanticGradeInput[],
    check: (input: SemanticGradeInput) => Promise<SemanticOutcome>,
    opts: {
        signal: AbortSignal;
        onProgress?: (done: number) => void;
        concurrency?: number;
        totalMs?: number;
    },
): Promise<ExamAiCheck[]> {
    const skipped: ExamAiCheck = { verdict: "unavailable", reason: "skipped" };
    const checks: (ExamAiCheck | null)[] = inputs.map((): ExamAiCheck | null => null);
    let next = 0;
    let done = 0;
    let failures = 0;
    // What the inputs not checked get, once the checks stop early
    let halt: ExamAiCheck | null = null;
    let wake = (): void => undefined;
    const halted = new Promise<void>((resolve) => {
        wake = resolve;
    });
    const stop = (why: ExamAiCheck): void => {
        if (halt !== null) return;
        halt = why;
        wake();
    };
    const onAbort = () => stop(skipped);
    if (opts.signal.aborted) stop(skipped);
    else opts.signal.addEventListener("abort", onAbort, { once: true });
    const timer = window.setTimeout(() => stop(skipped), opts.totalMs ?? AI_CHECK_TOTAL_MS);

    const worker = async (): Promise<void> => {
        while (halt === null && next < inputs.length) {
            const index = next++;
            let outcome: SemanticOutcome;
            try {
                outcome = await check(inputs[index]);
            } catch {
                outcome = { status: "unavailable", reason: "provider" };
            }
            // Too late: the results are on their way without it
            if (halt !== null) return;
            checks[index] = examAiCheckOf(outcome);
            opts.onProgress?.(++done);
            if (outcome.status === "graded") failures = 0;
            else if (outcome.reason === "setup") stop({ verdict: "unavailable", reason: "setup" });
            else if (++failures >= AI_CHECK_FAILURES_TO_STOP) stop(skipped);
        }
    };
    const workers = Array.from(
        { length: Math.min(opts.concurrency ?? AI_CHECK_CONCURRENCY, inputs.length) },
        worker,
    );
    try {
        await Promise.race([Promise.all(workers), halted]);
    } finally {
        window.clearTimeout(timer);
        opts.signal.removeEventListener("abort", onAbort);
    }
    return checks.map((found) => found ?? halt ?? skipped);
}

/** Why a check has no verdict, as the person reads it. */
function unavailableText(reason: ExamAiUnavailable): string {
    if (reason === "skipped") return t("EXAM_AI_SKIPPED");
    if (reason === "changed") return t("EXAM_AI_CHANGED");
    return meaningUnavailableText(reason);
}

/** The two lines the results show for a check: the verdict, and the AI's reason ("" for none). Plain text. */
export function aiCheckText(check: ExamAiCheck): { verdict: string; reason: string } {
    switch (check.verdict) {
        case "equivalent":
            return {
                verdict: `${t("AI_MEANING_EQUIVALENT")} · ${t("EXAM_AI_COUNTED_RIGHT")}`,
                reason: check.reason,
            };
        case "incorrect":
            return { verdict: t("AI_MEANING_INCORRECT"), reason: check.reason };
        case "uncertain":
            return { verdict: t("AI_MEANING_UNCERTAIN"), reason: check.reason };
        case "unavailable":
            return {
                verdict: t("AI_MEANING_UNAVAILABLE", { reason: unavailableText(check.reason) }),
                reason: "",
            };
    }
}
