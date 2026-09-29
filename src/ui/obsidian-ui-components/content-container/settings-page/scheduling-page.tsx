import { Notice, Setting, SettingGroup } from "obsidian";

import { DataManager } from "src/data/data-manager";
import { ALGORITHMS_DOCS_URL } from "src/data/product";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import { t, tHTML } from "src/lang/helpers";
import SRPlugin from "src/main";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import {
    formatFsrsSteps,
    formatFsrsWeights,
    hasStepOfADayOrMore,
    parseFsrsSteps,
    parseFsrsWeights,
} from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { MIN_REVIEWS_TO_OPTIMIZE } from "src/scheduling/optimizer/optimize";
import { SettingsPage } from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page";
import { SettingsPageType } from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page-manager";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { FsrsOptimizerModal } from "src/ui/obsidian-ui-components/modals/fsrs-optimizer-modal";
import { DateUtil, globalDateProvider, IDayBoundary } from "src/utils/dates";

/**
 * Represents a scheduling settings page.
 *
 * @class SchedulingPage
 * @extends {SettingsPage}
 */
export class SchedulingPage extends SettingsPage {
    private async setAlgorithm(algorithm: SRAlgorithmType): Promise<void> {
        this.settingsManager.settings.algorithm = algorithm;
        await this.settingsManager.save();
        this.dataManager.setupDataStoreAndAlgorithmInstances(this.settingsManager.settings);
        this.display();
    }

    /**
     * Saves a setting that the live scheduler reads at construction time (desired retention,
     * maximum interval), so that the change applies without a plugin reload.
     */
    private async saveAndRefreshAlgorithm(): Promise<void> {
        await this.settingsManager.save();
        this.dataManager.refreshAlgorithmParameters(this.settingsManager.settings);
    }

