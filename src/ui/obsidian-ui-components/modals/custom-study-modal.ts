import "src/ui/obsidian-ui-components/modals/scheduling-modals.css";
import { App, Modal, Notice, Setting, TextComponent } from "obsidian";

import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { CustomStudySpec, increaseAllowance } from "src/scheduling/custom-study";
import { FLAG_COUNT } from "src/ui/card-actions";
import { globalDateProvider } from "src/utils/dates";

export interface CustomStudyCallbacks {
    /** Today's limit was raised, so open review screens should load their queues again. */
    onLimitsChanged: () => void;
    /** A session was chosen; the caller opens it. */
    onStartSession: (spec: CustomStudySpec) => void;
}

/**
 * Anki's Custom Study: raise today's limits, or study a chosen set of cards without waiting for them to be due.
 */
export class CustomStudyModal extends Modal {
    private plugin: SRPlugin;
    private callbacks: CustomStudyCallbacks;

    constructor(app: App, plugin: SRPlugin, callbacks: CustomStudyCallbacks) {
        super(app);
        this.plugin = plugin;
        this.callbacks = callbacks;
    }

    onOpen(): void {
        this.modalEl.addClass("sr-custom-study-modal");
        this.setTitle(t("CUSTOM_STUDY"));
        const { contentEl } = this;
        contentEl.empty();

        const limitsOn = this.plugin.dataManager.data.settings.dailyLimitsEnabled;
        this.addIncreaseRow(
            "sr-custom-study-increase-new",
            t("CUSTOM_STUDY_INCREASE_NEW"),
            t("CUSTOM_STUDY_INCREASE_NEW_DESC"),
            "new",
            limitsOn,
        );
        this.addIncreaseRow(
            "sr-custom-study-increase-reviews",
            t("CUSTOM_STUDY_INCREASE_REVIEWS"),
            t("CUSTOM_STUDY_INCREASE_REVIEWS_DESC"),
            "reviews",
            limitsOn,
        );

        this.addSessionRow(
            "sr-custom-study-forgotten",
            t("CUSTOM_STUDY_FORGOTTEN"),
            t("CUSTOM_STUDY_FORGOTTEN_DESC"),
            t("CUSTOM_STUDY_DAYS"),
            1,
            30,
            (days) => ({ type: "forgotten", days }),
        );
        this.addSessionRow(
            "sr-custom-study-ahead",
            t("CUSTOM_STUDY_AHEAD"),
            t("CUSTOM_STUDY_AHEAD_DESC"),
            t("CUSTOM_STUDY_DAYS"),
            1,
            365,
            (days) => ({ type: "ahead", days }),
        );
        this.addSessionRow(
            "sr-custom-study-preview",
            t("CUSTOM_STUDY_PREVIEW"),
            t("CUSTOM_STUDY_PREVIEW_DESC"),
            t("CUSTOM_STUDY_COUNT"),
            20,
            9999,
            (count) => ({ type: "preview", count }),
        );
        this.addFilterRows();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * A whole number field, read when the user acts.
     *
     * @returns A function that returns the number, or null after telling the user why it is not valid.
     */
    private addNumberInput(
        text: TextComponent,
        placeholder: string,
        initial: number,
        min: number,
        max: number,
    ): () => number | null {
        text.setPlaceholder(placeholder).setValue(String(initial));
        text.inputEl.type = "number";
        text.inputEl.min = String(min);
        text.inputEl.max = String(max);
        text.inputEl.step = "1";
        return () => {
            const parsed = Number(text.getValue());
            if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
                new Notice(t("INVALID_WHOLE_NUMBER", { min, max }));
                return null;
            }
            return parsed;
        };
    }

    private addIncreaseRow(
        className: string,
        name: string,
        description: string,
        kind: "new" | "reviews",
        enabled: boolean,
    ): void {
        const setting = new Setting(this.contentEl)
            .setClass(className)
            .setName(name)
            .setDesc(enabled ? description : t("CUSTOM_STUDY_LIMITS_OFF"));
        let read: () => number | null = () => null;
        setting.addText((text) => {
            read = this.addNumberInput(text, t("CUSTOM_STUDY_COUNT"), 10, 1, 9999);
            text.setDisabled(!enabled);
        });
        setting.addButton((button) =>
            button
                .setButtonText(t("CUSTOM_STUDY_APPLY"))
                .setDisabled(!enabled)
                .onClick(async () => {
                    const count = read();
                    if (count === null) return;
                    await this.raiseLimit(kind, count);
                }),
        );
    }

