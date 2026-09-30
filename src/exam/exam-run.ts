import "src/exam/exam.css";
import { Component, Notice, setIcon } from "obsidian";

import {
    emptyAnswer,
    ExamAnswer,
    ExamQuestion,
    ExamResult,
    ExamSetup,
    formatClock,
    isAnswered,
    remainingMs,
    scoreExam,
} from "src/exam/exam";
import {
    choiceContext,
    deckLabel,
    ExamRenderContext,
    isMobileDevice,
    renderCardMarkdown,
} from "src/exam/exam-render";
import { ExamResultsView, renderExamResults } from "src/exam/exam-results-view";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { renderChoiceTiles } from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import { renderTypedInput } from "src/ui/obsidian-ui-components/content-container/card-container/typed-answer-view";

/** The timer turns orange when this little time is left. */
const LOW_TIME_MS = 5 * 60_000;

export interface ExamRunOptions {
    plugin: SRPlugin;
    setup: ExamSetup;
    questions: ExamQuestion[];
    ignoreAccents: boolean;
    /** Writes the results file; resolves to its path. */
    save: (result: ExamResult) => Promise<string>;
    /** "Study the ones I missed": the ids of those cards. */
    onStudyMissed: (ids: string[]) => void;
    /** The person is done with the exam screens: Close on the results, or leaving before the end. */
    onClose: () => void;
}

interface DialogAction {
    label: string;
    primary?: boolean;
    run: () => void;
}

/**
 * An exam on screen, from the first question to the results. It draws into any element: the tab of its own
 * (`ExamView`) or the main area of the desktop shell. Nothing here touches a card's schedule.
 *
 * The layout does not move while the person goes through the questions: the top bar, the navigation at the bottom and
 * the question map have fixed sizes, and only the question scrolls, from the top each time.
 */
export class ExamRunner {
    private readonly component = new Component();
    private readonly ctx: ExamRenderContext;
    private readonly root: HTMLElement;
    private readonly setup: ExamSetup;
    private readonly questions: ExamQuestion[];
    private readonly answers: ExamAnswer[];
    /** Self-marked questions whose answer the person has looked at. */
    private readonly revealed = new Set<number>();

    private current = 0;
    private phase: "running" | "results" = "running";
    private readonly startedMs = Date.now();
    private shownAt = Date.now();
    private timerId: number | null = null;
    /** Bumped for each question drawn, so a slow one that is overtaken is dropped. */
    private drawn = 0;
    private dialog: HTMLElement | null = null;
    private results: ExamResultsView | null = null;

    private counterNow: HTMLElement | null = null;
    private progressFill: HTMLElement | null = null;
    private timerEl: HTMLElement | null = null;
    private timerText: HTMLElement | null = null;
    private flagButton: HTMLElement | null = null;
    private stage: HTMLElement | null = null;
    private prevButton: HTMLButtonElement | null = null;
    private nextButton: HTMLButtonElement | null = null;
    private mapSummary: HTMLElement | null = null;
    private readonly cells: HTMLElement[] = [];
    private clearButton: HTMLElement | null = null;

    constructor(
        parent: HTMLElement,
        private readonly opts: ExamRunOptions,
    ) {
        this.setup = opts.setup;
        this.questions = opts.questions;
        this.answers = opts.questions.map(() => emptyAnswer());
        this.component.load();
        this.ctx = { app: opts.plugin.app, plugin: opts.plugin, component: this.component };
        this.root = parent.createDiv({ cls: "fs-exam fs-studio" });
    }

    /** Whether the exam is still going: leaving now loses the answers. */
    get isRunning(): boolean {
        return this.phase === "running";
    }

    start(): void {
        this.buildRunning();
        activeDocument.addEventListener("keydown", this.onKeydown);
        this.tick();
        this.timerId = window.setInterval(() => this.tick(), 1000);
        void this.showQuestion(0);
    }

    /**
     * Runs `then` at once when there is nothing to lose (the results are showing); while the exam is going it asks first.
     */
    requestLeave(then: () => void): void {
        if (this.phase !== "running") {
            then();
            return;
        }
        this.openDialog(
            t("EXAM_LEAVE_TITLE"),
            (body) => body.createDiv({ text: t("EXAM_LEAVE_BODY") }),
            [
                { label: t("EXAM_KEEP_GOING"), run: () => undefined },
                { label: t("EXAM_LEAVE"), primary: true, run: then },
            ],
        );
    }

