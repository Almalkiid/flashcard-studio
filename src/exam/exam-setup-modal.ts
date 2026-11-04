import "src/exam/exam.css";
import { Modal, setIcon, setTooltip } from "obsidian";

import { aiSettingsOf, MeaningChecker, meaningChecker } from "src/ai/ai-access";
import { aiUsesInsecureHttp } from "src/ai/ai-provider";
import { NotePickerModal } from "src/ai/note-picker-modal";
import { Deck } from "src/data/decks/deck";
import {
    EXAM_PRESETS,
    ExamCardFilter,
    ExamCardInput,
    examNoteCounts,
    ExamResult,
    ExamSetup,
    ExamStart,
    joinDeckNames,
    noteName,
    pickExamQuestions,
} from "src/exam/exam";
import { collectExamCards } from "src/exam/exam-cards";
import { trapTab } from "src/exam/exam-dom";
import { ExamDraft } from "src/exam/exam-draft";
import { renderDraftRows } from "src/exam/exam-resume";
import { t } from "src/lang/translate";
import { daysAgo } from "src/stats/day-keys";
import { deckMatches } from "src/stats/scope";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { readableDeckName } from "src/ui/design/deck-identity";
import { markFocusVisible } from "src/ui/focus-visible";
import { topLevelDecks } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";
import { formatDate, formatDuration } from "src/ui/statistics-view/format";
import { currentDayKeyFn } from "src/ui/statistics-view/stats-data";

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

/** Where the exam takes its cards from: the decks ticked, or the notes chosen. */
type ExamSource = "decks" | "notes";

function whenText(ms: number): string {
    const days = daysAgo(ms, Date.now(), currentDayKeyFn());
    if (days <= 0) return t("DESKTOP_WHEN_TODAY");
    if (days === 1) return t("DESKTOP_WHEN_YESTERDAY");
    return formatDate(ms);
}

/** `12 questions`, for a note in the list and in the search. */
function questionsText(count: number): string {
    return count === 1 ? t("EXAM_NOTE_QUESTIONS_ONE") : t("EXAM_NOTE_QUESTIONS", { count });
}

/**
 * The notes the setup starts with: the note it was opened for, else the notes of the last exam that can still give
 * questions (a note renamed, deleted or emptied since is dropped). Empty means the setup starts from decks.
 */
export function startingNotes(
    last: ExamSetup | undefined,
    openedFor: string | undefined,
    askable: ReadonlyMap<string, number>,
): string[] {
    if (openedFor !== undefined) return [openedFor];
    return (last?.notes ?? []).filter((path) => (askable.get(path) ?? 0) > 0);
}

/** `Exam · Cell` for the notes chosen (`Exam · Cell, DNA, Genes +2` for more), or `Exam` before one is. */
export function notesTitle(paths: string[]): string {
    return paths.length === 0
        ? t("EXAM_DEFAULT_TITLE_ALL")
        : t("EXAM_DEFAULT_TITLE", { decks: joinDeckNames(paths.map(noteName)) });
}

/**
 * Sets up an exam: a preset or your own choice of decks or notes, number of questions, time limit and kind of cards,
 * and the last exams for a look at how it went. Start builds the questions and hands them to `onStart`; nothing is
 * read from or written to a card.
 */
export class ExamSetupModal extends Modal {
    private readonly plugin: FlashcardStudioPlugin;
    private readonly onStart: (start: ExamStart) => void;
    private readonly recent: ExamResult[];
    /** Exams that were started and not finished; they are offered before a new one is set up. */
    private drafts: ExamDraft[];
    private readonly cards: ExamCardInput[];
    private readonly rows: DeckRow[];

    private source: ExamSource = "decks";
    /** The notes chosen, in the order they were added. */
    private readonly notes: string[] = [];
    /**
     * The questions each note can give, for each kind of cards: worked out once each, the cards do not change while the
     * dialog is open.
     */
    private readonly noteCounts = new Map<ExamCardFilter, Map<string, number>>();
    private readonly checked = new Set<string>();
    private count: number;
    private minutes: number | null;
    private filter: ExamCardFilter;
    private title = "";
    private titleEdited = false;
    private passPercent: number;
    /** The AI set up for card generation, which can check typed answers when the exam is submitted. */
    private readonly ai: MeaningChecker;
    /** Whether that AI can be used: worked out once, when the dialog opens. Without it the option is not offered. */
    private readonly aiUsable: boolean;
    private aiCheck: boolean;

