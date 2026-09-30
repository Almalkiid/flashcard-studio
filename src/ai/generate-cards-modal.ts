import "src/ai/generate-cards.css";
import { getAllTags, Modal, Notice, requestUrl, setIcon, TFile } from "obsidian";

import { AiError, AiSettings, aiSetupProblem, requestAiText } from "src/ai/ai-provider";
import {
    buildGenerationPrompt,
    formatGeneratedCard,
    freeFlashcardsNotePath,
    GeneratedCard,
    GeneratedKind,
    insertFlashcardsSection,
    linesToOptions,
    newFlashcardsNoteText,
    optionsToLines,
    parseGeneratedCards,
    readGeneratedCard,
} from "src/ai/card-generation";
import { SettingsUtil, SRSettings } from "src/data/settings";
import { IBaseLocale } from "src/lang/base-locale";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";

const MIN_COUNT = 1;
const MAX_COUNT = 50;
const DEFAULT_COUNT = 10;
/** How long to wait for Obsidian to read a note again after cards were written to it. */
const INDEX_WAIT_MS = 4000;
const KINDS: GeneratedKind[] = ["basic", "reversed", "cloze", "choice"];
const KIND_LABEL: Record<GeneratedKind, keyof IBaseLocale> = {
    basic: "AI_KIND_BASIC",
    reversed: "AI_KIND_REVERSED",
    cloze: "AI_KIND_CLOZE",
    choice: "AI_KIND_CHOICE",
};

type Step = "form" | "loading" | "preview";
type Destination = "append" | "new";

/** One generated card in the preview, with the text the person may have edited. */
interface PreviewRow {
    kind: GeneratedKind;
    selected: boolean;
    front: string;
    back: string;
    options: string;
    explanation: string;
    hintEl: HTMLElement | null;
}

function rowCard(row: PreviewRow): GeneratedCard | null {
    return readGeneratedCard({
        kind: row.kind,
        front: row.front,
        back: row.back,
        options: linesToOptions(row.options),
        explanation: row.explanation,
    });
}

