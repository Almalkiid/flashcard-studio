import "src/ui/obsidian-ui-components/modals/scheduling-modals.css";
import { App, Modal, Notice, Setting, TextComponent } from "obsidian";

import { t } from "src/lang/translate";
import { CustomStudySpec, increaseAllowance } from "src/scheduling/custom-study";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { FLAG_COUNT } from "src/ui/card-actions";
import { globalDateProvider } from "src/utils/clock";

export interface CustomStudyCallbacks {
    /** Today's limit was raised, so open review screens should load their queues again. */
    onLimitsChanged: () => void;
    /** A session was chosen; the caller opens it. */
    onStartSession: (spec: CustomStudySpec) => void;
}

type SpecOf = (value: number) => CustomStudySpec;

/**
 * Anki's Custom Study: raise today's limits, or study a chosen set of cards without waiting for them to be due.
 */
export class CustomStudyModal extends Modal {
    constructor(
        app: App,
        private plugin: FlashcardStudioPlugin,
        private callbacks: CustomStudyCallbacks,
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("fs-custom-study-modal");
        this.setTitle(t("CUSTOM_STUDY"));
        this.contentEl.empty();

        const limitsOn = this.plugin.dataManager.data.settings.dailyLimitsEnabled;
        const increases = [
            ["new", "fs-custom-study-increase-new", "INCREASE_NEW"],
            ["reviews", "fs-custom-study-increase-reviews", "INCREASE_REVIEWS"],
        ] as const;
        for (const [kind, cls, key] of increases) {
            this.addIncreaseRow(
                cls,
                t(`CUSTOM_STUDY_${key}`),
                t(`CUSTOM_STUDY_${key}_DESC`),
                kind,
                limitsOn,
            );
        }

        const daysLabel = t("CUSTOM_STUDY_DAYS");
        const sessions: [
            string,
            "FORGOTTEN" | "AHEAD" | "PREVIEW",
            string,
            number,
            number,
            SpecOf,
        ][] = [
            [
                "fs-custom-study-forgotten",
                "FORGOTTEN",
                daysLabel,
                1,
                30,
                (days) => ({ type: "forgotten", days }),
            ],
            [
                "fs-custom-study-ahead",
                "AHEAD",
                daysLabel,
                1,
                365,
                (days) => ({ type: "ahead", days }),
            ],
            [
                "fs-custom-study-preview",
                "PREVIEW",
                t("CUSTOM_STUDY_COUNT"),
                20,
                9999,
                (count) => ({ type: "preview", count }),
            ],
        ];
        for (const [cls, key, placeholder, initial, max, toSpec] of sessions) {
            this.addSessionRow(
                cls,
                t(`CUSTOM_STUDY_${key}`),
                t(`CUSTOM_STUDY_${key}_DESC`),
                placeholder,
                initial,
                max,
                toSpec,
            );
        }
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
        const { dataManager } = this.plugin;
        const today = globalDateProvider.today.format("YYYY-MM-DD");
        dataManager.data.limitOverride = increaseAllowance(
            dataManager.data.limitOverride,
            today,
            kind,
            count,
        );
        await dataManager.savePluginData();
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
        toSpec: SpecOf,
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
        const tree = this.plugin.dataManager.vaultIndex.reviewableRoot;
        return tree
            .toDeckArray()
            .filter((deck) => !deck.isRootDeck)
            .map((deck) => deck.getTopicPath().path.join("/"));
    }

    private addFilterRows(): void {
        const container = this.contentEl.createDiv({ cls: "fs-custom-study-filter" });
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
        new Setting(container).setClass("fs-custom-study-filter-start").addButton((button) =>
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
