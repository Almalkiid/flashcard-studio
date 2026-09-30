import "src/exam/exam.css";
import { Modal, setIcon } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import {
    EXAM_PRESETS,
    ExamCardFilter,
    ExamCardInput,
    ExamResult,
    ExamSetup,
    ExamStart,
    joinDeckNames,
    pickExamQuestions,
} from "src/exam/exam";
import { collectExamCards } from "src/exam/exam-cards";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { deckMatches } from "src/stats/scope";
import { readableDeckName } from "src/ui/design/deck-identity";
import { topLevelDecks } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";
import { formatDate, formatDuration } from "src/ui/statistics-view/format";

const MIN_COUNT = 1;
const MAX_COUNT = 500;
const MIN_MINUTES = 1;
const MAX_MINUTES = 600;
const MINUTES_STEP = 5;
const DEFAULT_MINUTES = 60;
const RECENT_SHOWN = 5;

/** A deck in the list, with the cards in it and in its subdecks. */
interface DeckRow {
    path: string;
    name: string;
    depth: number;
    count: number;
    /** The paths of the decks below it, so choosing it chooses them. */
    below: string[];
}

function whenText(ms: number): string {
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    if (days <= 0) return t("DESKTOP_WHEN_TODAY");
    if (days === 1) return t("DESKTOP_WHEN_YESTERDAY");
    return formatDate(ms);
}

/**
 * Sets up an exam: a preset or your own choice of decks, number of questions, time limit and kind of cards, and the
 * last exams for a look at how it went. Start builds the questions and hands them to `onStart`; nothing is read from
 * or written to a card.
 */
export class ExamSetupModal extends Modal {
    private readonly plugin: SRPlugin;
    private readonly onStart: (start: ExamStart) => void;
    private readonly recent: ExamResult[];
    private readonly cards: ExamCardInput[];
    private readonly rows: DeckRow[];

    private readonly checked = new Set<string>();
    private count: number;
    private minutes: number | null;
    private filter: ExamCardFilter;
    private title = "";
    private titleEdited = false;
    private passPercent: number;

    private presetButtons: { id: string; el: HTMLElement }[] = [];
    private deckBoxes = new Map<string, HTMLInputElement>();
    private allButton: HTMLElement | null = null;
    private countInput: HTMLInputElement | null = null;
    private minutesInput: HTMLInputElement | null = null;
    private noLimitBox: HTMLInputElement | null = null;
    private titleInput: HTMLInputElement | null = null;
    private statusEl: HTMLElement | null = null;
    private startButton: HTMLButtonElement | null = null;
    private filterRadios = new Map<ExamCardFilter, HTMLInputElement>();

    /**
     * @param recent - The last exams, newest first. The newest one is what the form starts from, so a retake is one
     * press of Start.
     */
    constructor(plugin: SRPlugin, recent: ExamResult[], onStart: (start: ExamStart) => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.onStart = onStart;
        this.recent = recent;
        this.modalEl.addClass("fs-exam-modal", "fs-studio");
        this.contentEl.addClass("fs-exam-setup");
        this.setTitle(t("EXAM_SETUP_TITLE"));

        const tree = plugin.dataManager.osrCore.reviewableDeckTree;
        this.cards = collectExamCards(tree);
        this.rows = this.deckRows(tree);

        const last = recent[0]?.setup;
        const settings = plugin.dataManager.data.settings;
        this.passPercent = settings.examPassPercent;
        if (last === undefined) {
            this.count = EXAM_PRESETS[0].count;
            this.minutes = EXAM_PRESETS[0].minutes;
            // Multiple choice is what an exam is for, when there are such cards
            const hasChoice =
                pickExamQuestions(
                    this.cards,
                    { ...this.baseSetup(), filter: "choice-only", count: 1 },
                    () => 0,
                ).length > 0;
            this.filter = hasChoice ? "choice-only" : "all";
            for (const row of this.rows) this.checked.add(row.path);
        } else {
            this.count = last.count;
            this.minutes = last.minutes;
            this.filter = last.filter;
            this.selectDecks(last.decks);
            // Decks that have gone since leave nothing ticked: start from every deck instead
            if (this.checked.size === 0) for (const row of this.rows) this.checked.add(row.path);
        }
        this.title = last?.title ?? "";
        this.titleEdited = last !== undefined && last.title !== this.defaultTitle();
        if (!this.titleEdited) this.title = this.defaultTitle();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.cards.length === 0) {
            contentEl.createDiv({ cls: "fs-exam-empty", text: t("EXAM_NO_CARDS") });
            this.renderActions(contentEl);
            return;
        }
        this.renderPresets(contentEl);
        this.renderDecks(contentEl);
        this.renderCountAndTime(contentEl);
        this.renderFilter(contentEl);
        this.renderTitleAndPass(contentEl);
        this.statusEl = contentEl.createDiv({ cls: "fs-exam-status", attr: { role: "status" } });
        this.renderRecent(contentEl);
        this.renderActions(contentEl);
        this.refresh();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // #region -> State

