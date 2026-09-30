import { setIcon } from "obsidian";

import { ExamItem, ExamResult, missedCardIds, plainExcerpt } from "src/exam/exam";
import {
    choiceContext,
    deckLabel,
    ExamRenderContext,
    renderCardMarkdown,
} from "src/exam/exam-render";
import { t } from "src/lang/helpers";
import { compareTypedAnswer, typedAnswerTarget } from "src/scheduling/typed-answer";
import { renderChoiceBack } from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import { renderTypedResult } from "src/ui/obsidian-ui-components/content-container/card-container/typed-answer-view";
import { formatDateTimeShort, formatDuration } from "src/ui/statistics-view/format";

export interface ExamResultsOptions {
    ctx: ExamRenderContext;
    ignoreAccents: boolean;
    /** "Study the ones I missed": the ids of those cards. */
    onStudyMissed: (ids: string[]) => void;
    onClose: () => void;
}

/** What the screen shows once the results file has been written, or has failed to be. */
export interface ExamResultsView {
    showSaved(path: string): void;
    showSaveFailed(reason: string): void;
}

type ReviewFilter = "all" | "missed";

/**
 * The results of an exam: the score against the pass mark, the score of each deck, and every question with the answer
 * given, the right one and the explanation. The questions are drawn when they are opened, so an exam of 125 questions
 * opens at once.
 */
export function renderExamResults(
    root: HTMLElement,
    result: ExamResult,
    opts: ExamResultsOptions,
): ExamResultsView {
    const bar = root.createDiv({ cls: "fs-exam-bar is-results" });
    const heading = bar.createDiv({ cls: "fs-exam-bar-side" });
    const headingText = heading.createDiv({ cls: "fs-exam-heading" });
    headingText.createDiv({ cls: "fs-exam-title", text: result.setup.title });
    headingText.createDiv({ cls: "fs-exam-when", text: formatDateTimeShort(result.endedMs) });

    const scroll = root.createDiv({ cls: "fs-exam-results-scroll" });
    const page = scroll.createDiv({ cls: "fs-exam-results" });

    renderHero(page, result);
    renderDecks(page, result);
    const saved = renderActions(page, result, opts);
    renderReview(page, result, opts);

    return {
        showSaved: (path) => {
            saved.empty();
            saved.removeClass("is-error");
            setIcon(saved.createSpan({ cls: "fs-exam-saved-icon" }), "file-check");
            saved.createSpan({ cls: "fs-exam-saved-text", text: t("EXAM_SAVED", { path }) });
            const open = saved.createEl("button", {
                cls: "fs-exam-link",
                text: t("EXAM_OPEN_FILE"),
                attr: { type: "button" },
            });
            open.addEventListener("click", () => {
                void opts.ctx.app.workspace.openLinkText(path, "", true);
            });
        },
        showSaveFailed: (reason) => {
            saved.empty();
            saved.addClass("is-error");
            setIcon(saved.createSpan({ cls: "fs-exam-saved-icon" }), "triangle-alert");
            saved.createSpan({
                cls: "fs-exam-saved-text",
                text: t("EXAM_SAVE_FAILED", { reason }),
            });
        },
    };
}

function stat(parent: HTMLElement, icon: string, label: string, value: string): void {
    const item = parent.createDiv({ cls: "fs-exam-stat" });
    setIcon(item.createSpan({ cls: "fs-exam-stat-icon" }), icon);
    const text = item.createDiv({ cls: "fs-exam-stat-text" });
    text.createDiv({ cls: "fs-exam-stat-value", text: value });
    text.createDiv({ cls: "fs-exam-stat-label", text: label });
}

function renderHero(page: HTMLElement, result: ExamResult): void {
    const hero = page.createDiv({ cls: "fs-card fs-exam-hero" });
    hero.toggleClass("is-passed", result.passed);
    hero.toggleClass("is-failed", !result.passed);

    const ring = hero.createDiv({
        cls: "fs-exam-ring",
        attr: { role: "img", "aria-label": `${result.percent}%` },
    });
    ring.setCssProps({
        "--fs-ring": (Math.min(100, Math.max(0, result.percent)) / 100).toFixed(4),
    });
    ring.createSpan({ cls: "fs-exam-ring-value", text: `${result.percent}%` });

    const text = hero.createDiv({ cls: "fs-exam-hero-text" });
    const eyebrow = text.createDiv({ cls: "fs-exam-eyebrow" });
    setIcon(
        eyebrow.createSpan({ cls: "fs-exam-eyebrow-icon" }),
        result.passed ? "circle-check" : "circle-x",
    );
    eyebrow.createSpan({
        text: result.passed ? t("EXAM_RESULT_PASSED") : t("EXAM_RESULT_NOT_PASSED"),
    });
    text.createDiv({
        cls: "fs-exam-hero-score",
        text: t("EXAM_RIGHT_OF", { right: result.right, total: result.total }),
    });
    text.createDiv({
        cls: "fs-exam-hero-sub",
        text: t("EXAM_PASS_LINE", { percent: result.setup.passPercent }),
    });

    const stats = hero.createDiv({ cls: "fs-exam-stats" });
    stat(stats, "clock", t("EXAM_TIME_TAKEN"), formatDuration(result.endedMs - result.startedMs));
    stat(
        stats,
        "circle-help",
        t("EXAM_STAT_UNANSWERED"),
        String(result.items.filter((item) => item.right === null).length),
    );
    stat(
        stats,
        "flag",
        t("EXAM_STAT_FLAGGED"),
        String(result.items.filter((item) => item.a.flagged).length),
    );
}