    destroy(): void {
        this.stopTimer();
        activeDocument.removeEventListener("keydown", this.onKeydown);
        this.component.unload();
        this.root.remove();
    }

    // #region -> The exam

    private buildRunning(): void {
        const root = this.root;
        root.empty();
        root.removeClass("is-results");
        this.cells.length = 0;

        const bar = root.createDiv({ cls: "fs-exam-bar" });
        const left = bar.createDiv({ cls: "fs-exam-bar-side" });
        const quit = left.createEl("button", {
            cls: "fs-exam-icon-button",
            attr: { type: "button", "aria-label": t("EXAM_LEAVE_TITLE") },
        });
        setIcon(quit, "x");
        quit.addEventListener("click", () => this.requestLeave(() => this.opts.onClose()));
        left.createDiv({ cls: "fs-exam-title", text: this.setup.title });

        const counter = bar.createEl("button", {
            cls: "fs-exam-counter",
            attr: { type: "button", "aria-label": t("EXAM_MAP") },
        });
        counter.setCssProps({ "--fs-digits": String(String(this.questions.length).length) });
        this.counterNow = counter.createSpan({ cls: "fs-exam-counter-now", text: "1" });
        counter.createSpan({
            cls: "fs-exam-counter-total",
            text: ` / ${this.questions.length}`,
        });
        setIcon(counter.createSpan({ cls: "fs-exam-counter-icon" }), "chevron-up");
        counter.addEventListener("click", () => this.toggleMap());

        const right = bar.createDiv({ cls: "fs-exam-bar-side is-end" });
        this.flagButton = right.createEl("button", {
            cls: "fs-exam-flag",
            attr: { type: "button", "aria-pressed": "false", "aria-label": t("EXAM_FLAG_LABEL") },
        });
        setIcon(this.flagButton.createSpan({ cls: "fs-exam-flag-icon" }), "flag");
        this.flagButton.createSpan({ cls: "fs-exam-flag-text", text: t("EXAM_FLAG") });
        this.flagButton.addEventListener("click", () => this.toggleFlag());

        this.timerEl = right.createDiv({ cls: "fs-exam-timer", attr: { role: "timer" } });
        setIcon(this.timerEl.createSpan({ cls: "fs-exam-timer-icon" }), "clock");
        this.timerText = this.timerEl.createSpan({ cls: "fs-exam-timer-text" });

        const submit = right.createEl("button", {
            cls: "fs-primary-button fs-exam-submit",
            text: t("EXAM_SUBMIT"),
            attr: { type: "button" },
        });
        submit.addEventListener("click", () => this.requestSubmit());

        this.progressFill = bar
            .createDiv({ cls: "fs-exam-progress" })
            .createDiv({ cls: "fs-exam-progress-fill" });

        const body = root.createDiv({ cls: "fs-exam-body" });
        const column = body.createDiv({ cls: "fs-exam-column" });
        this.stage = column.createDiv({ cls: "fs-exam-stage" });

        const footer = column.createDiv({ cls: "fs-exam-footer" });
        this.prevButton = footer.createEl("button", {
            cls: "fs-exam-ghost fs-exam-prev",
            attr: { type: "button" },
        });
        setIcon(this.prevButton.createSpan({ cls: "fs-exam-nav-icon" }), "arrow-left");
        this.prevButton.createSpan({ text: t("PREVIOUS") });
        this.prevButton.addEventListener("click", () => this.goTo(this.current - 1));
        footer.createDiv({ cls: "fs-exam-keys", text: t("EXAM_KEYS_HINT") });
        this.nextButton = footer.createEl("button", {
            cls: "fs-primary-button fs-exam-next",
            attr: { type: "button" },
        });
        this.nextButton.addEventListener("click", () => this.next());

        this.buildMap(body);
        root.createDiv({ cls: "fs-exam-scrim" }).addEventListener("click", () =>
            this.toggleMap(false),
        );
    }