    private baseSetup(): ExamSetup {
        return {
            decks: this.selectedDecks(),
            count: this.count,
            minutes: this.minutes,
            filter: this.filter,
            passPercent: this.passPercent,
            title: this.title,
            shuffleOptions: this.plugin.dataManager.data.settings.shuffleChoices,
        };
    }

    /**
     * The decks the exam takes cards from: empty for every deck, else the chosen decks without the ones already inside
     * another chosen deck.
     */
    private selectedDecks(): string[] {
        if (this.rows.length === 0 || this.rows.every((row) => this.checked.has(row.path))) {
            return [];
        }
        return this.rows
            .filter((row) => this.checked.has(row.path))
            .map((row) => row.path)
            .filter(
                (path, _, all) => !all.some((other) => other !== path && deckMatches(other, path)),
            );
    }

    private selectDecks(decks: string[]): void {
        this.checked.clear();
        for (const row of this.rows) {
            if (decks.length === 0 || decks.some((deck) => deckMatches(deck, row.path))) {
                this.checked.add(row.path);
            }
        }
    }

    private deckRows(tree: Deck): DeckRow[] {
        const rows: DeckRow[] = [];
        const add = (deck: Deck, depth: number) => {
            const path = deck.getTopicPath().path.join("/");
            const ids = new Set(
                this.cards.filter((card) => deckMatches(path, card.deck)).map((card) => card.id),
            );
            const below: string[] = [];
            const start = rows.length;
            rows.push({
                path,
                name: readableDeckName(deck.deckName),
                depth,
                count: ids.size,
                below,
            });
            for (const child of deck.subdecks) add(child, depth + 1);
            below.push(...rows.slice(start + 1).map((row) => row.path));
        };
        for (const deck of topLevelDecks(tree)) add(deck, 0);
        return rows;
    }

    /** `Exam · CIA` for the decks chosen, or `Exam` for all of them. */
    private defaultTitle(): string {
        const top = this.rows.filter((row) => row.depth === 0);
        const names =
            this.selectedDecks().length === 0
                ? top.map((row) => row.name)
                : this.rows
                      .filter((row) => this.selectedDecks().includes(row.path))
                      .map((row) => row.name);
        return names.length === 0
            ? t("EXAM_DEFAULT_TITLE_ALL")
            : t("EXAM_DEFAULT_TITLE", { decks: joinDeckNames(names) });
    }

    /** How many questions the exam could have, with the decks and the kind of cards chosen. */
    private available(): number {
        // No deck ticked is no cards, not every deck
        if (this.rows.length > 0 && this.checked.size === 0) return 0;
        return pickExamQuestions(
            this.cards,
            { ...this.baseSetup(), count: Number.MAX_SAFE_INTEGER },
            () => 0,
        ).length;
    }

    // #endregion

    // #region -> Screen

