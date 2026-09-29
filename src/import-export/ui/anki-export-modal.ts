import "src/import-export/ui/anki-modals.css";
import { ButtonComponent, Modal, Notice, Setting } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import { buildApkg, buildTextExport, ExportSummary } from "src/import-export/anki-exporter";
import { sanitizeFileName } from "src/import-export/deck-note";
import { ankiDeckName, collectExportNotes } from "src/import-export/export-collector";
import { summariseExport } from "src/import-export/format-result";
import { ObsidianVaultHost } from "src/import-export/obsidian-vault-host";
import { loadSql } from "src/import-export/sql-loader";
import { showResultView } from "src/import-export/ui/result-view";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { moment } from "src/utils/dates";

const EXPORT_FOLDER = "Flashcards/Exports";

type ExportFormat = "apkg" | "txt";

interface DeckChoice {
    label: string;
    deck: Deck;
}

/** The decks that have cards, with the names Anki would show. */
function deckChoices(root: Deck, flashcardTags: string[]): DeckChoice[] {
    return root
        .toDeckArray()
        .filter(
            (deck) =>
                !deck.isRootDeck && deck.getDistinctRepItemCount(RepItemState.AnyItem, true) > 0,
        )
        .map((deck) => ({
            label: `${ankiDeckName(deck.getTopicPath().path, flashcardTags).split("::").join(" / ")} (${deck.getDistinctRepItemCount(RepItemState.AnyItem, true)})`,
            deck,
        }));
}

/**
 * The dialog of the "Export cards to Anki" command: choose the decks and the file format, and where to save the file
 * in the vault.
 */
export class AnkiExportModal extends Modal {
    private readonly host: ObsidianVaultHost;
    private choices: DeckChoice[] = [];
    /** Index into `choices`, or -1 for all decks. */
    private deckIndex = -1;
    private format: ExportFormat = "apkg";
    private filePath = "";
    private pathEdited = false;
    private running = false;
    private closed = false;

    private pathInput: HTMLInputElement | null = null;
    private exportButton: ButtonComponent | null = null;
    private statusEl: HTMLElement | null = null;

    constructor(private readonly plugin: SRPlugin) {
        super(plugin.app);
        this.host = new ObsidianVaultHost(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        const settings = this.plugin.dataManager.settingsManager.settings;
        this.choices = deckChoices(
            this.plugin.dataManager.osrCore.reviewableDeckTree,
            settings.flashcardTags,
        );
        this.filePath = this.defaultPath();

        this.modalEl.addClass("sr-anki-modal");
        this.setTitle(t("ANKI_EXPORT_TITLE"));
        contentEl.createEl("p", { text: t("ANKI_EXPORT_DESC"), cls: "sr-anki-intro" });

        new Setting(contentEl).setName(t("ANKI_EXPORT_SCOPE")).addDropdown((dropdown) => {
            dropdown.addOption("-1", t("ANKI_EXPORT_SCOPE_ALL"));
            this.choices.forEach((choice, index) => {
                dropdown.addOption(String(index), choice.label);
            });
            dropdown.setValue(String(this.deckIndex)).onChange((value) => {
                this.deckIndex = Number(value);
                this.updateDefaultPath();
            });
        });

        new Setting(contentEl).setName(t("ANKI_EXPORT_FORMAT")).addDropdown((dropdown) =>
            dropdown
                .addOption("apkg", t("ANKI_EXPORT_FORMAT_APKG"))
                .addOption("txt", t("ANKI_EXPORT_FORMAT_TXT"))
                .setValue(this.format)
                .onChange((value) => {
                    this.format = value as ExportFormat;
                    this.updateDefaultPath();
                }),
        );

        new Setting(contentEl)
            .setName(t("ANKI_EXPORT_FILE_PATH"))
            .setDesc(t("ANKI_EXPORT_FILE_PATH_DESC"))
            .addText((text) => {
                this.pathInput = text.inputEl;
                text.setValue(this.filePath).onChange((value) => {
                    this.filePath = value.trim();
                    this.pathEdited = true;
                });
            });

        this.statusEl = contentEl.createDiv({
            cls: "sr-anki-status",
            attr: { "aria-live": "polite" },
        });

        const buttons = contentEl.createDiv({ cls: "sr-anki-buttons" });
        new ButtonComponent(buttons).setButtonText(t("CANCEL")).onClick(() => this.close());
        this.exportButton = new ButtonComponent(buttons)
            .setButtonText(t("ANKI_EXPORT_BUTTON"))
            .setCta()
            .onClick(() => void this.run());
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
    }

    /**
     * The dialog shows what happened. A message on top of it would cover its buttons, so a notice is only for the
     * user who closed the dialog while the work went on.
     */
    private tell(message: string): void {
        if (this.closed) new Notice(message, 10000);
    }

    /** `Flashcards/Exports/<decks>-<date>.<extension>` */
    private defaultPath(): string {
        const name =
            this.deckIndex === -1
                ? t("ANKI_EXPORT_SCOPE_ALL")
                : this.choices[this.deckIndex].deck.deckName;
        return `${EXPORT_FOLDER}/${sanitizeFileName(name)}-${moment().format("YYYY-MM-DD")}.${this.format}`;
    }

    private updateDefaultPath(): void {
        if (this.pathEdited) {
            // Only the extension follows the format once the user has chosen a name
            this.filePath = this.filePath.replace(/\.(apkg|txt)$/i, `.${this.format}`);
        } else {
            this.filePath = this.defaultPath();
        }
        if (this.pathInput !== null) this.pathInput.value = this.filePath;
    }

    private showStatus(message: string, isError = false): void {
        if (this.statusEl === null) return;
        this.statusEl.setText(message);
        this.statusEl.toggleClass("sr-anki-error", isError);
    }

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.exportButton?.setDisabled(true);
        try {
            this.showStatus(t("ANKI_EXPORT_RUNNING"));
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

            const settings = this.plugin.dataManager.settingsManager.settings;
            const root =
                this.deckIndex === -1
                    ? this.plugin.dataManager.osrCore.reviewableDeckTree
                    : this.choices[this.deckIndex].deck;
            const { notes, skipped } = await collectExportNotes(root, settings);
            if (notes.length === 0) {
                this.showStatus(t("ANKI_EXPORT_NOTHING"), true);
                return;
            }

            const wanted = this.filePath || this.defaultPath();
            const withExtension = wanted.toLowerCase().endsWith(`.${this.format}`)
                ? wanted
                : `${wanted}.${this.format}`;
            const path = await this.host.freePath(withExtension);
            await this.host.ensureFolder(
                path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
            );

            let summary: ExportSummary;
            if (this.format === "apkg") {
                const built = await buildApkg(notes, this.host, await loadSql());
                await this.host.createBinary(path, built.bytes);
                summary = built.summary;
            } else {
                const built = buildTextExport(notes, this.host);
                await this.host.createText(path, built.text);
                summary = built.summary;
            }

            const result = summariseExport(summary, skipped, path);
            this.tell([result.headline, ...result.details.slice(0, 1)].join(" "));
            showResultView(this, result);
        } catch (error) {
            const message = t("ANKI_EXPORT_ERR_FAILED", {
                detail: error instanceof Error ? error.message : JSON.stringify(error),
            });
            this.showStatus(message, true);
            this.tell(message);
        } finally {
            this.running = false;
            this.exportButton?.setDisabled(false);
        }
    }
}
