import "src/import-export/ui/anki-modals.css";
import {
    ButtonComponent,
    DropdownComponent,
    htmlToMarkdown,
    Modal,
    Notice,
    Setting,
} from "obsidian";

import { ensureCurlyClozePattern } from "src/import-export/anki-cloze";
import {
    importNotes,
    ImportOptions,
    ImportPhase,
    MediaSource,
    NO_MEDIA,
} from "src/import-export/anki-importer";
import { openAnkiPackage } from "src/import-export/anki-package-reader";
import { AnkiImportError, AnkiNote } from "src/import-export/anki-types";
import { BasicStyle } from "src/import-export/card-builder";
import { summariseImport } from "src/import-export/format-result";
import { IMPORTABLE_EXTENSIONS, ObsidianVaultHost } from "src/import-export/obsidian-vault-host";
import { loadSql } from "src/import-export/sql-loader";
import { parseTextFile, textFileToNotes } from "src/import-export/text-file-parser";
import { showResultView } from "src/import-export/ui/result-view";
import { IBaseLocale } from "src/lang/base-locale";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";

const DEFAULT_TARGET_FOLDER = "Flashcards/Imported";

const PHASE_MESSAGES: Record<ImportPhase, keyof IBaseLocale> = {
    scanning: "ANKI_IMPORT_PHASE_SCANNING",
    media: "ANKI_IMPORT_PHASE_MEDIA",
    converting: "ANKI_IMPORT_PHASE_CONVERTING",
    writing: "ANKI_IMPORT_PHASE_WRITING",
};

function extensionOf(name: string): string {
    return name.split(".").pop()?.toLowerCase() ?? "";
}