    private renderPresets(parent: HTMLElement): void {
        const group = parent.createDiv({
            cls: "fs-exam-presets",
            attr: { role: "radiogroup", "aria-label": t("EXAM_SETUP_TITLE") },
        });
        const labels = {
            quick: [t("EXAM_PRESET_QUICK"), "zap"],
            cia: [t("EXAM_PRESET_CIA"), "graduation-cap"],
        } as const;
        for (const preset of EXAM_PRESETS) {
            const [label, icon] = labels[preset.id];
            const button = group.createEl("button", {
                cls: "fs-exam-preset",
                attr: { type: "button", role: "radio", "data-preset": preset.id },
            });
            setIcon(button.createSpan({ cls: "fs-exam-preset-icon" }), icon);
            const text = button.createDiv({ cls: "fs-exam-preset-text" });
            text.createSpan({ cls: "fs-exam-preset-title", text: label });
            text.createSpan({
                cls: "fs-exam-preset-desc",
                text:
                    preset.minutes === null
                        ? t("EXAM_PRESET_QUICK_DESC", { count: preset.count })
                        : t("EXAM_PRESET_CIA_DESC", {
                              count: preset.count,
                              minutes: preset.minutes,
                          }),
            });
            button.addEventListener("click", () => {
                this.count = preset.count;
                this.minutes = preset.minutes;
                this.refresh();
            });
            this.presetButtons.push({ id: preset.id, el: button });
        }
    }

    private renderDecks(parent: HTMLElement): void {
        const field = parent.createDiv({ cls: "fs-exam-field" });
        const head = field.createDiv({ cls: "fs-exam-field-head" });
        head.createDiv({ cls: "fs-label", text: t("EXAM_DECKS") });
        this.allButton = head.createEl("button", {
            cls: "fs-exam-link",
            text: t("EXAM_ALL_DECKS"),
            attr: { type: "button" },
        });
        this.allButton.addEventListener("click", () => {
            const all = this.rows.every((row) => this.checked.has(row.path));
            this.checked.clear();
            if (!all) for (const row of this.rows) this.checked.add(row.path);
            this.refresh();
        });

        const list = field.createDiv({ cls: "fs-exam-decks-list", attr: { role: "group" } });
        for (const row of this.rows) {
            const line = list.createEl("label", { cls: "fs-exam-deck-line" });
            line.setCssProps({ "--fs-depth": String(Math.min(row.depth, 4)) });
            const box = line.createEl("input", {
                attr: { type: "checkbox", "data-deck": row.path },
            });
            box.addEventListener("change", () => {
                for (const path of [row.path, ...row.below]) {
                    if (box.checked) this.checked.add(path);
                    else this.checked.delete(path);
                }
                // A deck counts as chosen only with everything below it, so the decks above follow. Deepest first,
                // so each one reads the state of the ones under it after they have followed
                for (const other of [...this.rows].reverse()) {
                    if (!other.below.includes(row.path)) continue;
                    if (other.below.every((path) => this.checked.has(path))) {
                        this.checked.add(other.path);
                    } else {
                        this.checked.delete(other.path);
                    }
                }
                this.refresh();
            });
            this.deckBoxes.set(row.path, box);
            line.createSpan({ cls: "fs-exam-deck-check" });
            line.createSpan({ cls: "fs-exam-deck-line-name", text: row.name });
            line.createSpan({ cls: "fs-exam-deck-line-count", text: String(row.count) });
        }
    }

    private renderCountAndTime(parent: HTMLElement): void {
        const grid = parent.createDiv({ cls: "fs-exam-two" });

        const countField = grid.createDiv({ cls: "fs-exam-field" });
        countField.createEl("label", {
            cls: "fs-label",
            text: t("EXAM_COUNT"),
            attr: { for: "fs-exam-count" },
        });
        this.countInput = this.stepper(
            countField,
            "fs-exam-count",
            MIN_COUNT,
            MAX_COUNT,
            1,
            (value) => {
                this.count = value;
                this.refresh();
            },
        );

        const timeField = grid.createDiv({ cls: "fs-exam-field" });
        timeField.createEl("label", {
            cls: "fs-label",
            text: t("EXAM_TIME_LIMIT"),
            attr: { for: "fs-exam-minutes" },
        });
        const row = timeField.createDiv({ cls: "fs-exam-time" });
        this.minutesInput = this.stepper(
            row,
            "fs-exam-minutes",
            MIN_MINUTES,
            MAX_MINUTES,
            MINUTES_STEP,
            (value) => {
                this.minutes = value;
                this.refresh();
            },
        );
        row.createSpan({ cls: "fs-exam-unit", text: t("EXAM_MINUTES") });
        const chip = row.createEl("label", { cls: "fs-exam-chip" });
        this.noLimitBox = chip.createEl("input", { attr: { type: "checkbox" } });
        setIcon(chip.createSpan({ cls: "fs-exam-chip-tick" }), "check");
        chip.createSpan({ text: t("EXAM_NO_LIMIT") });
        this.noLimitBox.addEventListener("change", () => {
            this.minutes = this.noLimitBox?.checked === true ? null : DEFAULT_MINUTES;
            this.refresh();
        });
    }