    /** The question map: a grid of numbers on a desktop, a sheet from the bottom on a phone. */
    private buildMap(parent: HTMLElement): void {
        const map = parent.createDiv({ cls: "fs-exam-map" });
        map.createDiv({ cls: "fs-exam-map-grip" });
        const head = map.createDiv({ cls: "fs-exam-map-head" });
        const title = head.createDiv({ cls: "fs-exam-map-title" });
        title.createDiv({ cls: "fs-label", text: t("EXAM_MAP") });
        this.mapSummary = title.createDiv({ cls: "fs-exam-map-summary" });
        const close = head.createEl("button", {
            cls: "fs-exam-icon-button fs-exam-map-close",
            attr: { type: "button", "aria-label": t("CLOSE") },
        });
        setIcon(close, "x");
        close.addEventListener("click", () => this.toggleMap(false));

        const legend = map.createDiv({ cls: "fs-exam-legend" });
        for (const [cls, label] of [
            ["is-answered", t("EXAM_MAP_ANSWERED")],
            ["is-flagged", t("EXAM_MAP_FLAGGED")],
            ["is-current", t("EXAM_MAP_CURRENT")],
        ]) {
            const item = legend.createSpan({ cls: "fs-exam-legend-item" });
            item.createSpan({ cls: `fs-exam-legend-dot ${cls}` });
            item.createSpan({ text: label });
        }

        const grid = map.createDiv({ cls: "fs-exam-grid" });
        this.questions.forEach((_, index) => {
            const cell = grid.createEl("button", {
                cls: "fs-exam-cell",
                text: String(index + 1),
                attr: { type: "button", "data-index": String(index) },
            });
            cell.addEventListener("click", () => {
                this.goTo(index);
                this.toggleMap(false);
            });
            this.cells.push(cell);
        });

        const actions = map.createDiv({ cls: "fs-exam-map-actions" });
        actions
            .createEl("button", {
                cls: "fs-primary-button",
                text: t("EXAM_SUBMIT"),
                attr: { type: "button" },
            })
            .addEventListener("click", () => {
                this.toggleMap(false);
                this.requestSubmit();
            });
    }

    private toggleMap(open?: boolean): void {
        this.root.toggleClass("is-map-open", open ?? !this.root.hasClass("is-map-open"));
    }

    /** Draws the numbers, the flag, the map and the buttons for the question that is up. */
    private refreshChrome(): void {
        const index = this.current;
        const total = this.questions.length;
        this.counterNow?.setText(String(index + 1));
        const answer = this.answers[index];
        this.flagButton?.toggleClass("is-on", answer.flagged);
        this.flagButton?.setAttribute("aria-pressed", String(answer.flagged));
        if (this.prevButton) this.prevButton.disabled = index === 0;

        if (this.nextButton) {
            this.nextButton.empty();
            const last = index === total - 1;
            this.nextButton.createSpan({ text: last ? t("EXAM_SUBMIT") : t("NEXT") });
            setIcon(
                this.nextButton.createSpan({ cls: "fs-exam-nav-icon" }),
                last ? "check" : "arrow-right",
            );
        }
        this.cells.forEach((_, cellIndex) => this.refreshCell(cellIndex));
        this.refreshProgress();
    }

    private refreshCell(index: number): void {
        const cell = this.cells[index];
        if (cell === undefined) return;
        const answer = this.answers[index];
        const answered = isAnswered(this.questions[index], answer);
        cell.toggleClass("is-answered", answered);
        cell.toggleClass("is-flagged", answer.flagged);
        cell.toggleClass("is-current", index === this.current);
        if (index === this.current) cell.setAttribute("aria-current", "step");
        else cell.removeAttribute("aria-current");
        const state = [
            answered ? t("EXAM_MAP_ANSWERED") : t("EXAM_MAP_UNANSWERED"),
            ...(answer.flagged ? [t("EXAM_MAP_FLAGGED")] : []),
        ]
            .join(", ")
            .toLowerCase();
        cell.setAttribute("aria-label", t("EXAM_MAP_CELL", { n: index + 1, state }));
    }

    private refreshProgress(): void {
        const answered = this.questions.filter((q, i) => isAnswered(q, this.answers[i])).length;
        const total = this.questions.length;
        this.progressFill?.setCssProps({
            "--fs-progress": String(total === 0 ? 0 : answered / total),
        });
        this.mapSummary?.setText(t("EXAM_MAP_PROGRESS", { answered, total }));
    }

    /** Called when the answer to the question that is up changes. */
    private answerChanged(): void {
        this.refreshCell(this.current);
        this.refreshProgress();
        this.clearButton?.toggleClass(
            "is-hidden",
            !isAnswered(this.questions[this.current], this.answers[this.current]),
        );
    }

    private goTo(index: number): void {
        if (this.phase !== "running") return;
        if (index < 0 || index >= this.questions.length || index === this.current) return;
        void this.showQuestion(index);
    }