    /**
     * A text field that accepts whole numbers in a range, saved when it loses focus or on Enter.
     */
    private addWholeNumberSetting(
        setting: Setting,
        name: string,
        description: string,
        getValue: () => number,
        setValue: (value: number) => void,
        min: number,
        max: number,
        disabled: boolean,
    ): void {
        setting
            .setName(name)
            .setDesc(description)
            .addText((text) => {
                text.setValue(getValue().toString());
                text.inputEl.type = "number";
                text.inputEl.min = String(min);
                text.inputEl.max = String(max);
                text.inputEl.step = "1";
                text.setDisabled(disabled);

                const commit = () => {
                    this.applySettingsUpdate(async () => {
                        const parsed = Number(text.getValue());
                        if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
                            new Notice(t("INVALID_WHOLE_NUMBER", { min, max }));
                            text.setValue(getValue().toString());
                            return;
                        }
                        setValue(parsed);
                        await this.settingsManager.save();
                    });
                };
                text.inputEl.addEventListener("blur", commit);
                text.inputEl.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") commit();
                });
            });
    }

    constructor(
        pageContainerEl: HTMLElement,
        plugin: SRPlugin,
        settingsManager: SettingsManager,
        dataManager: DataManager,
        pageType: SettingsPageType,
        applySettingsUpdate: (callback: () => unknown) => void,
        display: () => void,
        openPage: (pageType: SettingsPageType) => void,
        scrollListener: (scrollPosition: number) => void,
    ) {
        super(
            pageContainerEl,
            plugin,
            settingsManager,
            dataManager,
            pageType,
            applySettingsUpdate,
            display,
            openPage,
            scrollListener,
        );

        new SettingGroup(this.containerEl)
            .setHeading(t("DAILY_LIMITS"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DAILY_LIMITS"))
                    .setDesc(t("DAILY_LIMITS_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.dailyLimitsEnabled)
                            .onChange(async (value) => {
                                this.settingsManager.settings.dailyLimitsEnabled = value;
                                await this.settingsManager.save();
                                this.display();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                this.addWholeNumberSetting(
                    setting,
                    t("NEW_CARDS_PER_DAY"),
                    t("NEW_CARDS_PER_DAY_DESC"),
                    () => this.settingsManager.settings.newCardsPerDay,
                    (value) => (this.settingsManager.settings.newCardsPerDay = value),
                    0,
                    9999,
                    !this.settingsManager.settings.dailyLimitsEnabled,
                );
            })
            .addSetting((setting: Setting) => {
                this.addWholeNumberSetting(
                    setting,
                    t("REVIEW_LIMIT_PER_DAY"),
                    t("REVIEW_LIMIT_PER_DAY_DESC"),
                    () => this.settingsManager.settings.reviewsPerDay,
                    (value) => (this.settingsManager.settings.reviewsPerDay = value),
                    0,
                    99999,
                    !this.settingsManager.settings.dailyLimitsEnabled,
                );
            });

        new SettingGroup(this.containerEl)
            .setHeading(t("LEECHES"))
            .addSetting((setting: Setting) => {
                this.addWholeNumberSetting(
                    setting,
                    t("LEECH_THRESHOLD"),
                    t("LEECH_THRESHOLD_DESC"),
                    () => this.settingsManager.settings.leechThreshold,
                    (value) => (this.settingsManager.settings.leechThreshold = value),
                    0,
                    99,
                    false,
                );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("LEECH_ACTION"))
                    .setDesc(t("LEECH_ACTION_DESC"))
                    .addDropdown((dropdown) =>
                        dropdown
                            .addOption("suspend", t("LEECH_ACTION_SUSPEND"))
                            .addOption("tag", t("LEECH_ACTION_TAG"))
                            .setValue(this.settingsManager.settings.leechAction)
                            .onChange(async (value) => {
                                this.settingsManager.settings.leechAction =
                                    value === "tag" ? "tag" : "suspend";
                                await this.settingsManager.save();
                            }),
                    );
            });

        // These controls live under Scheduling because they govern when review is surfaced to the
        // user, not how flashcards are parsed or reviewed once a session is already open.
        new SettingGroup(this.containerEl)
            .setHeading(t("REVIEW_REMINDERS"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDERS"))
                    .setDesc(t("REVIEW_REMINDERS_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.enableReviewReminders = value;
                                await this.settingsManager.save();
                                // The interval loop is stateful, so settings changes must be
                                // applied immediately instead of waiting for the next reload.
                                this.plugin.reminderManager.restartReviewReminders();
                                this.display();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_CHECK_ON_STARTUP"))
                    .setDesc(t("REVIEW_REMINDER_CHECK_ON_STARTUP_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.reviewReminderCheckOnStartup)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.reviewReminderCheckOnStartup = value;
                                await this.settingsManager.save();
                                this.plugin.reminderManager.restartReviewReminders();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_INTERVAL"))
                    .setDesc(t("REVIEW_REMINDER_INTERVAL_DESC"))
                    .addText((text) => {
                        text.setValue(
                            this.settingsManager.settings.reviewReminderIntervalMinutes.toString(),
                        );
                        text.inputEl.type = "number";
                        text.inputEl.min = "1";
                        text.inputEl.max = "1440";
                        text.inputEl.step = "1";
                        text.setDisabled(!this.settingsManager.settings.enableReviewReminders);

                        const commitIntervalValue = (value: string) => {
                            this.applySettingsUpdate(async () => {
                                const parsedValue = Number.parseInt(value);
                                if (
                                    Number.isNaN(parsedValue) ||
                                    parsedValue < 1 ||
                                    parsedValue > 1440
                                ) {
                                    new Notice(t("REVIEW_REMINDER_INTERVAL_MIN_WARNING"));
                                    text.setValue(
                                        this.settingsManager.settings.reviewReminderIntervalMinutes.toString(),
                                    );
                                    return;
                                }

                                this.settingsManager.settings.reviewReminderIntervalMinutes =
                                    parsedValue;
                                await this.settingsManager.save();
                                // Interval changes only take effect once the existing timer is
                                // rebuilt with the new cadence.
                                this.plugin.reminderManager.restartReviewReminders();
                            });
                        };

                        text.inputEl.addEventListener("blur", () => {
                            commitIntervalValue(text.getValue());
                        });
                        text.inputEl.addEventListener("keydown", (event) => {
                            if (event.key === "Enter") {
                                commitIntervalValue(text.getValue());
                            }
                        });
                    });
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_MESSAGE"))
                    .setDesc(t("REVIEW_REMINDER_MESSAGE_DESC"))
                    .addTextArea((text) =>
                        text
                            .setValue(this.settingsManager.settings.reviewReminderMessage)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange((value) => {
                                this.applySettingsUpdate(async () => {
                                    this.settingsManager.settings.reviewReminderMessage = value;
                                    await this.settingsManager.save();
                                });
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_AUTO_OPEN"))
                    .setDesc(t("REVIEW_REMINDER_AUTO_OPEN_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.reviewReminderAutoOpen)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.reviewReminderAutoOpen = value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_SHOW_NOTICE"))
                    .setDesc(t("REVIEW_REMINDER_SHOW_NOTICE_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.reviewReminderShowNotice)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.reviewReminderShowNotice = value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_PLAY_SOUND"))
                    .setDesc(t("REVIEW_REMINDER_PLAY_SOUND_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.reviewReminderPlaySound)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.reviewReminderPlaySound = value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_REMINDER_BOUNCE_DOCK"))
                    .setDesc(t("REVIEW_REMINDER_BOUNCE_DOCK_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.reviewReminderBounceDock)
                            .setDisabled(!this.settingsManager.settings.enableReviewReminders)
                            .onChange(async (value) => {
                                this.settingsManager.settings.reviewReminderBounceDock = value;
                                await this.settingsManager.save();
                            }),
                    );
            });

        const algorithmGroup = new SettingGroup(this.containerEl).setHeading(t("ALGORITHM"));

        algorithmGroup.addSetting((setting: Setting) => {
            const algoSettingEl = setting
                .setName(t("ALGORITHM"))
                .setDesc("")
                .addDropdown((dropdown) =>
                    dropdown
                        .addOptions({
                            "SM-2-OSR": t("SM2_OSR_VARIANT"),
                            FSRS: "FSRS",
                        })
                        .setValue(this.settingsManager.settings.algorithm)
                        .onChange(async (value) => {
                            const selectedAlgorithm = value as SRAlgorithmType;
                            const currentAlgorithm = this.settingsManager.settings.algorithm;

                            if (selectedAlgorithm === currentAlgorithm) {
                                return;
                            }

                            if (
                                currentAlgorithm === SRAlgorithmType.SM_2_OSR &&
                                selectedAlgorithm === SRAlgorithmType.FSRS
                            ) {
                                dropdown.setValue(currentAlgorithm);
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("SWITCH_TO_FSRS_ALGORITHM"),
                                    t("CONFIRM_FSRS_ALGORITHM_SWITCH"),
                                    undefined,
                                    async () => {
                                        await this.setAlgorithm(selectedAlgorithm);
                                    },
                                ).open();
                                return;
                            }

                            await this.setAlgorithm(selectedAlgorithm);
                        }),
                );

            const elements: (HTMLElement | Text)[] = tHTML("CHECK_ALGORITHM_WIKI", {
                algoUrl: ALGORITHMS_DOCS_URL,
            });

            algoSettingEl.descEl.empty();

            for (let i = 0; i < elements.length; i++) {
                algoSettingEl.descEl.append(elements[i]);
            }
        });

        algorithmGroup.addSetting((setting: Setting) => {
            setting
                .setName("Flashcard algorithm scope")
                .setDesc(
                    "The selected algorithm applies to flashcards and clozes only. Whole-note review continues to use the existing OSR scheduler.",
                );
        });

        if (this.settingsManager.settings.algorithm === SRAlgorithmType.FSRS) {
            algorithmGroup.addSetting((setting: Setting) => {
                setting
                    .setName("FSRS desired retention")
                    .setDesc("Target recall probability used by FSRS for flashcard scheduling.")
                    .addExtraButton((button) => {
                        button
                            .setIcon("reset")
                            .setTooltip(t("RESET_DEFAULT"))
                            .onClick(async () => {
                                this.settingsManager.settings.fsrsDesiredRetention =
                                    DEFAULT_SETTINGS.fsrsDesiredRetention;
                                await this.saveAndRefreshAlgorithm();
                                this.display();
                            });
                    })
                    .addText((text) =>
                        text
                            .setValue(this.settingsManager.settings.fsrsDesiredRetention.toString())
                            .onChange((value) => {
                                applySettingsUpdate(async () => {
                                    const numValue = Number.parseFloat(value);
                                    if (Number.isNaN(numValue) || numValue <= 0 || numValue > 1) {
                                        new Notice(
                                            "FSRS desired retention must be between 0 and 1.",
                                        );
                                        text.setValue(
                                            this.settingsManager.settings.fsrsDesiredRetention.toString(),
                                        );
                                        return;
                                    }

                                    this.settingsManager.settings.fsrsDesiredRetention = numValue;
                                    await this.saveAndRefreshAlgorithm();
                                });
                            }),
                    );
            });
        }

        if (this.settingsManager.settings.algorithm === SRAlgorithmType.SM_2_OSR) {
            algorithmGroup
                .addSetting((setting: Setting) => {
                    setting
                        .setName(t("BASE_EASE"))
                        .setDesc(t("BASE_EASE_DESC"))
                        .addExtraButton((button) => {
                            button
                                .setIcon("reset")
                                .setTooltip(t("RESET_DEFAULT"))
                                .onClick(async () => {
                                    this.settingsManager.settings.baseEase =
                                        DEFAULT_SETTINGS.baseEase;
                                    await this.settingsManager.save();

                                    this.display();
                                });
                        })
                        .addText((text) =>
                            text
                                .setValue(this.settingsManager.settings.baseEase.toString())
                                .onChange((value) => {
                                    applySettingsUpdate(async () => {
                                        const numValue: number = Number.parseInt(value);
                                        if (!isNaN(numValue)) {
                                            if (numValue < 130) {
                                                new Notice(t("BASE_EASE_MIN_WARNING"));
                                                text.setValue(
                                                    this.settingsManager.settings.baseEase.toString(),
                                                );
                                                return;
                                            }

                                            this.settingsManager.settings.baseEase = numValue;
                                            await this.settingsManager.save();
                                        } else {
                                            new Notice(t("VALID_NUMBER_WARNING"));
                                        }
                                    });
                                }),
                        );
                })
                .addSetting((setting: Setting) => {
                    setting
                        .setName(t("MAX_LINK_CONTRIB"))
                        .setDesc(t("MAX_LINK_CONTRIB_DESC"))
                        .addExtraButton((button) => {
                            button
                                .setIcon("reset")
                                .setTooltip(t("RESET_DEFAULT"))
                                .onClick(async () => {
                                    this.settingsManager.settings.maxLinkFactor =
                                        DEFAULT_SETTINGS.maxLinkFactor;
                                    await this.settingsManager.save();

                                    this.display();
                                });
                        })
                        .addSlider((slider) =>
                            slider
                                .setLimits(0, 100, 1)
                                .setValue(this.settingsManager.settings.maxLinkFactor * 100)
                                .onChange(async (value: number) => {
                                    this.settingsManager.settings.maxLinkFactor = value / 100;
                                    await this.settingsManager.save();
                                }),
                        );
                })
                .addSetting((setting: Setting) => {
                    setting
                        .setName(t("LAPSE_INTERVAL_CHANGE"))
                        .setDesc(t("LAPSE_INTERVAL_CHANGE_DESC"))
                        .addExtraButton((button) => {
                            button
                                .setIcon("reset")
                                .setTooltip(t("RESET_DEFAULT"))
                                .onClick(async () => {
                                    this.settingsManager.settings.lapsesIntervalChange =
                                        DEFAULT_SETTINGS.lapsesIntervalChange;
                                    await this.settingsManager.save();

                                    this.display();
                                });
                        })
                        .addSlider((slider) =>
                            slider
                                .setLimits(1, 99, 1)
                                .setValue(this.settingsManager.settings.lapsesIntervalChange * 100)
                                .onChange(async (value: number) => {
                                    this.settingsManager.settings.lapsesIntervalChange =
                                        value / 100;
                                    await this.settingsManager.save();
                                }),
                        );
                })
                .addSetting((setting: Setting) => {
                    setting
                        .setName(t("EASY_BONUS"))
                        .setDesc(t("EASY_BONUS_DESC"))
                        .addExtraButton((button) => {
                            button
                                .setIcon("reset")
                                .setTooltip(t("RESET_DEFAULT"))
                                .onClick(async () => {
                                    this.settingsManager.settings.easyBonus =
                                        DEFAULT_SETTINGS.easyBonus;
                                    await this.settingsManager.save();

                                    this.display();
                                });
                        })
                        .addText((text) =>
                            text
                                .setValue(
                                    (this.settingsManager.settings.easyBonus * 100).toString(),
                                )
                                .onChange((value) => {
                                    applySettingsUpdate(async () => {
                                        const numValue: number = Number.parseInt(value) / 100;
                                        if (!isNaN(numValue)) {
                                            if (numValue < 1.0) {
                                                new Notice(t("EASY_BONUS_MIN_WARNING"));
                                                text.setValue(
                                                    (
                                                        this.settingsManager.settings.easyBonus *
                                                        100
                                                    ).toString(),
                                                );
                                                return;
                                            }

                                            this.settingsManager.settings.easyBonus = numValue;
                                            await this.settingsManager.save();
                                        } else {
                                            new Notice(t("VALID_NUMBER_WARNING"));
                                        }
                                    });
                                }),
                        );
                })
                .addSetting((setting: Setting) => {
                    setting
                        .setName(t("LOAD_BALANCE"))
                        .setDesc(t("LOAD_BALANCE_DESC"))
                        .addToggle((toggle) =>
                            toggle
                                .setValue(this.settingsManager.settings.loadBalance)
                                .onChange(async (value) => {
                                    this.settingsManager.settings.loadBalance = value;
                                    await this.settingsManager.save();
                                }),
                        );
                });
        }

        algorithmGroup
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("MAX_INTERVAL"))
                    .setDesc(t("MAX_INTERVAL_DESC"))
                    .addExtraButton((button) => {
                        button
                            .setIcon("reset")
                            .setTooltip(t("RESET_DEFAULT"))
                            .onClick(async () => {
                                this.settingsManager.settings.maximumInterval =
                                    DEFAULT_SETTINGS.maximumInterval;
                                await this.saveAndRefreshAlgorithm();

                                this.display();
                            });
                    })
                    .addText((text) =>
                        text
                            .setValue(this.settingsManager.settings.maximumInterval.toString())
                            .onChange((value) => {
                                applySettingsUpdate(async () => {
                                    const numValue: number = Number.parseInt(value);
                                    if (!isNaN(numValue)) {
                                        if (numValue < 1) {
                                            new Notice(t("MAX_INTERVAL_MIN_WARNING"));
                                            text.setValue(
                                                this.settingsManager.settings.maximumInterval.toString(),
                                            );
                                            return;
                                        }

                                        this.settingsManager.settings.maximumInterval = numValue;
                                        await this.saveAndRefreshAlgorithm();
                                    } else {
                                        new Notice(t("VALID_NUMBER_WARNING"));
                                    }
                                });
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("START_OF_DAY"))
                    .setDesc(t("START_OF_DAY_DESC"))
                    .addExtraButton((button) => {
                        button
                            .setIcon("reset")
                            .setTooltip(t("RESET_DEFAULT"))
                            .onClick(async () => {
                                this.settingsManager.settings.startOfDay =
                                    DEFAULT_SETTINGS.startOfDay;
                                await this.settingsManager.save();

                                this.display();
                            });
                    })
                    .addText((text) =>
                        text
                            .setValue(this.settingsManager.settings.startOfDay)
                            .onChange((value) => {
                                applySettingsUpdate(async () => {
                                    const dayBoundary: IDayBoundary | null =
                                        DateUtil.strToDayBoundary(value);
                                    if (dayBoundary === null) {
                                        new Notice(t("INVALID_START_OF_DAY_WARNING"));
                                        return;
                                    } else {
                                        this.settingsManager.settings.startOfDay = value;
                                        await this.settingsManager.save();
                                        globalDateProvider.setDayBoundary(dayBoundary);
                                    }
                                });
                            }),
                    );
            });

        // M3a: scheduling
        if (this.settingsManager.settings.algorithm === SRAlgorithmType.FSRS) {
            this.addFsrsGroup();
        }
    }

    // M3a: scheduling

    /**
     * The FSRS group: learning and relearning steps, fuzz, custom weights and the optimizer. Every change is applied to
     * the live scheduler at once.
     */
    private addFsrsGroup(): void {
        const settings = this.settingsManager.settings;
        const group = new SettingGroup(this.containerEl).setHeading(t("FSRS_GROUP"));

        group.addSetting((setting: Setting) =>
            this.addStepsSetting(
                setting,
                t("FSRS_LEARNING_STEPS"),
                t("FSRS_LEARNING_STEPS_DESC"),
                "sr-fsrs-learning-steps",
                "fsrsLearningSteps",
            ),
        );
        group.addSetting((setting: Setting) =>
            this.addStepsSetting(
                setting,
                t("FSRS_RELEARNING_STEPS"),
                t("FSRS_RELEARNING_STEPS_DESC"),
                "sr-fsrs-relearning-steps",
                "fsrsRelearningSteps",
            ),
        );

        group.addSetting((setting: Setting) => {
            setting
                .setName(t("FSRS_FUZZ"))
                .setDesc(t("FSRS_FUZZ_DESC"))
                .addToggle((toggle) =>
                    toggle.setValue(settings.fsrsEnableFuzz).onChange(async (value) => {
                        settings.fsrsEnableFuzz = value;
                        await this.saveAndRefreshAlgorithm();
                    }),
                );
        });

        group.addSetting((setting: Setting) => {
            setting
                .setClass("sr-fsrs-weights")
                .setName(t("FSRS_WEIGHTS"))
                .setDesc(t("FSRS_WEIGHTS_DESC"))
                .addExtraButton((button) => {
                    button
                        .setIcon("reset")
                        .setTooltip(t("RESET_DEFAULT"))
                        .onClick(async () => {
                            settings.fsrsWeights = DEFAULT_SETTINGS.fsrsWeights;
                            await this.saveAndRefreshAlgorithm();
                            this.display();
                        });
                })
                .addTextArea((text) => {
                    text.setValue(settings.fsrsWeights);
                    text.inputEl.rows = 3;

                    const commit = () => {
                        this.applySettingsUpdate(async () => {
                            const relearningCount = (
                                parseFsrsSteps(settings.fsrsRelearningSteps) ?? []
                            ).length;
                            const parsed = parseFsrsWeights(text.getValue(), relearningCount);
                            if (parsed.error !== null) {
                                new Notice(t("FSRS_WEIGHTS_INVALID", { reason: parsed.error }));
                                text.setValue(settings.fsrsWeights);
                                return;
                            }

                            // Weights are stored as the 21 that FSRS 6 uses, so an older export is converted once
                            const stored =
                                parsed.weights === null ? "" : formatFsrsWeights(parsed.weights);
                            if (parsed.typedCount === 17 || parsed.typedCount === 19) {
                                new Notice(
                                    t("FSRS_WEIGHTS_CONVERTED", { count: parsed.typedCount }),
                                );
                            }
                            text.setValue(stored);
                            if (stored === settings.fsrsWeights) return;
                            settings.fsrsWeights = stored;
                            await this.saveAndRefreshAlgorithm();
                        });
                    };
                    text.inputEl.addEventListener("blur", commit);
                });
        });

        group.addSetting((setting: Setting) => {
            setting
                .setName(t("FSRS_OPTIMIZE"))
                .setDesc(t("FSRS_OPTIMIZE_DESC", { min: MIN_REVIEWS_TO_OPTIMIZE }))
                .addButton((button) =>
                    button
                        .setButtonText(t("FSRS_OPTIMIZE"))
                        .setClass("sr-fsrs-optimize")
                        .onClick(() => {
                            new FsrsOptimizerModal(
                                this.plugin.app,
                                this.plugin,
                                async (weights) => {
                                    settings.fsrsWeights = formatFsrsWeights(weights);
                                    await this.saveAndRefreshAlgorithm();
                                    new Notice(t("OPTIMIZER_APPLIED"));
                                    this.display();
                                },
                            ).open();
                        }),
                );
        });
    }

    /**
     * A field for learning or relearning steps such as `1m 10m`, saved when it loses focus or on Enter.
     */
    private addStepsSetting(
        setting: Setting,
        name: string,
        description: string,
        className: string,
        key: "fsrsLearningSteps" | "fsrsRelearningSteps",
    ): void {
        const settings = this.settingsManager.settings;
        setting
            .setClass(className)
            .setName(name)
            .setDesc(description)
            .addExtraButton((button) => {
                button
                    .setIcon("reset")
                    .setTooltip(t("RESET_DEFAULT"))
                    .onClick(async () => {
                        settings[key] = DEFAULT_SETTINGS[key];
                        await this.saveAndRefreshAlgorithm();
                        this.display();
                    });
            })
            .addText((text) => {
                text.setValue(settings[key]);

                const commit = () => {
                    this.applySettingsUpdate(async () => {
                        const steps = parseFsrsSteps(text.getValue());
                        if (steps === null) {
                            new Notice(t("FSRS_STEPS_INVALID"));
                            text.setValue(settings[key]);
                            return;
                        }
                        if (hasStepOfADayOrMore(steps)) new Notice(t("FSRS_STEPS_LONG_WARNING"));

                        const formatted = formatFsrsSteps(steps);
                        text.setValue(formatted);
                        if (formatted === settings[key]) return;
                        settings[key] = formatted;
                        await this.saveAndRefreshAlgorithm();
                    });
                };
                text.inputEl.addEventListener("blur", commit);
                text.inputEl.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") commit();
                });
            });
    }
}