    /** A number field with minus and plus buttons. `onSet` gets the value once it is a whole number in range. */
    private stepper(
        parent: HTMLElement,
        id: string,
        min: number,
        max: number,
        step: number,
        onSet: (value: number) => void,
    ): HTMLInputElement {
        const box = parent.createDiv({ cls: "fs-exam-stepper" });
        const minus = box.createEl("button", {
            cls: "fs-exam-step",
            attr: { type: "button", "aria-label": "−" },
        });
        setIcon(minus, "minus");
        const input = box.createEl("input", {
            cls: "fs-exam-number",
            attr: { id, type: "number", min: String(min), max: String(max), inputmode: "numeric" },
        });
        const plus = box.createEl("button", {
            cls: "fs-exam-step",
            attr: { type: "button", "aria-label": "+" },
        });
        setIcon(plus, "plus");
        const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
        minus.addEventListener("click", () => onSet(clamp((Number(input.value) || min) - step)));
        plus.addEventListener("click", () => onSet(clamp((Number(input.value) || min) + step)));
        input.addEventListener("change", () => {
            const value = Number(input.value);
            onSet(Number.isFinite(value) && input.value !== "" ? clamp(value) : min);
        });
        return input;
    }

    private renderFilter(parent: HTMLElement): void {
        const field = parent.createDiv({ cls: "fs-exam-field" });
        field.createDiv({ cls: "fs-label", text: t("EXAM_CARDS") });
        const group = field.createDiv({ cls: "fs-exam-options", attr: { role: "radiogroup" } });
        const options: [ExamCardFilter, string, string][] = [
            ["choice-only", t("EXAM_CARDS_CHOICE"), t("EXAM_CARDS_CHOICE_DESC")],
            ["all", t("EXAM_CARDS_ALL"), t("EXAM_CARDS_ALL_DESC")],
        ];
        for (const [value, title, description] of options) {
            const segment = group.createEl("label", { cls: "fs-exam-segment-card" });
            const radio = segment.createEl("input", {
                attr: { type: "radio", name: "fs-exam-filter", value },
            });
            const text = segment.createDiv({ cls: "fs-exam-segment-text" });
            text.createSpan({ cls: "fs-exam-segment-title", text: title });
            text.createSpan({ cls: "fs-exam-segment-desc", text: description });
            radio.addEventListener("change", () => {
                if (!radio.checked) return;
                this.filter = value;
                this.refresh();
            });
            this.filterRadios.set(value, radio);
        }
    }

    private renderTitleAndPass(parent: HTMLElement): void {
        const grid = parent.createDiv({ cls: "fs-exam-two is-title" });
        const titleField = grid.createDiv({ cls: "fs-exam-field" });
        titleField.createEl("label", {
            cls: "fs-label",
            text: t("EXAM_TITLE_FIELD"),
            attr: { for: "fs-exam-title" },
        });
        this.titleInput = titleField.createEl("input", {
            cls: "fs-exam-text",
            attr: { id: "fs-exam-title", type: "text", autocomplete: "off" },
        });
        this.titleInput.addEventListener("input", () => {
            this.title = this.titleInput?.value ?? "";
            this.titleEdited = true;
        });

        const passField = grid.createDiv({ cls: "fs-exam-field" });
        passField.createEl("label", {
            cls: "fs-label",
            text: t("EXAM_PASS_MARK"),
            attr: { for: "fs-exam-pass" },
        });
        const pass = this.stepper(passField, "fs-exam-pass", 1, 100, 5, (value) => {
            this.passPercent = value;
            pass.value = String(value);
        });
        pass.value = String(this.passPercent);
    }