    private next(): void {
        if (this.current === this.questions.length - 1) this.requestSubmit();
        else this.goTo(this.current + 1);
    }

    private toggleFlag(): void {
        const answer = this.answers[this.current];
        answer.flagged = !answer.flagged;
        this.refreshChrome();
    }

    /** Adds the time since the question was shown to what has been spent on it. */
    private noteTimeSpent(): void {
        const now = Date.now();
        this.answers[this.current].ms += now - this.shownAt;
        this.shownAt = now;
    }

    private tick(): void {
        const now = Date.now();
        const left = remainingMs(this.setup, this.startedMs, now);
        if (left === null) {
            this.timerText?.setText(formatClock(now - this.startedMs));
            this.timerEl?.setAttribute("aria-label", t("EXAM_TIME_ELAPSED"));
            return;
        }
        this.timerText?.setText(formatClock(left));
        this.timerEl?.setAttribute("aria-label", t("EXAM_TIME_LEFT"));
        this.timerEl?.toggleClass("is-low", left < LOW_TIME_MS);
        if (left === 0) this.finish(true);
    }

    private stopTimer(): void {
        if (this.timerId === null) return;
        window.clearInterval(this.timerId);
        this.timerId = null;
    }

    // #endregion

    // #region -> A question

    /**
     * Draws a question. The new one is drawn beside the old one and takes its place once its text has rendered, so
     * the screen never shows a half-drawn question.
     */
    private async showQuestion(index: number): Promise<void> {
        const stage = this.stage;
        if (stage === null) return;
        if (index !== this.current) {
            this.noteTimeSpent();
            this.current = index;
        }
        this.refreshChrome();

        const drawn = ++this.drawn;
        const body = stage.createDiv({ cls: "fs-exam-question-body is-pending" });
        const focus = await this.renderQuestion(body, index);
        if (drawn !== this.drawn) {
            body.remove();
            return;
        }
        for (const old of Array.from(stage.children)) if (old !== body) old.remove();
        body.removeClass("is-pending");
        stage.scrollTop = 0;
        if (focus !== null && !isMobileDevice()) focus.focus();
    }

    /**
     * @returns The field to focus once the question is on screen, if it has one.
     */
    private async renderQuestion(
        body: HTMLElement,
        index: number,
    ): Promise<HTMLInputElement | null> {
        const q = this.questions[index];
        const answer = this.answers[index];
        const renders: Promise<void>[] = [];
        let focus: HTMLInputElement | null = null;

        const meta = body.createDiv({ cls: "fs-exam-meta" });
        meta.createSpan({ cls: "fs-exam-qnum", text: t("EXAM_QUESTION_N", { n: index + 1 }) });
        if (q.deck !== "") meta.createSpan({ cls: "fs-exam-deck", text: deckLabel(q.deck) });
        meta.createSpan({ cls: "fs-exam-kind", text: this.kindLabel(q) });
        this.clearButton = meta.createEl("button", {
            cls: "fs-exam-clear",
            text: t("EXAM_CLEAR"),
            attr: { type: "button" },
        });
        this.clearButton.toggleClass("is-hidden", !isAnswered(q, answer));
        this.clearButton.addEventListener("click", () => {
            answer.chosen = [];
            answer.typed = "";
            answer.selfRight = null;
            this.revealed.delete(index);
            this.answerChanged();
            void this.showQuestion(index);
        });

        const question = body.createDiv({ cls: "fs-exam-question" });
        renders.push(renderCardMarkdown(this.ctx, q.front, question, q.sourcePath));

        if (q.kind === "choice" && q.choice !== null) {
            const mc = q.choice;
            if (mc.lead !== "") {
                const lead = body.createDiv({ cls: "fs-choice-lead fs-exam-lead" });
                renders.push(renderCardMarkdown(this.ctx, mc.lead, lead, q.sourcePath));
            }
            const tiles = renderChoiceTiles(body.createDiv({ cls: "fs-choices" }), mc, q.order, {
                mode: "choose",
                chosen: answer.chosen,
                multiSelect: mc.multiSelect,
                ...choiceContext(this.ctx, q.sourcePath),
                onChoose: (optionIndex) => {
                    answer.chosen = mc.multiSelect
                        ? answer.chosen.includes(optionIndex)
                            ? answer.chosen.filter((chosen) => chosen !== optionIndex)
                            : [...answer.chosen, optionIndex]
                        : [optionIndex];
                    this.answerChanged();
                },
            });
            renders.push(tiles.rendered);
        } else if (q.kind === "typed") {
            focus = renderTypedInput(body.createDiv({ cls: "fs-exam-typed" }), {
                autofocus: false,
                onSubmit: () => this.next(),
            });
            focus.value = answer.typed;
            focus.addEventListener("input", () => {
                answer.typed = focus?.value ?? "";
                this.answerChanged();
            });
        } else if (q.kind === "self") {
            renders.push(this.renderSelf(body, index));
        }

        await Promise.all(renders);
        return focus;
    }