    private presetButtons: { id: string; el: HTMLElement }[] = [];
    private sourceButtons = new Map<ExamSource, HTMLElement>();
    private deckBoxes = new Map<string, HTMLInputElement>();
    private deckListEl: HTMLElement | null = null;
    private notesBox: HTMLElement | null = null;
    /** The list of the notes chosen. */
    private notesEl: HTMLElement | null = null;
    private addNoteButton: HTMLElement | null = null;
    private allButton: HTMLElement | null = null;
    private countInput: HTMLInputElement | null = null;
    private minutesInput: HTMLInputElement | null = null;
    private noLimitBox: HTMLInputElement | null = null;
    private titleInput: HTMLInputElement | null = null;
    private statusEl: HTMLElement | null = null;
    private startButton: HTMLButtonElement | null = null;
    private filterRadios = new Map<ExamCardFilter, HTMLInputElement>();
    private aiOption: HTMLElement | null = null;
    private aiBox: HTMLInputElement | null = null;

    /**
     * @param recent - The last exams, newest first. The newest one is what the form starts from, so a retake is one
     * press of Start.
     * @param drafts - The exams that were not finished. Resuming one starts it through `onStart`, like a new exam.
     * @param openedFor - The path of a note to take the exam from ("Take an exam from this note"): the setup starts
     * with that note chosen.
     */
    constructor(
        plugin: FlashcardStudioPlugin,
        recent: ExamResult[],
        drafts: ExamDraft[],
        onStart: (start: ExamStart) => void,
        openedFor?: string,
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.onStart = onStart;
        this.recent = recent;
        this.drafts = drafts;
        this.modalEl.addClass("fs-exam-modal", "fs-studio");
        this.contentEl.addClass("fs-exam-setup");
        this.setTitle(t("EXAM_SETUP_TITLE"));
        // Tab stays in the dialog, and does not reach the exam or the notes behind it
        trapTab(this.modalEl);

        const tree = plugin.dataManager.vaultIndex.reviewableRoot;
        this.cards = collectExamCards(tree);
        this.rows = this.deckRows(tree);

        const last = recent[0]?.setup;
        const settings = plugin.dataManager.data.settings;
        this.passPercent = settings.examPassPercent;
        this.ai = meaningChecker(plugin.app, () => plugin.dataManager.data.settings);
        this.aiUsable = this.ai.usable();
        this.aiCheck = last?.aiCheck === true;
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

        const notes = startingNotes(last, openedFor, this.countsFor("all"));
        if (notes.length > 0) {
            this.source = "notes";
            this.notes.push(...notes);
        }
        // Opened for a note whose cards are not multiple choice: ask them, rather than open on "no questions"
        if (openedFor !== undefined && !this.countsFor(this.filter).has(openedFor)) {
            this.filter = "all";
        }

        const lastNotes = last?.notes ?? [];
        if (
            last === undefined ||
            openedFor !== undefined ||
            (lastNotes.length > 0 && this.source === "decks")
        ) {
            // A custom title of another exam is not carried onto this one
            this.titleEdited = false;
        } else if (lastNotes.length > 0) {
            // The default as it was, from the paths alone: a note gone since does not make it look edited
            this.titleEdited = last.title !== notesTitle(lastNotes);
        } else {
            this.titleEdited = last.title !== this.defaultTitle();
        }
        this.title = this.titleEdited && last !== undefined ? last.title : this.defaultTitle();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.cards.length === 0) {
            contentEl.createDiv({ cls: "fs-exam-empty", text: t("EXAM_NO_CARDS") });
            this.renderActions(contentEl);
            return;
        }
        this.renderDrafts(contentEl);
        this.renderPresets(contentEl);
        this.renderSource(contentEl);
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