function countWords(text: string): number {
    return text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * "Generate cards with AI": asks a provider for cards from the note (or the selection), shows them for approval and
 * editing, and writes the ones the person keeps in the note's own syntax.
 *
 * The API key is read from Obsidian's secret storage when Generate is pressed and lives only in that call.
 */
export class GenerateCardsModal extends Modal {
    private readonly plugin: SRPlugin;
    private readonly file: TFile;
    private readonly sourceText: string;
    private readonly fromSelection: boolean;

    private step: Step = "form";
    private count = DEFAULT_COUNT;
    private readonly kinds = new Set<GeneratedKind>(["basic"]);
    private instructions = "";
    private destination: Destination = "append";
    private error: { message: string; settings: boolean } | null = null;
    private rows: PreviewRow[] = [];
    /** Bumped when a request is abandoned (Cancel, close), so its late reply is ignored. */
    private run = 0;
    private writing = false;

    private addButton: HTMLButtonElement | null = null;
    private selectedCountEl: HTMLElement | null = null;

    constructor(plugin: SRPlugin, file: TFile, sourceText: string, fromSelection: boolean) {
        super(plugin.app);
        this.plugin = plugin;
        this.file = file;
        this.sourceText = sourceText;
        this.fromSelection = fromSelection;
        this.modalEl.addClass("fs-ai-modal", "fs-studio");
        this.contentEl.addClass("fs-ai");
        this.setTitle(t("AI_GENERATE_CMD"));
    }

    onOpen(): void {
        this.render();
    }

    onClose(): void {
        this.run++;
        this.contentEl.empty();
    }

    private get settings(): SRSettings {
        return this.plugin.dataManager.data.settings;
    }

    private render(): void {
        this.contentEl.empty();
        // A short window scrolls the dialog; a new step, or an error at the top, starts in view
        this.modalEl.scrollTop = 0;
        this.addButton = null;
        this.selectedCountEl = null;
        if (this.step === "form") this.renderForm();
        else if (this.step === "loading") this.renderLoading();
        else this.renderPreview();
    }

    // MARK: form

    private providerLabel(): string {
        const settings = this.settings;
        if (settings.aiProvider === "anthropic") return t("AI_PROVIDER_ANTHROPIC");
        if (settings.aiProvider === "openai") return t("AI_PROVIDER_OPENAI");
        try {
            return new URL(settings.aiBaseUrl.trim()).host;
        } catch {
            return t("AI_PROVIDER_COMPATIBLE");
        }
    }

    private renderForm(): void {
        const form = this.contentEl.createDiv({ cls: "fs-ai-form" });

        // First, so nothing (the buttons that stay at the bottom on a short window) can cover it
        if (this.error !== null) this.renderError(form);

        const source = form.createDiv({ cls: "fs-ai-source fs-card" });
        const sourceText = source.createDiv({ cls: "fs-ai-source-text" });
        sourceText.createDiv({ cls: "fs-label", text: t("AI_SOURCE") });
        const line = sourceText.createDiv({ cls: "fs-ai-source-line" });
        line.createSpan({
            cls: "fs-ai-source-name",
            text: this.fromSelection ? t("AI_SOURCE_SELECTION") : t("AI_SOURCE_NOTE"),
        });
        line.createSpan({
            cls: "fs-ai-source-words",
            text: t("AI_WORDS", { count: countWords(this.sourceText) }),
        });
        const sent = source.createDiv({ cls: "fs-pill fs-ai-sent" });
        setIcon(sent.createSpan({ cls: "fs-ai-sent-icon" }), "send");
        const model = this.settings.aiModel.trim();
        sent.createSpan({
            text: `${t("AI_SENT_TO", { provider: this.providerLabel() })}${model === "" ? "" : ` · ${model}`}`,
        });

        this.renderCountField(form);
        this.renderKindsField(form);

        const instructions = form.createDiv({ cls: "fs-ai-field" });
        const instructionsId = "fs-ai-instructions";
        instructions.createEl("label", {
            cls: "fs-label",
            text: t("AI_INSTRUCTIONS"),
            attr: { for: instructionsId },
        });
        const instructionsInput = instructions.createEl("textarea", {
            cls: "fs-ai-input fs-ai-instructions",
            attr: {
                id: instructionsId,
                rows: "2",
                placeholder: t("AI_INSTRUCTIONS_PLACEHOLDER"),
            },
        });
        instructionsInput.value = this.instructions;
        instructionsInput.addEventListener("input", () => {
            this.instructions = instructionsInput.value;
        });

        this.renderDestinationField(form);

        const actions = form.createDiv({ cls: "fs-ai-actions" });
        actions
            .createEl("button", { cls: "fs-ai-ghost", text: t("AI_CANCEL") })
            .addEventListener("click", () => this.close());
        const generate = actions.createEl("button", { cls: "fs-primary-button fs-ai-generate" });
        setIcon(generate.createSpan({ cls: "fs-ai-button-icon" }), "sparkles");
        generate.createSpan({ text: t("AI_GENERATE") });
        generate.addEventListener("click", () => void this.generate());
    }

    private renderCountField(form: HTMLElement): void {
        const field = form.createDiv({ cls: "fs-ai-field" });
        const id = "fs-ai-count";
        field.createEl("label", { cls: "fs-label", text: t("AI_COUNT"), attr: { for: id } });
        const stepper = field.createDiv({ cls: "fs-ai-stepper" });
        const minus = stepper.createEl("button", {
            cls: "fs-ai-step",
            attr: { "aria-label": "−", type: "button" },
        });
        setIcon(minus, "minus");
        const input = stepper.createEl("input", {
            cls: "fs-ai-count",
            attr: {
                id,
                type: "number",
                min: String(MIN_COUNT),
                max: String(MAX_COUNT),
                inputmode: "numeric",
            },
        });
        input.value = String(this.count);
        const plus = stepper.createEl("button", {
            cls: "fs-ai-step",
            attr: { "aria-label": "+", type: "button" },
        });
        setIcon(plus, "plus");

        const set = (value: number) => {
            this.count = Math.min(
                MAX_COUNT,
                Math.max(MIN_COUNT, Math.round(value) || DEFAULT_COUNT),
            );
            input.value = String(this.count);
        };
        minus.addEventListener("click", () => set(this.count - 1));
        plus.addEventListener("click", () => set(this.count + 1));
        input.addEventListener("change", () => set(Number(input.value)));
    }

    private renderKindsField(form: HTMLElement): void {
        const field = form.createDiv({ cls: "fs-ai-field" });
        field.createDiv({ cls: "fs-label", text: t("AI_KINDS") });
        const chips = field.createDiv({ cls: "fs-ai-chips", attr: { role: "group" } });
        for (const kind of KINDS) {
            const chip = chips.createEl("label", { cls: `fs-ai-chip is-${kind}` });
            const box = chip.createEl("input", { attr: { type: "checkbox", "data-kind": kind } });
            box.checked = this.kinds.has(kind);
            setIcon(chip.createSpan({ cls: "fs-ai-chip-tick" }), "check");
            chip.createSpan({ cls: "fs-ai-chip-text", text: t(KIND_LABEL[kind]) });
            box.addEventListener("change", () => {
                if (box.checked) {
                    this.kinds.add(kind);
                } else if (this.kinds.size > 1) {
                    this.kinds.delete(kind);
                } else {
                    // At least one kind has to stay on
                    box.checked = true;
                }
            });
        }
    }

    private renderDestinationField(form: HTMLElement): void {
        const field = form.createDiv({ cls: "fs-ai-field" });
        field.createDiv({ cls: "fs-label", text: t("AI_DESTINATION") });
        const group = field.createDiv({ cls: "fs-ai-segments", attr: { role: "radiogroup" } });
        const options: [Destination, keyof IBaseLocale, keyof IBaseLocale][] = [
            ["append", "AI_DEST_APPEND", "AI_DEST_APPEND_DESC"],
            ["new", "AI_DEST_NEW", "AI_DEST_NEW_DESC"],
        ];
        for (const [value, title, description] of options) {
            const segment = group.createEl("label", { cls: "fs-ai-segment" });
            const radio = segment.createEl("input", {
                attr: { type: "radio", name: "fs-ai-destination", value },
            });
            radio.checked = this.destination === value;
            const text = segment.createDiv({ cls: "fs-ai-segment-text" });
            text.createSpan({ cls: "fs-ai-segment-title", text: t(title) });
            text.createSpan({ cls: "fs-ai-segment-desc", text: t(description) });
            radio.addEventListener("change", () => {
                if (radio.checked) this.destination = value;
            });
        }
    }

    private renderError(parent: HTMLElement): void {
        const error = this.error;
        if (error === null) return;
        const box = parent.createDiv({ cls: "fs-ai-error", attr: { role: "alert" } });
        setIcon(box.createSpan({ cls: "fs-ai-error-icon" }), "triangle-alert");
        const body = box.createDiv({ cls: "fs-ai-error-body" });
        body.createDiv({ cls: "fs-ai-error-text", text: error.message });
        if (error.settings) {
            body.createEl("button", {
                cls: "fs-ai-error-button",
                text: t("AI_OPEN_SETTINGS"),
            }).addEventListener("click", () => this.openSettings());
        }
    }

    private openSettings(): void {
        const app = this.app as unknown as {
            setting?: { open: () => void; openTabById: (id: string) => void };
        };
        this.close();
        app.setting?.open();
        app.setting?.openTabById(this.plugin.manifest.id);
    }

    // MARK: generating

    /** The API key, or "" when none is set. It is never kept in a field, a log or a message. */
    private readKey(): string {
        const id = this.settings.aiKeySecret;
        if (id === "") return "";
        try {
            return this.app.secretStorage.getSecret(id) ?? "";
        } catch {
            return "";
        }
    }

    private aiSettings(): AiSettings {
        const { aiProvider, aiModel, aiBaseUrl } = this.settings;
        return { provider: aiProvider, model: aiModel, baseUrl: aiBaseUrl };
    }

    private async generate(): Promise<void> {
        const ai = this.aiSettings();
        const key = this.readKey();

        const problem = aiSetupProblem(ai, key);
        if (problem !== null) {
            const message = {
                "no-key": "AI_ERR_NO_KEY",
                "no-model": "AI_ERR_NO_MODEL",
                "no-base-url": "AI_ERR_NO_BASE_URL",
            } as const;
            this.error = { message: t(message[problem]), settings: true };
            this.render();
            return;
        }
        if (countWords(this.sourceText) === 0) {
            this.error = { message: t("AI_ERR_EMPTY_SOURCE"), settings: false };
            this.render();
            return;
        }

        const prompt = buildGenerationPrompt({
            count: this.count,
            kinds: KINDS.filter((kind) => this.kinds.has(kind)),
            instructions: this.instructions,
            sourceText: this.sourceText,
            noteTitle: this.file.basename,
        });

        this.error = null;
        this.step = "loading";
        this.render();
        const run = ++this.run;

        try {
            const text = await requestAiText(ai, key, prompt, (request) => requestUrl(request));
            const cards = parseGeneratedCards(text);
            if (run !== this.run) return;
            this.rows = cards.map((card) => ({
                kind: card.kind,
                selected: true,
                front: card.front,
                back: card.back,
                options: optionsToLines(card.options ?? []),
                explanation: card.explanation ?? "",
                hintEl: null as HTMLElement | null,
            }));
            this.step = "preview";
        } catch (error) {
            if (run !== this.run) return;
            this.error = {
                message: error instanceof AiError ? error.message : t("AI_ERR_SHAPE"),
                settings:
                    error instanceof AiError && (error.kind === "no-key" || error.kind === "auth"),
            };
            this.step = "form";
        }
        this.render();
    }

    private renderLoading(): void {
        const box = this.contentEl.createDiv({ cls: "fs-ai-loading", attr: { role: "status" } });
        box.createDiv({ cls: "fs-ai-spinner", attr: { "aria-hidden": "true" } });
        box.createDiv({ cls: "fs-ai-loading-title", text: t("AI_GENERATING") });
        box.createDiv({ cls: "fs-ai-loading-desc", text: t("AI_GENERATING_DESC") });
        box.createEl("button", { cls: "fs-ai-ghost", text: t("AI_CANCEL") }).addEventListener(
            "click",
            () => {
                this.run++;
                this.step = "form";
                this.render();
            },
        );
    }

    // MARK: preview

    private renderPreview(): void {
        const preview = this.contentEl.createDiv({ cls: "fs-ai-preview" });
        if (this.error !== null) this.renderError(preview);

        const head = preview.createDiv({ cls: "fs-ai-preview-head" });
        const titles = head.createDiv();
        titles.createDiv({ cls: "fs-ai-preview-title", text: t("AI_PREVIEW_TITLE") });
        titles.createDiv({ cls: "fs-ai-preview-hint", text: t("AI_PREVIEW_HINT") });
        this.selectedCountEl = head.createDiv({ cls: "fs-pill fs-ai-selected" });

        const list = preview.createDiv({ cls: "fs-ai-list" });
        for (const row of this.rows) this.renderRow(list, row);

        const actions = preview.createDiv({ cls: "fs-ai-actions" });
        actions
            .createEl("button", { cls: "fs-ai-ghost", text: t("AI_BACK") })
            .addEventListener("click", () => {
                this.error = null;
                this.step = "form";
                this.render();
            });
        this.addButton = actions.createEl("button", { cls: "fs-primary-button fs-ai-add" });
        this.addButton.addEventListener("click", () => void this.addCards());
        this.refreshFooter();
    }

    private renderRow(list: HTMLElement, row: PreviewRow): void {
        const el = list.createEl("article", { cls: `fs-ai-row fs-card is-${row.kind}` });

        const head = el.createDiv({ cls: "fs-ai-row-head" });
        const check = head.createEl("label", { cls: "fs-ai-check" });
        const box = check.createEl("input", { attr: { type: "checkbox" } });
        box.checked = row.selected;
        setIcon(check.createSpan({ cls: "fs-ai-check-box" }), "check");
        head.createSpan({
            cls: `fs-ai-kind is-${row.kind}`,
            text: t(KIND_LABEL[row.kind]),
        });

        const fields: [
            keyof Pick<PreviewRow, "front" | "back" | "options" | "explanation">,
            keyof IBaseLocale,
        ][] =
            row.kind === "cloze"
                ? [["front", "AI_FIELD_CLOZE"]]
                : row.kind === "choice"
                  ? [
                        ["front", "AI_FIELD_QUESTION"],
                        ["options", "AI_FIELD_OPTIONS"],
                        ["explanation", "AI_FIELD_EXPLANATION"],
                    ]
                  : [
                        ["front", "AI_FIELD_FRONT"],
                        ["back", "AI_FIELD_BACK"],
                    ];
        for (const [field, label] of fields) {
            const wrap = el.createEl("label", { cls: "fs-ai-edit" });
            wrap.createSpan({ cls: "fs-ai-edit-label", text: t(label) });
            const area = wrap.createEl("textarea", {
                cls: `fs-ai-input fs-ai-edit-${field}`,
                attr: { rows: String(Math.min(6, Math.max(1, row[field].split("\n").length))) },
            });
            area.value = row[field];
            area.addEventListener("input", () => {
                row[field] = area.value;
                this.refreshRow(el, row);
                this.refreshFooter();
            });
        }

        row.hintEl = el.createDiv({ cls: "fs-ai-row-hint", text: t("AI_CARD_INVALID") });
        box.addEventListener("change", () => {
            row.selected = box.checked;
            this.refreshRow(el, row);
            this.refreshFooter();
        });
        this.refreshRow(el, row);
    }

    private refreshRow(el: HTMLElement, row: PreviewRow): void {
        const invalid = rowCard(row) === null;
        el.toggleClass("is-off", !row.selected);
        el.toggleClass("is-invalid", invalid);
        row.hintEl?.toggleClass("is-visible", invalid);
    }

    private readyCards(): GeneratedCard[] {
        const cards: GeneratedCard[] = [];
        for (const row of this.rows) {
            const card = row.selected ? rowCard(row) : null;
            if (card !== null) cards.push(card);
        }
        return cards;
    }

    private refreshFooter(): void {
        const ready = this.readyCards().length;
        this.selectedCountEl?.setText(
            t("AI_SELECTED_COUNT", {
                selected: this.rows.filter((row) => row.selected).length,
                total: this.rows.length,
            }),
        );
        const button = this.addButton;
        if (button === null) return;
        button.setText(
            ready === 0
                ? t("AI_ADD_NONE")
                : ready === 1
                  ? t("AI_ADD_ONE_CARD")
                  : t("AI_ADD_CARDS", { count: ready }),
        );
        button.disabled = ready === 0 || this.writing;
    }

    // MARK: writing

    private hasFlashcardTag(): boolean {
        const cache = this.app.metadataCache.getFileCache(this.file);
        const tags = cache === null ? [] : (getAllTags(cache) ?? []);
        return tags.some((tag) => SettingsUtil.isFlashcardTag(this.settings, tag));
    }

    /**
     * The tag that makes the cards findable: the first flashcard tag, for a note that has none, unless folders are
     * decks (then the folder already is the deck).
     */
    private tagToAdd(): string | null {
        const settings = this.settings;
        if (settings.convertFoldersToDecks) return null;
        const tag = settings.flashcardTags.find((candidate) => candidate.startsWith("#")) ?? null;
        if (tag === null) return null;
        if (this.destination === "append" && this.hasFlashcardTag()) return null;
        return tag;
    }

    private async addCards(): Promise<void> {
        const cards = this.readyCards();
        if (cards.length === 0 || this.writing) return;
        this.writing = true;
        this.refreshFooter();

        const settings = this.settings;
        const body = cards.map((card) => formatGeneratedCard(card, settings)).join("\n\n");
        const tag = this.tagToAdd();
        let watch: { indexed: Promise<void>; cancel: () => void } | null = null;
        try {
            if (this.destination === "append") {
                watch = this.watchIndex(this.file.path, body);
                await this.app.vault.process(this.file, (data) =>
                    insertFlashcardsSection(data, body, tag),
                );
            } else {
                const parent = this.file.parent;
                const folder = parent === null || parent.path === "/" ? "" : parent.path;
                const path = freeFlashcardsNotePath(
                    folder,
                    this.file.basename,
                    (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null,
                );
                watch = this.watchIndex(path, body);
                await this.app.vault.create(path, newFlashcardsNoteText(body, tag));
            }
        } catch {
            watch?.cancel();
            this.writing = false;
            this.error = { message: t("AI_ERR_WRITE"), settings: false };
            this.render();
            return;
        }

        new Notice(cards.length === 1 ? t("AI_ADDED_ONE") : t("AI_ADDED", { count: cards.length }));
        this.close();
        // The plugin finds cards through Obsidian's metadata cache: read the vault only once the cache has the note,
        // with its new tag, or the new cards would be missed until the next sync.
        await watch.indexed;
        if (this.plugin.isInitialized) await this.plugin.dataManager.sync();
    }

    /**
     * Resolves when Obsidian has read the note at `path` again with the new cards in it, or after a few seconds.
     * Started before the write, so the event cannot be missed.
     */
    private watchIndex(
        path: string,
        cardsText: string,
    ): { indexed: Promise<void>; cancel: () => void } {
        let finish: () => void = () => undefined;
        const indexed = new Promise<void>((resolve) => {
            const metadataCache = this.app.metadataCache;
            const ref = metadataCache.on("changed", (changed, data) => {
                if (changed.path === path && data.includes(cardsText)) finish();
            });
            const timer = window.setTimeout(() => finish(), INDEX_WAIT_MS);
            finish = () => {
                window.clearTimeout(timer);
                metadataCache.offref(ref);
                resolve();
            };
        });
        return { indexed, cancel: () => finish() };
    }
}
