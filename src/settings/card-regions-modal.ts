import "src/settings/settings.css";
import { App, ButtonComponent, Modal, Setting } from "obsidian";

/** Edits the start and end marker of card regions. Any pair works, the same marker twice included, and empty means off. */
export class CardRegionsModal extends Modal {
    private saving = false;
    private saveButton: ButtonComponent | null = null;
    private errorEl: HTMLElement | null = null;

    constructor(
        app: App,
        private start: string,
        private end: string,
        private readonly onSave: (start: string, end: string) => Promise<void>,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle("Card regions");
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("p", {
            text: "Cards outside the markers stop being found, and their schedules stay in the note until you add the markers around them.",
        });
        const startInput = this.addField(
            "Start marker",
            "+++",
            this.start,
            (value) => (this.start = value),
        );
        this.addField("End marker", "---", this.end, (value) => (this.end = value));
        this.errorEl = contentEl.createDiv({ cls: "fs-text-prompt-error" });

        new Setting(contentEl)
            .addButton((button) => {
                this.saveButton = button;
                button
                    .setButtonText("Save")
                    .setCta()
                    .onClick(() => void this.submit());
            })
            .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
        startInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private addField(
        label: string,
        placeholder: string,
        value: string,
        onChange: (value: string) => void,
    ): HTMLInputElement {
        let input: HTMLInputElement;
        new Setting(this.contentEl).setName(label).addText((text) => {
            input = text.inputEl;
            text.setPlaceholder(placeholder).setValue(value).onChange(onChange);
            text.inputEl.addEventListener("keydown", (event) => {
                // Enter that confirms an input-method composition belongs to the input method.
                if (event.isComposing) return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    void this.submit();
                }
            });
        });
        return input;
    }

    private async submit(): Promise<void> {
        if (this.saving) return;
        this.saving = true;
        this.errorEl?.setText("");
        this.saveButton?.setDisabled(true);
        try {
            await this.onSave(this.start.trim(), this.end.trim());
            this.close();
        } catch (error) {
            this.errorEl?.setText(error instanceof Error ? error.message : String(error));
        } finally {
            this.saving = false;
            this.saveButton?.setDisabled(false);
        }
    }
}