function renderDecks(page: HTMLElement, result: ExamResult): void {
    if (result.perDeck.length === 0) return;
    const card = page.createDiv({ cls: "fs-card fs-exam-decks" });
    card.createDiv({ cls: "fs-label", text: t("EXAM_BY_DECK") });
    const pass = result.setup.passPercent;
    for (const row of result.perDeck) {
        const percent = row.total === 0 ? 0 : Math.round((row.right / row.total) * 100);
        const line = card.createDiv({ cls: "fs-exam-deck-row" });
        line.createDiv({ cls: "fs-exam-deck-name", text: deckLabel(row.deck) });
        const track = line.createDiv({
            cls: "fs-exam-deck-bar",
            attr: { role: "img", "aria-label": `${percent}%` },
        });
        track.toggleClass("is-below", percent < pass);
        track.setCssProps({ "--fs-fill": `${percent}%`, "--fs-pass": `${pass}%` });
        track.createEl("i");
        track.createEl("b");
        const score = line.createDiv({ cls: "fs-exam-deck-score" });
        score.createSpan({ cls: "fs-exam-deck-count", text: `${row.right} / ${row.total}` });
        score.createSpan({ cls: "fs-exam-deck-percent", text: `${percent}%` });
    }
}

/** The buttons under the score, and the line that says where the results file went. */
function renderActions(
    page: HTMLElement,
    result: ExamResult,
    opts: ExamResultsOptions,
): HTMLElement {
    const actions = page.createDiv({ cls: "fs-exam-actions" });
    const missed = missedCardIds(result);
    if (missed.length > 0) {
        const study = actions.createEl("button", {
            cls: "fs-primary-button fs-exam-study",
            attr: { type: "button" },
        });
        setIcon(study.createSpan({ cls: "fs-exam-study-icon" }), "book-open-check");
        study.createSpan({ text: `${t("EXAM_STUDY_MISSED")} · ${missed.length}` });
        study.addEventListener("click", () => opts.onStudyMissed(missed));
    } else {
        const perfect = actions.createDiv({ cls: "fs-exam-perfect" });
        setIcon(perfect.createSpan({ cls: "fs-exam-perfect-icon" }), "party-popper");
        perfect.createSpan({ text: t("EXAM_NOTHING_MISSED") });
    }
    actions
        .createEl("button", {
            cls: "fs-exam-ghost fs-exam-close",
            text: t("CLOSE"),
            attr: { type: "button" },
        })
        .addEventListener("click", () => opts.onClose());
    return page.createDiv({ cls: "fs-exam-saved" });
}

function renderReview(page: HTMLElement, result: ExamResult, opts: ExamResultsOptions): void {
    const review = page.createDiv({ cls: "fs-exam-review" });
    const head = review.createDiv({ cls: "fs-exam-review-head" });
    head.createDiv({ cls: "fs-label", text: t("EXAM_REVIEW") });
    const list = review.createDiv({ cls: "fs-exam-items" });

    const missedCount = result.items.filter((item) => item.right !== true).length;
    let filter: ReviewFilter = missedCount > 0 ? "missed" : "all";

    const buttons = new Map<ReviewFilter, HTMLElement>();
    const draw = () => {
        list.empty();
        let first = true;
        result.items.forEach((item, index) => {
            if (filter === "missed" && item.right === true) return;
            renderItem(list, item, index, opts, first);
            first = false;
        });
        for (const [value, button] of buttons) {
            button.toggleClass("is-active", value === filter);
            button.setAttribute("aria-pressed", String(value === filter));
        }
    };

    if (missedCount > 0 && missedCount < result.items.length) {
        const segments = head.createDiv({ cls: "fs-exam-segments", attr: { role: "group" } });
        const choices: [ReviewFilter, string][] = [
            ["missed", t("EXAM_FILTER_MISSED", { count: missedCount })],
            ["all", t("EXAM_FILTER_ALL", { count: result.items.length })],
        ];
        for (const [value, label] of choices) {
            const button = segments.createEl("button", {
                cls: "fs-exam-segment",
                text: label,
                attr: { type: "button" },
            });
            button.addEventListener("click", () => {
                filter = value;
                draw();
            });
            buttons.set(value, button);
        }
    }
    draw();
}

