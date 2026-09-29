import "src/ui/obsidian-ui-components/modals/welcome-modal.css";
import { App, ButtonComponent, Modal, setIcon } from "obsidian";

import { t } from "src/lang/helpers";

export interface WelcomeActions {
    createSampleDeck: () => Promise<void>;
    startReviewing: () => Promise<void>;
    importSpacedRepetitionSettings: (() => Promise<void>) | null;
}

/**
 * First-run guide: how to write cards, how reviewing works, and where the data lives.
 */
export class WelcomeModal extends Modal {
    private readonly actions: WelcomeActions;

    constructor(app: App, actions: WelcomeActions) {
        super(app);
        this.actions = actions;
    }

    onOpen(): void {
        this.modalEl.addClass("sr-welcome-modal");
        this.setTitle(t("WELCOME_TITLE"));

        const content = this.contentEl;
        content.createEl("p", { cls: "sr-welcome-lead", text: t("WELCOME_LEAD") });

        const steps = content.createDiv({ cls: "sr-welcome-steps" });
        this.addStep(steps, "pencil-line", t("WELCOME_WRITE_TITLE"), t("WELCOME_WRITE_DESC"));
        this.addStep(steps, "repeat", t("WELCOME_REVIEW_TITLE"), t("WELCOME_REVIEW_DESC"));
        this.addStep(steps, "history", t("WELCOME_HISTORY_TITLE"), t("WELCOME_HISTORY_DESC"));

        const example = content.createEl("pre", { cls: "sr-welcome-example" });
        example.createEl("code", { text: t("WELCOME_EXAMPLE") });

        const importAction = this.actions.importSpacedRepetitionSettings;
        if (importAction !== null) {
            const migrate = content.createDiv({ cls: "sr-welcome-migrate callout" });
            migrate.createDiv({ cls: "sr-welcome-migrate-text", text: t("WELCOME_MIGRATE") });
            new ButtonComponent(migrate)
                .setButtonText(t("IMPORT_SR_SETTINGS"))
                .onClick(async () => {
                    await importAction();
                });
        }

        const buttons = content.createDiv({ cls: "sr-welcome-buttons" });
        new ButtonComponent(buttons)
            .setButtonText(t("WELCOME_CREATE_SAMPLE"))
            .setCta()
            .onClick(async () => {
                this.close();
                await this.actions.createSampleDeck();
            });
        new ButtonComponent(buttons)
            .setButtonText(t("WELCOME_START_REVIEWING"))
            .onClick(async () => {
                this.close();
                await this.actions.startReviewing();
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private addStep(parent: HTMLElement, icon: string, title: string, description: string): void {
        const step = parent.createDiv({ cls: "sr-welcome-step" });
        setIcon(step.createDiv({ cls: "sr-welcome-step-icon" }), icon);
        const text = step.createDiv({ cls: "sr-welcome-step-text" });
        text.createDiv({ cls: "sr-welcome-step-title", text: title });
        text.createDiv({ cls: "sr-welcome-step-desc", text: description });
    }
}