    private async raiseLimit(kind: "new" | "reviews", count: number): Promise<void> {
        const data = this.plugin.dataManager.data;
        const todayYmd = globalDateProvider.today.format("YYYY-MM-DD");
        data.limitOverride = increaseAllowance(data.limitOverride, todayYmd, kind, count);
        await this.plugin.dataManager.savePluginData();
        new Notice(t("CUSTOM_STUDY_LIMIT_RAISED", { count }));
        this.callbacks.onLimitsChanged();
        this.close();
    }

    private addSessionRow(
        className: string,
        name: string,
        description: string,
        placeholder: string,
        initial: number,
        max: number,
        toSpec: (value: number) => CustomStudySpec,
    ): void {
        const setting = new Setting(this.contentEl)
            .setClass(className)
            .setName(name)
            .setDesc(description);
        let read: () => number | null = () => null;
        setting.addText((text) => {
            read = this.addNumberInput(text, placeholder, initial, 1, max);
        });
        setting.addButton((button) =>
            button
                .setButtonText(t("CUSTOM_STUDY_START"))
                .setCta()
                .onClick(() => {
                    const value = read();
                    if (value === null) return;
                    this.startSession(toSpec(value));
                }),
        );
    }

    private startSession(spec: CustomStudySpec): void {
        this.close();
        this.callbacks.onStartSession(spec);
    }

    /**
     * The decks a session can be limited to: every deck and subdeck with cards, as `Parent/Child` paths.
     */
    private deckPaths(): string[] {
        const tree = this.plugin.dataManager.osrCore.reviewableDeckTree;
        return tree
            .toDeckArray()
            .filter((deck) => !deck.isRootDeck)
            .map((deck) => deck.getTopicPath().path.join("/"));
    }

    private addFilterRows(): void {
        const container = this.contentEl.createDiv({ cls: "sr-custom-study-filter" });
        new Setting(container)
            .setHeading()
            .setName(t("CUSTOM_STUDY_FILTER"))
            .setDesc(t("CUSTOM_STUDY_FILTER_DESC"));

        let deck = "";
        let state: "all" | "new" | "due" = "all";
        let flag = 0;
        let leechOnly = false;
        let readCount: () => number | null = () => 0;

        new Setting(container).setName(t("CUSTOM_STUDY_DECK")).addDropdown((dropdown) => {
            dropdown.addOption("", t("CUSTOM_STUDY_ALL_DECKS"));
            for (const path of this.deckPaths()) dropdown.addOption(path, path);
            dropdown.onChange((value) => (deck = value));
        });
        new Setting(container).setName(t("CUSTOM_STUDY_STATE")).addDropdown((dropdown) =>
            dropdown
                .addOption("all", t("CUSTOM_STUDY_STATE_ALL"))
                .addOption("new", t("CUSTOM_STUDY_STATE_NEW"))
                .addOption("due", t("CUSTOM_STUDY_STATE_DUE"))
                .onChange((value) => (state = value === "new" || value === "due" ? value : "all")),
        );
        new Setting(container).setName(t("CUSTOM_STUDY_FLAG")).addDropdown((dropdown) => {
            dropdown.addOption("0", t("CUSTOM_STUDY_ANY_FLAG"));
            for (let index = 1; index <= FLAG_COUNT; index++) {
                dropdown.addOption(String(index), t(`FLAG_${index}` as "FLAG_1"));
            }
            dropdown.onChange((value) => (flag = Number(value)));
        });
        new Setting(container)
            .setName(t("CUSTOM_STUDY_LEECHES_ONLY"))
            .addToggle((toggle) => toggle.onChange((value) => (leechOnly = value)));
        new Setting(container).setName(t("CUSTOM_STUDY_MAX_CARDS")).addText((text) => {
            readCount = this.addNumberInput(text, t("CUSTOM_STUDY_COUNT"), 100, 1, 9999);
        });
        new Setting(container).setClass("sr-custom-study-filter-start").addButton((button) =>
            button
                .setButtonText(t("CUSTOM_STUDY_START"))
                .setCta()
                .onClick(() => {
                    const count = readCount();
                    if (count === null) return;
                    this.startSession({
                        type: "filter",
                        decks: deck === "" ? [] : [deck],
                        state,
                        flag,
                        leechOnly,
                        count,
                    });
                }),
        );
    }
}