const STATUS_ICON = { right: "check", wrong: "x", blank: "minus" } as const;

/** One question of the review: a row to open, and once opened the question, the answer and the explanation. */
function renderItem(
    list: HTMLElement,
    item: ExamItem,
    index: number,
    opts: ExamResultsOptions,
    open: boolean,
): void {
    const status = item.right === true ? "right" : item.right === false ? "wrong" : "blank";
    const row = list.createDiv({ cls: `fs-card fs-exam-item is-${status}` });
    const head = row.createEl("button", {
        cls: "fs-exam-item-head",
        attr: { type: "button", "aria-expanded": "false" },
    });
    setIcon(head.createSpan({ cls: "fs-exam-item-status" }), STATUS_ICON[status]);
    head.createSpan({ cls: "fs-exam-item-number", text: String(index + 1) });
    head.createSpan({
        cls: "fs-exam-item-label",
        text: t("EXAM_QUESTION_N", { n: index + 1 }),
    });
    head.createSpan({
        cls: "fs-exam-item-text",
        text: plainExcerpt(item.q.front) || t("EXAM_IMAGE_QUESTION"),
    }).setAttribute("dir", "auto");
    if (item.a.flagged) setIcon(head.createSpan({ cls: "fs-exam-item-flag" }), "flag");
    setIcon(head.createSpan({ cls: "fs-exam-item-chevron" }), "chevron-down");

    const body = row.createDiv({ cls: "fs-exam-item-body" });
    let filled = false;
    const toggle = (show: boolean) => {
        row.toggleClass("is-open", show);
        head.setAttribute("aria-expanded", String(show));
        if (show && !filled) {
            filled = true;
            void fillItem(body, item, opts);
        }
    };
    head.addEventListener("click", () => toggle(!row.hasClass("is-open")));
    if (open) toggle(true);
}

async function fillItem(
    body: HTMLElement,
    item: ExamItem,
    opts: ExamResultsOptions,
): Promise<void> {
    const { ctx } = opts;
    const q = item.q;
    const answer = item.a;
    const question = body.createDiv({ cls: "fs-exam-question fs-exam-item-question" });
    await renderCardMarkdown(ctx, q.front, question, q.sourcePath);

    if (item.right === null) {
        body.createDiv({ cls: "fs-exam-blank", text: t("EXAM_NOT_ANSWERED") });
    }

    if (q.kind === "choice" && q.choice !== null) {
        await renderChoiceBack(
            body,
            { mc: q.choice, order: q.order, chosen: answer.chosen },
            choiceContext(ctx, q.sourcePath),
        );
        return;
    }

    if (q.kind === "typed") {
        const target = typedAnswerTarget(q.back) ?? q.back;
        const block = body.createDiv({ cls: "fs-exam-answer-block" });
        if (item.right === null) {
            block.createDiv({ cls: "fs-label", text: t("EXAM_RIGHT_ANSWER") });
            block.createDiv({ cls: "fs-typed-line", text: target });
            return;
        }
        block.createDiv({ cls: "fs-label", text: t("EXAM_YOUR_ANSWER") });
        renderTypedResult(block, compareTypedAnswer(answer.typed, target, opts.ignoreAccents));
        return;
    }

    // Self-marked: the answer as written, and what the person said
    const block = body.createDiv({ cls: "fs-exam-answer-block" });
    block.createDiv({ cls: "fs-label", text: t("EXAM_RIGHT_ANSWER") });
    await renderCardMarkdown(
        ctx,
        q.back,
        block.createDiv({ cls: "fs-exam-self-answer" }),
        q.sourcePath,
    );
    if (answer.selfRight !== null) {
        const said = body.createDiv({
            cls: `fs-exam-said ${answer.selfRight ? "is-yes" : "is-no"}`,
        });
        setIcon(said.createSpan({ cls: "fs-exam-said-icon" }), answer.selfRight ? "check" : "x");
        said.createSpan({ text: answer.selfRight ? t("EXAM_YOU_KNEW") : t("EXAM_YOU_DIDNT") });
    }
}