    private renderRecent(parent: HTMLElement): void {
        if (this.recent.length === 0) return;
        const field = parent.createDiv({ cls: "fs-exam-field fs-exam-recent" });
        field.createDiv({ cls: "fs-label", text: t("EXAM_RECENT") });
        for (const exam of this.recent.slice(0, RECENT_SHOWN)) {
            const row = field.createDiv({ cls: "fs-exam-recent-row" });
            row.toggleClass("is-passed", exam.passed);
            row.createSpan({ cls: "fs-exam-recent-score", text: `${exam.percent}%` });
            const text = row.createDiv({ cls: "fs-exam-recent-text" });
            text.createDiv({ cls: "fs-exam-recent-title", text: exam.setup.title });
            text.createDiv({
                cls: "fs-exam-recent-detail",
                text: t("EXAM_RECENT_DETAIL", {
                    right: exam.right,
                    total: exam.total,
                    time: formatDuration(exam.endedMs - exam.startedMs),
                    when: whenText(exam.endedMs),
                }),
            });
        }
    }

    private renderActions(parent: HTMLElement): void {
        const actions = parent.createDiv({ cls: "fs-exam-actions is-setup" });
        actions
            .createEl("button", {
                cls: "fs-exam-ghost",
                text: t("CANCEL"),
                attr: { type: "button" },
            })
            .addEventListener("click", () => this.close());
        if (this.cards.length === 0) return;
        this.startButton = actions.createEl("button", {
            cls: "fs-primary-button fs-exam-start",
            attr: { type: "button" },
        });
        setIcon(this.startButton.createSpan({ cls: "fs-exam-start-icon" }), "play");
        this.startButton.createSpan({ text: t("EXAM_START") });
        this.startButton.addEventListener("click", () => this.start());
    }

    /** Brings every control in line with the state. */
    private refresh(): void {
        for (const { id, el } of this.presetButtons) {
            const preset = EXAM_PRESETS.find((candidate) => candidate.id === id);
            const on = preset?.count === this.count && preset.minutes === this.minutes;
            el.toggleClass("is-selected", on);
            el.setAttribute("aria-checked", String(on));
        }
        for (const row of this.rows) {
            const box = this.deckBoxes.get(row.path);
            if (box === undefined) continue;
            box.checked = this.checked.has(row.path);
            box.indeterminate = !box.checked && row.below.some((path) => this.checked.has(path));
        }
        const all = this.rows.every((row) => this.checked.has(row.path));
        this.allButton?.toggleClass("is-active", all);

        if (this.countInput) this.countInput.value = String(this.count);
        const limited = this.minutes !== null;
        if (this.minutesInput) {
            this.minutesInput.value = String(this.minutes ?? DEFAULT_MINUTES);
            this.minutesInput.disabled = !limited;
        }
        this.minutesInput?.closest(".fs-exam-stepper")?.toggleClass("is-disabled", !limited);
        if (this.noLimitBox) this.noLimitBox.checked = !limited;
        for (const [value, radio] of this.filterRadios) radio.checked = value === this.filter;

        if (!this.titleEdited) this.title = this.defaultTitle();
        if (this.titleInput && activeDocument.activeElement !== this.titleInput) {
            this.titleInput.value = this.title;
        }

        const available = this.available();
        if (this.statusEl) {
            this.statusEl.empty();
            this.statusEl.toggleClass("is-error", available === 0);
            this.statusEl.toggleClass("is-warning", available > 0 && available < this.count);
            if (available === 0) {
                this.statusEl.setText(
                    this.filter === "choice-only" ? t("EXAM_NONE_CHOICE") : t("EXAM_NONE_ALL"),
                );
            } else if (available < this.count) {
                this.statusEl.setText(t("EXAM_AVAILABLE_FEWER", { count: available }));
            } else {
                this.statusEl.setText(t("EXAM_AVAILABLE", { count: available }));
            }
        }
        if (this.startButton) this.startButton.disabled = available === 0;
    }

    private start(): void {
        const setup: ExamSetup = {
            ...this.baseSetup(),
            title: this.title.trim() || this.defaultTitle(),
        };
        const questions =
            this.available() === 0 ? [] : pickExamQuestions(this.cards, setup, Math.random);
        if (questions.length === 0) {
            this.refresh();
            return;
        }
        this.close();
        this.onStart({ setup, questions });
    }

    // #endregion
}