    private kindLabel(q: ExamQuestion): string {
        if (q.kind === "typed") return t("EXAM_KIND_TYPE");
        if (q.kind === "self") return t("EXAM_KIND_SELF");
        return q.choice?.multiSelect === true ? t("CHOICE_SELECT_ALL") : t("EXAM_KIND_ONE");
    }

    /** A question the person marks themselves: look at the answer, then say whether they knew it. */
    private async renderSelf(body: HTMLElement, index: number): Promise<void> {
        const q = this.questions[index];
        const answer = this.answers[index];
        const box = body.createDiv({ cls: "fs-exam-self" });
        if (!this.revealed.has(index) && answer.selfRight === null) {
            const show = box.createEl("button", {
                cls: "fs-exam-reveal",
                text: t("EXAM_SHOW_ANSWER"),
                attr: { type: "button" },
            });
            show.addEventListener("click", () => {
                this.revealed.add(index);
                void this.showQuestion(index);
            });
            return;
        }

        const back = box.createDiv({ cls: "fs-exam-self-answer" });
        const rendered = renderCardMarkdown(this.ctx, q.back, back, q.sourcePath);
        const buttons = box.createDiv({ cls: "fs-exam-self-buttons", attr: { role: "group" } });
        const choices: [boolean, string, string][] = [
            [true, t("EXAM_KNEW_IT"), "check"],
            [false, t("EXAM_DIDNT"), "x"],
        ];
        const pressed: HTMLElement[] = [];
        for (const [value, label, icon] of choices) {
            const button = buttons.createEl("button", {
                cls: `fs-exam-self-button ${value ? "is-yes" : "is-no"}`,
                attr: { type: "button", "aria-pressed": String(answer.selfRight === value) },
            });
            setIcon(button.createSpan({ cls: "fs-exam-self-icon" }), icon);
            button.createSpan({ text: label });
            button.toggleClass("is-selected", answer.selfRight === value);
            pressed.push(button);
            button.addEventListener("click", () => {
                answer.selfRight = value;
                choices.forEach(([other], position) => {
                    pressed[position].toggleClass("is-selected", other === value);
                    pressed[position].setAttribute("aria-pressed", String(other === value));
                });
                this.answerChanged();
            });
        }
        await rendered;
    }

    // #endregion

    // #region -> Submitting

    private requestSubmit(): void {
        if (this.phase !== "running") return;
        this.noteTimeSpent();
        const unanswered = this.questions.filter((q, i) => !isAnswered(q, this.answers[i]));
        const flagged = this.answers.filter((a) => a.flagged).length;
        const firstUnanswered = this.questions.findIndex((q, i) => !isAnswered(q, this.answers[i]));
        const actions: DialogAction[] = [{ label: t("EXAM_KEEP_GOING"), run: () => undefined }];
        if (firstUnanswered >= 0) {
            actions.push({
                label: t("EXAM_GO_UNANSWERED"),
                run: () => this.goTo(firstUnanswered),
            });
        }
        actions.push({ label: t("EXAM_SUBMIT"), primary: true, run: () => this.finish(false) });

        this.openDialog(
            t("EXAM_SUBMIT_TITLE"),
            (body) => {
                if (unanswered.length === 0 && flagged === 0) {
                    body.createDiv({ text: t("EXAM_SUBMIT_ALL_DONE") });
                    return;
                }
                const list = body.createDiv({ cls: "fs-exam-dialog-list" });
                if (unanswered.length > 0) {
                    const line = list.createDiv({ cls: "fs-exam-dialog-line is-unanswered" });
                    setIcon(line.createSpan({ cls: "fs-exam-dialog-icon" }), "circle-help");
                    line.createSpan({
                        text: t("EXAM_SUBMIT_UNANSWERED", { count: unanswered.length }),
                    });
                }
                if (flagged > 0) {
                    const line = list.createDiv({ cls: "fs-exam-dialog-line is-flagged" });
                    setIcon(line.createSpan({ cls: "fs-exam-dialog-icon" }), "flag");
                    line.createSpan({ text: t("EXAM_SUBMIT_FLAGGED", { count: flagged }) });
                }
                if (unanswered.length > 0) {
                    body.createDiv({ cls: "fs-exam-dialog-note", text: t("EXAM_SUBMIT_WARNING") });
                }
            },
            actions,
        );
    }