function baseNameOf(name: string): string {
    const file = name.split("/").pop() ?? name;
    const dot = file.lastIndexOf(".");
    return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * The dialog of the "Import Anki deck" command: choose an Anki package or a text file, where the cards go and how
 * to write them, and watch the import.
 */
export class AnkiImportModal extends Modal {
    private readonly host: ObsidianVaultHost;
    private chosenFile: File | null = null;
    private vaultFile = "";
    private targetFolder = DEFAULT_TARGET_FOLDER;
    private basicStyle: BasicStyle = "multi";
    private keepTags = true;
    private running = false;
    private closed = false;

    private fileInput: HTMLInputElement | null = null;
    private fileNameEl: HTMLElement | null = null;
    private vaultDropdown: DropdownComponent | null = null;
    private importButton: ButtonComponent | null = null;
    private statusEl: HTMLElement | null = null;

    constructor(private readonly plugin: SRPlugin) {
        super(plugin.app);
        this.host = new ObsidianVaultHost(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass("sr-anki-modal");
        this.setTitle(t("ANKI_IMPORT_TITLE"));
        contentEl.createEl("p", { text: t("ANKI_IMPORT_DESC"), cls: "sr-anki-intro" });

        const fileSetting = new Setting(contentEl)
            .setName(t("ANKI_IMPORT_FILE"))
            .setDesc(t("ANKI_IMPORT_FILE_DESC"));
        this.fileNameEl = fileSetting.descEl.createSpan({
            cls: "sr-anki-file-name",
            text: t("ANKI_IMPORT_NO_FILE"),
        });
        const accept = IMPORTABLE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
        const input = fileSetting.controlEl.createEl("input", {
            type: "file",
            cls: "sr-anki-hidden-input",
            attr: { accept },
        });
        input.addEventListener("change", () => this.onFileChosen(input.files?.[0] ?? null));
        this.fileInput = input;
        fileSetting.addButton((button) =>
            button.setButtonText(t("ANKI_IMPORT_CHOOSE_FILE")).onClick(() => input.click()),
        );

        new Setting(contentEl)
            .setName(t("ANKI_IMPORT_VAULT_FILE"))
            .setDesc(t("ANKI_IMPORT_VAULT_FILE_DESC"))
            .addDropdown((dropdown) => {
                this.vaultDropdown = dropdown;
                dropdown.addOption("", t("ANKI_IMPORT_VAULT_FILE_NONE"));
                dropdown.onChange((value) => this.onVaultFileChosen(value));
            });
        void this.fillVaultFiles();

        new Setting(contentEl)
            .setName(t("ANKI_IMPORT_TARGET_FOLDER"))
            .setDesc(t("ANKI_IMPORT_TARGET_FOLDER_DESC"))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_TARGET_FOLDER)
                    .setValue(this.targetFolder)
                    .onChange((value) => (this.targetFolder = value.trim())),
            );

        new Setting(contentEl)
            .setName(t("ANKI_IMPORT_BASIC_STYLE"))
            .setDesc(t("ANKI_IMPORT_BASIC_STYLE_DESC"))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("multi", t("ANKI_IMPORT_STYLE_MULTI"))
                    .addOption("single", t("ANKI_IMPORT_STYLE_SINGLE"))
                    .setValue(this.basicStyle)
                    .onChange((value) => (this.basicStyle = value as BasicStyle)),
            );

        new Setting(contentEl)
            .setName(t("ANKI_IMPORT_KEEP_TAGS"))
            .setDesc(t("ANKI_IMPORT_KEEP_TAGS_DESC"))
            .addToggle((toggle) =>
                toggle.setValue(this.keepTags).onChange((value) => (this.keepTags = value)),
            );

        this.statusEl = contentEl.createDiv({
            cls: "sr-anki-status",
            attr: { "aria-live": "polite" },
        });

        const buttons = contentEl.createDiv({ cls: "sr-anki-buttons" });
        new ButtonComponent(buttons).setButtonText(t("CANCEL")).onClick(() => this.close());
        this.importButton = new ButtonComponent(buttons)
            .setButtonText(t("ANKI_IMPORT_BUTTON"))
            .setCta()
            .setDisabled(true)
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

    private async fillVaultFiles(): Promise<void> {
        const files = await this.host.findImportableFiles();
        // The dialog may have been closed while the vault was being read
        if (this.vaultDropdown === null || !this.modalEl.isConnected) return;
        for (const file of files) this.vaultDropdown.addOption(file, file);
    }

    private onFileChosen(file: File | null): void {
        this.chosenFile = file;
        if (file !== null) {
            this.vaultFile = "";
            this.vaultDropdown?.setValue("");
        }
        this.fileNameEl?.setText(file?.name ?? t("ANKI_IMPORT_NO_FILE"));
        this.refreshButton();
    }

    private onVaultFileChosen(path: string): void {
        this.vaultFile = path;
        if (path !== "") {
            this.chosenFile = null;
            if (this.fileInput !== null) this.fileInput.value = "";
            this.fileNameEl?.setText(t("ANKI_IMPORT_NO_FILE"));
        }
        this.refreshButton();
    }

    private refreshButton(): void {
        this.importButton?.setDisabled(
            this.running || (this.chosenFile === null && this.vaultFile === ""),
        );
    }

    private showStatus(message: string, isError = false): void {
        if (this.statusEl === null) return;
        this.statusEl.setText(message);
        this.statusEl.toggleClass("sr-anki-error", isError);
    }

    private progressText(phase: ImportPhase, done: number, total: number): string {
        return t(PHASE_MESSAGES[phase], { done, total });
    }

    /** The bytes and name of the file to import, from the device or from the vault. */
    private async readChosenFile(): Promise<{ bytes: Uint8Array; name: string }> {
        if (this.chosenFile !== null) {
            return {
                bytes: new Uint8Array(await this.chosenFile.arrayBuffer()),
                name: this.chosenFile.name,
            };
        }
        if (this.vaultFile !== "") {
            return { bytes: await this.host.readBinary(this.vaultFile), name: this.vaultFile };
        }
        throw new AnkiImportError(t("ANKI_IMPORT_ERR_NO_FILE"), "empty");
    }

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.refreshButton();
        try {
            const { bytes, name } = await this.readChosenFile();
            this.showStatus(t("ANKI_IMPORT_PHASE_READING"));
            // Lets the message show before the work that blocks the screen for a moment
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

            let notes: AnkiNote[];
            let media: MediaSource = NO_MEDIA;
            let plainText = false;
            if (["apkg", "colpkg"].includes(extensionOf(name))) {
                const pack = await openAnkiPackage(bytes, await loadSql());
                notes = pack.notes;
                media = pack;
            } else {
                const file = parseTextFile(new TextDecoder().decode(bytes));
                notes = textFileToNotes(file, baseNameOf(name));
                plainText = !file.html;
            }
            if (notes.length === 0) throw new AnkiImportError(t("ANKI_IMPORT_ERR_EMPTY"), "empty");

            const settingsManager = this.plugin.dataManager.settingsManager;
            const settings = settingsManager.settings;
            const options: ImportOptions = {
                targetFolder: this.targetFolder || DEFAULT_TARGET_FOLDER,
                basicStyle: this.basicStyle,
                keepTags: this.keepTags,
                plainText,
            };
            const result = await importNotes(notes, media, options, {
                host: this.host,
                htmlToMarkdown,
                flashcardTag: settings.flashcardTags[0] ?? "#flashcards",
                separators: {
                    singleLine: settings.singleLineCardSeparator,
                    singleLineReversed: settings.singleLineReversedCardSeparator,
                    multiLine: settings.multilineCardSeparator,
                    multiLineReversed: settings.multilineReversedCardSeparator,
                },
                onProgress: (phase, done, total) =>
                    this.showStatus(this.progressText(phase, done, total)),
            });

            const clozePatternAdded = result.hasClozes && ensureCurlyClozePattern(settings);
            if (clozePatternAdded) await settingsManager.save();

            // The decks come from tags, which Obsidian reads a moment after a note is created
            await this.host.waitForIndexing(result.notePaths);
            if (this.plugin.isInitialized) await this.plugin.dataManager.sync();

            const summary = summariseImport(result, options.targetFolder, clozePatternAdded);
            this.tell([summary.headline, ...summary.details.slice(0, 1)].join(" "));
            showResultView(this, summary);
        } catch (error) {
            const message =
                error instanceof AnkiImportError
                    ? error.message
                    : t("ANKI_IMPORT_ERR_FAILED", {
                          detail: error instanceof Error ? error.message : JSON.stringify(error),
                      });
            this.showStatus(message, true);
            this.tell(message);
        } finally {
            this.running = false;
            this.refreshButton();
        }
    }
}
