import "src/settings/settings.css";
import { App, ButtonComponent, Modal, Setting } from "obsidian";

export interface TextPromptOptions {
    title: string;
    placeholder: string;
    /** The reason the text can't be used yet, or undefined when it can. */
    check: (value: string) => string | undefined;
    onSubmit: (value: string) => Promise<void>;
}

/** Asks for one line of text, shows why it can't be used yet, and only lets Add through once `check` is happy. */
export class TextPromptModal extends Modal {
    private value = "";
    private submitting = false;
    private addButton: ButtonComponent | null = null;
    private errorEl: HTMLElement | null = null;

    constructor(
        app: App,
        private readonly options: TextPromptOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(this.options.title);
        const { contentEl } = this;
        contentEl.empty();

        const input = contentEl.createEl("input", {
            cls: "fs-text-prompt-input",
            type: "text",
            placeholder: this.options.placeholder,
        });
        this.errorEl = contentEl.createDiv({ cls: "fs-text-prompt-error" });

        input.addEventListener("input", () => {
            this.value = input.value;
            this.errorEl?.setText(this.options.check(this.value) ?? "");
            this.refreshAdd();
        });
        input.addEventListener("keydown", (event) => {
            // Enter that confirms an input-method composition belongs to the input method.
            if (event.isComposing) return;
            if (event.key === "Enter") {
                event.preventDefault();
                void this.submit();
            }
        });

        new Setting(contentEl)
            .addButton((button) => {
                this.addButton = button;
                button
                    .setButtonText("Add")
                    .setCta()
                    .onClick(() => void this.submit());
            })
            .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
        this.refreshAdd();
        input.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshAdd(): void {
        this.addButton?.setDisabled(
            this.submitting || this.options.check(this.value) !== undefined,
        );
    }

    private async submit(): Promise<void> {
        if (this.submitting || this.options.check(this.value) !== undefined) return;
        this.submitting = true;
        this.refreshAdd();
        try {
            await this.options.onSubmit(this.value);
            this.close();
        } catch (error) {
            this.errorEl?.setText(error instanceof Error ? error.message : String(error));
        } finally {
            this.submitting = false;
            this.refreshAdd();
        }
    }
}