    /** The exam as the form stands. An exam from notes has no decks; one from decks has no `notes` at all. */
    private baseSetup(): ExamSetup {
        const fromNotes = this.source === "notes";
        return {
            decks: fromNotes ? [] : this.selectedDecks(),
            count: this.count,
            minutes: this.minutes,
            filter: this.filter,
            passPercent: this.passPercent,
            title: this.title,
            shuffleOptions: this.plugin.dataManager.data.settings.shuffleChoices,
            ...(fromNotes ? { notes: [...this.notes] } : {}),
            // Written only when on, so an exam without it is saved as it always was
            ...(this.aiCheckOn() ? { aiCheck: true } : {}),
        };
    }

    /**
     * Whether the typed answers go to the AI when the exam is submitted: chosen, and possible. Multiple choice only has
     * no typed answers, and an AI that is not set up is not offered.
     */
    private aiCheckOn(): boolean {
        return this.aiUsable && this.filter === "all" && this.aiCheck;
    }

    /** The questions each note can give with a kind of cards. */
    private countsFor(filter: ExamCardFilter): Map<string, number> {
        let counts = this.noteCounts.get(filter);
        if (counts === undefined) {
            counts = examNoteCounts(this.cards, filter);
            this.noteCounts.set(filter, counts);
        }
        return counts;
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
        // The cards of each deck and of everything below it, in one pass over the cards: a card is in its own deck and
        // in every deck above it
        const idsByDeck = new Map<string, Set<string>>();
        for (const card of this.cards) {
            const parts = card.deck.split("/");
            for (let length = 1; length <= parts.length; length++) {
                const key = parts.slice(0, length).join("/");
                const ids = idsByDeck.get(key) ?? new Set<string>();
                ids.add(card.id);
                idsByDeck.set(key, ids);
            }
        }
        const rows: DeckRow[] = [];
        const add = (deck: Deck, depth: number) => {
            const path = deck.getTopicPath().path.join("/");
            const ids = idsByDeck.get(path) ?? new Set<string>();
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

    /** `Exam · CIA` for the decks chosen, or `Exam` for all of them; `Exam · Cell` for the notes chosen. */
    private defaultTitle(): string {
        if (this.source === "notes") return notesTitle(this.notes);
        const top = this.rows.filter((row) => row.depth === 0);
        // Worked out once: it costs a pass over the chosen decks for each of them
        const selected = new Set(this.selectedDecks());
        const names =
            selected.size === 0
                ? top.map((row) => row.name)
                : this.rows.filter((row) => selected.has(row.path)).map((row) => row.name);
        return names.length === 0
            ? t("EXAM_DEFAULT_TITLE_ALL")
            : t("EXAM_DEFAULT_TITLE", { decks: joinDeckNames(names) });
    }

    /** How many questions the exam could have, with the decks or notes and the kind of cards chosen. */
    private available(): number {
        if (this.source === "notes") {
            // No note chosen is no cards, not every note
            if (this.notes.length === 0) return 0;
        } else if (this.rows.length > 0 && this.checked.size === 0) {
            // No deck ticked is no cards, not every deck
            return 0;
        }
        return pickExamQuestions(
            this.cards,
            { ...this.baseSetup(), count: Number.MAX_SAFE_INTEGER },
            () => 0,
        ).length;
    }

    // #endregion

    // #region -> Screen

    /** An exam that was left comes first: the person most likely wants to go on with it. */
    private renderDrafts(parent: HTMLElement): void {
        if (this.drafts.length === 0) return;
        const field = parent.createDiv({ cls: "fs-exam-field fs-exam-resume" });
        field.createDiv({ cls: "fs-label", text: t("EXAM_RESUME_TITLE") });
        renderDraftRows(
            field,
            this.plugin,
            this.drafts,
            (start) => {
                this.close();
                this.onStart(start);
            },
            (left) => {
                this.drafts = left;
                this.onOpen();
                this.refresh();
            },
        );
    }

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

    /** Where the cards come from: a switch between decks and notes, then the deck list or the notes chosen. */
    private renderSource(parent: HTMLElement): void {
        const field = parent.createDiv({ cls: "fs-exam-field" });
        const head = field.createDiv({ cls: "fs-exam-field-head" });
        head.createDiv({ cls: "fs-label", text: t("EXAM_SOURCE") });
        const switcher = head.createDiv({
            cls: "fs-exam-segments fs-exam-source",
            attr: { role: "radiogroup", "aria-label": t("EXAM_SOURCE") },
        });
        const sources: [ExamSource, string][] = [
            ["decks", t("EXAM_DECKS")],
            ["notes", t("EXAM_NOTES")],
        ];
        for (const [value, label] of sources) {
            const button = switcher.createEl("button", {
                cls: "fs-exam-segment",
                text: label,
                attr: { type: "button", role: "radio", "data-source": value },
            });
            button.addEventListener("click", () => {
                this.source = value;
                this.refresh();
            });
            this.sourceButtons.set(value, button);
        }
        this.renderDecks(field, head);
        this.renderNotes(field);
    }

    private renderDecks(field: HTMLElement, head: HTMLElement): void {
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
        this.deckListEl = list;
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
            markFocusVisible(line, box);
            line.createSpan({ cls: "fs-exam-deck-check" });
            line.createSpan({ cls: "fs-exam-deck-line-name", text: row.name });
            line.createSpan({ cls: "fs-exam-deck-line-count", text: String(row.count) });
        }
    }

    /** The notes chosen, each with the questions it can give and a button to take it out, and "Add note". */
    private renderNotes(field: HTMLElement): void {
        this.notesBox = field.createDiv({ cls: "fs-exam-notes" });
        this.notesEl = this.notesBox.createDiv({
            cls: "fs-exam-decks-list is-notes",
            attr: { role: "list" },
        });
        this.addNoteButton = this.notesBox.createEl("button", {
            cls: "fs-exam-ghost fs-exam-add-note",
            attr: { type: "button" },
        });
        setIcon(this.addNoteButton.createSpan({ cls: "fs-exam-add-note-icon" }), "plus");
        this.addNoteButton.createSpan({ text: t("EXAM_ADD_NOTE") });
        this.addNoteButton.addEventListener("click", () => this.pickNote());
    }

    /** Draws the notes chosen again: they are few, and their counts follow the kind of cards. */
    private drawNotes(): void {
        const list = this.notesEl;
        if (list === null) return;
        list.empty();
        list.toggleClass("fs-is-hidden", this.notes.length === 0);
        const counts = this.countsFor(this.filter);
        for (const path of this.notes) {
            const name = noteName(path);
            const line = list.createDiv({ cls: "fs-exam-note-line", attr: { role: "listitem" } });
            setIcon(line.createSpan({ cls: "fs-exam-note-icon" }), "file-text");
            setTooltip(line.createSpan({ cls: "fs-exam-note-name", text: name }), path);
            const slash = path.lastIndexOf("/");
            if (slash > 0) {
                line.createSpan({ cls: "fs-exam-note-folder", text: path.slice(0, slash + 1) });
            }
            line.createSpan({ cls: "fs-exam-note-count", text: String(counts.get(path) ?? 0) });
            const remove = line.createEl("button", {
                cls: "fs-exam-icon-button fs-exam-note-remove",
                attr: { type: "button", "aria-label": t("EXAM_REMOVE_NOTE", { name }) },
            });
            setIcon(remove, "x");
            remove.addEventListener("click", () => {
                const index = this.notes.indexOf(path);
                if (index >= 0) this.notes.splice(index, 1);
                this.refresh();
                this.addNoteButton?.focus();
            });
        }
    }

    /**
     * Searches the notes for one to add: only notes that can give a question with the kind of cards chosen, and not
     * the ones chosen already.
     */
    private pickNote(): void {
        const counts = this.countsFor(this.filter);
        new NotePickerModal(
            this.app,
            (file) => {
                if (!this.notes.includes(file.path)) this.notes.push(file.path);
                this.source = "notes";
                this.refresh();
                this.addNoteButton?.focus();
            },
            (path) => !counts.has(path) || this.notes.includes(path),
            {
                placeholder: t("EXAM_PICK_NOTE"),
                detail: (file) => questionsText(counts.get(file.path) ?? 0),
            },
        ).open();
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
        markFocusVisible(chip, this.noLimitBox);
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
            markFocusVisible(segment, radio);
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
        if (this.aiUsable) this.renderAiOption(field);
    }

    /**
     * "AI checks typed answers", with All cards: what is sent and to whom, said before anything is. Only offered when
     * the AI set up for card generation can be used.
     */
    private renderAiOption(field: HTMLElement): void {
        const option = field.createDiv({ cls: "fs-exam-ai-option" });
        this.aiOption = option;
        const chip = option.createEl("label", { cls: "fs-exam-chip fs-exam-ai-chip" });
        const box = chip.createEl("input", { attr: { type: "checkbox" } });
        this.aiBox = box;
        markFocusVisible(chip, box);
        setIcon(chip.createSpan({ cls: "fs-exam-chip-tick" }), "check");
        chip.createSpan({ text: t("EXAM_AI_CHECK") });
        box.addEventListener("change", () => {
            this.aiCheck = box.checked;
            this.refresh();
        });
        const settings = aiSettingsOf(this.plugin.dataManager.data.settings);
        option.createDiv({
            cls: "fs-exam-ai-desc",
            text: t("EXAM_AI_CHECK_DESC", { provider: this.ai.provider() }),
        });
        if (aiUsesInsecureHttp(settings)) {
            option.createDiv({
                cls: "fs-exam-ai-desc is-warning",
                text: t("AI_WARN_INSECURE_URL"),
            });
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
        const fromNotes = this.source === "notes";
        for (const [value, button] of this.sourceButtons) {
            button.toggleClass("is-active", value === this.source);
            button.setAttribute("aria-checked", String(value === this.source));
        }
        for (const row of this.rows) {
            const box = this.deckBoxes.get(row.path);
            if (box === undefined) continue;
            box.checked = this.checked.has(row.path);
            box.indeterminate = !box.checked && row.below.some((path) => this.checked.has(path));
        }
        const all = this.rows.every((row) => this.checked.has(row.path));
        this.allButton?.toggleClass("is-active", all);
        this.allButton?.toggleClass("fs-is-hidden", fromNotes);
        this.deckListEl?.toggleClass("fs-is-hidden", fromNotes);
        this.notesBox?.toggleClass("fs-is-hidden", !fromNotes);

        if (this.countInput) this.countInput.value = String(this.count);
        const limited = this.minutes !== null;
        if (this.minutesInput) {
            this.minutesInput.value = String(this.minutes ?? DEFAULT_MINUTES);
            this.minutesInput.disabled = !limited;
        }
        this.minutesInput?.closest(".fs-exam-stepper")?.toggleClass("is-disabled", !limited);
        if (this.noLimitBox) {
            this.noLimitBox.checked = !limited;
            this.noLimitBox.parentElement?.toggleClass("is-checked", !limited);
        }
        for (const [value, radio] of this.filterRadios) {
            radio.checked = value === this.filter;
            radio.parentElement?.toggleClass("is-checked", radio.checked);
        }
        this.aiOption?.toggleClass("fs-is-hidden", this.filter !== "all");
        if (this.aiBox) {
            this.aiBox.checked = this.aiCheck;
            this.aiBox.parentElement?.toggleClass("is-checked", this.aiCheck);
        }
        this.drawNotes();

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
                this.statusEl.setText(this.noneText());
            } else if (available < this.count) {
                this.statusEl.setText(
                    available === 1
                        ? t("EXAM_AVAILABLE_FEWER_ONE")
                        : t("EXAM_AVAILABLE_FEWER", { count: available }),
                );
            } else {
                this.statusEl.setText(
                    available === 1
                        ? t("EXAM_AVAILABLE_ONE")
                        : t("EXAM_AVAILABLE", { count: available }),
                );
            }
        }
        if (this.startButton) this.startButton.disabled = available === 0;
    }

    /** Why there is nothing to ask. */
    private noneText(): string {
        const choiceOnly = this.filter === "choice-only";
        if (this.source === "decks") return choiceOnly ? t("EXAM_NONE_CHOICE") : t("EXAM_NONE_ALL");
        if (this.notes.length === 0) return t("EXAM_NONE_NOTES_EMPTY");
        return choiceOnly ? t("EXAM_NONE_CHOICE_NOTES") : t("EXAM_NONE_ALL_NOTES");
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