    /**
     * Marks the exam, saves it and shows the results. Time running out submits it as it is.
     */
    private finish(timeUp: boolean): void {
        if (this.phase !== "running") return;
        this.stopTimer();
        this.closeDialog();
        this.noteTimeSpent();
        const result = scoreExam(
            this.setup,
            this.questions,
            this.answers,
            this.startedMs,
            Date.now(),
            this.opts.ignoreAccents,
        );
        this.phase = "results";
        if (timeUp) new Notice(t("EXAM_TIME_UP"));

        this.root.empty();
        this.root.addClass("is-results");
        this.root.removeClass("is-map-open");
        this.results = renderExamResults(this.root, result, {
            ctx: this.ctx,
            ignoreAccents: this.opts.ignoreAccents,
            onStudyMissed: (ids) => this.opts.onStudyMissed(ids),
            onClose: () => this.opts.onClose(),
        });
        this.opts
            .save(result)
            .then((path) => this.results?.showSaved(path))
            .catch((error: unknown) => {
                console.error("Flashcard Studio: could not save the exam", error);
                this.results?.showSaveFailed(error instanceof Error ? error.message : "");
            });
    }

    // #endregion

    // #region -> Dialogs and keys

    private openDialog(
        title: string,
        fill: (body: HTMLElement) => void,
        actions: DialogAction[],
    ): void {
        this.closeDialog();
        const scrim = this.root.createDiv({ cls: "fs-exam-dialog-scrim" });
        const dialog = scrim.createDiv({
            cls: "fs-exam-dialog fs-card",
            attr: { role: "dialog", "aria-modal": "true", "aria-label": title },
        });
        dialog.createDiv({ cls: "fs-exam-dialog-title", text: title });
        fill(dialog.createDiv({ cls: "fs-exam-dialog-body" }));
        const row = dialog.createDiv({ cls: "fs-exam-dialog-actions" });
        const buttons = actions.map((action) => {
            const button = row.createEl("button", {
                cls: action.primary ? "fs-primary-button" : "fs-exam-ghost",
                text: action.label,
                attr: { type: "button" },
            });
            button.addEventListener("click", () => {
                this.closeDialog();
                action.run();
            });
            return button;
        });
        scrim.addEventListener("click", (event) => {
            if (event.target === scrim) this.closeDialog();
        });
        dialog.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            this.closeDialog();
        });
        this.dialog = scrim;
        // The first button never does anything that cannot be undone
        buttons[0]?.focus();
    }

    private closeDialog(): void {
        this.dialog?.remove();
        this.dialog = null;
    }

    /** 1 to 9 choose an option, the arrows move, F flags, Enter goes on. */
    private readonly onKeydown = (event: KeyboardEvent): void => {
        if (this.phase !== "running" || this.dialog !== null || this.stage === null) return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        // Another tab, or a dialog of Obsidian's (the settings, the command palette) is in front
        if (!this.root.isShown() || activeDocument.querySelector(".modal-container, .prompt"))
            return;

        const target = event.target instanceof HTMLElement ? event.target : null;
        const typing =
            target !== null &&
            (target.isContentEditable ||
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT");
        if (typing) return;

        let handled = true;
        if (event.key === "ArrowRight") this.next();
        else if (event.key === "ArrowLeft") this.goTo(this.current - 1);
        else if (event.key === "f" || event.key === "F") this.toggleFlag();
        else if (event.key === "Enter") {
            // A button keeps its own Enter, except a tile: Enter there goes on
            if (target?.tagName === "BUTTON" && !target.hasClass("fs-choice")) return;
            if (this.current < this.questions.length - 1) this.goTo(this.current + 1);
        } else if (/^[1-9]$/.test(event.key)) {
            const tile =
                this.stage.querySelectorAll<HTMLElement>(".fs-choice")[Number(event.key) - 1];
            if (tile === undefined) return;
            tile.click();
        } else handled = false;
        if (handled) event.preventDefault();
    };

    // #endregion
}
