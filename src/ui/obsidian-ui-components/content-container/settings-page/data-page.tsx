import { normalizePath, Notice, Setting, SettingGroup } from "obsidian";

import { DataManager } from "src/data/data-manager";
import { DataStore } from "src/data/data-store/base/data-store";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { mergeImportedSettings } from "src/data/settings-import";
import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { SettingsPage } from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page";
import { SettingsPageType } from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page-manager";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";

/**
 * Settings page for data storage options and scheduling data management.
 *
 * @class DataPage
 * @extends {SettingsPage}
 */
export class DataPage extends SettingsPage {
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

        // TODO: Implement this when the other data stores are implemented

        new SettingGroup(this.containerEl)
            .setHeading(t("REVIEW_HISTORY"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("REVIEW_LOG_FOLDER"))
                    .setDesc(t("REVIEW_LOG_FOLDER_DESC"))
                    .addText((text) => {
                        text.setPlaceholder(DEFAULT_SETTINGS.reviewLogFolder)
                            .setValue(this.settingsManager.settings.reviewLogFolder)
                            .onChange((value) => {
                                this.applySettingsUpdate(async () => {
                                    const folder = normalizePath(value.trim());
                                    this.settingsManager.settings.reviewLogFolder =
                                        folder.length > 0 && folder !== "/"
                                            ? folder
                                            : DEFAULT_SETTINGS.reviewLogFolder;
                                    await this.settingsManager.save();
                                });
                            });
                    });
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("IMPORT_SR_SETTINGS"))
                    .setDesc(t("IMPORT_SR_SETTINGS_DESC"))
                    .addButton((button) =>
                        button.setButtonText(t("IMPORT")).onClick(async () => {
                            await this.importSpacedRepetitionSettings();
                        }),
                    );
            });

        const dataStorageGroup = new SettingGroup(this.containerEl).setHeading(
            t("GROUP_DATA_STORAGE"),
        );
        //     .addSetting((setting: Setting) => {
        //         setting
        //             .setName(t("GROUP_DATA_STORAGE"))
        //             .setDesc(t("GROUP_DATA_STORAGE_DESC"))
        //             .addDropdown((dropdown) => {
        //                 dropdown
        //                     .addOptions({
        //                         [StorageType.NOTES]: t("STORE_IN_NOTES"),
        //                         // [StorageType.FOLDER]: "Store in vault folder (beta)",
        //                         // [StorageType.PLUGIN_DATA]: "Store in plugin data (beta)",
        //                     })
        //                     .setValue(this.settingsManager.settings.dataStore)
        //                     .onChange(async (value) => {
        //                         const oldMode = this.settingsManager.settings
        //                             .dataStore as StorageType;
        //                         const newMode = value as StorageType;

        //                         // Revert the dropdown immediately; only apply after confirmation.
        //                         dropdown.setValue(oldMode);

        //                         let migrateMessage: string = "";
        //                         let confirmMessage: string = "";
        //                         let migratingMessage: string = "";

        //                         switch (newMode) {
        //                             // case StorageType.FOLDER:
        //                             //     migrateMessage = t("MIGRATE_TO_FOLDER");
        //                             //     confirmMessage = t("CONFIRM_MIGRATE_TO_FOLDER");
        //                             //     migratingMessage = t("MIGRATING_TO_FOLDER");
        //                             //     break;
        //                             // case StorageType.PLUGIN_DATA:
        //                             //     migrateMessage = t("MIGRATE_TO_PLUGIN_DATA");
        //                             //     confirmMessage = t("CONFIRM_MIGRATE_TO_PLUGIN_DATA");
        //                             //     migratingMessage = t("MIGRATING_TO_PLUGIN_DATA");
        //                             //     break;
        //                             case StorageType.NOTES:
        //                                 migrateMessage = t("MIGRATE_TO_NOTES");
        //                                 confirmMessage = t("CONFIRM_MIGRATE_TO_NOTES");
        //                                 migratingMessage = t("MIGRATING_TO_NOTES");
        //                                 break;
        //                         }

        //                         new ConfirmationModal(
        //                             this.plugin.app,
        //                             migrateMessage,
        //                             confirmMessage,
        //                             migratingMessage,
        //                             async () => {
        //                                 dropdown.setValue(newMode);
        //                                 this.settingsManager.settings.dataStore = newMode;
        //                                 this.dataManager.setupDataStoreAndAlgorithmInstances(
        //                                     this.settingsManager.settings,
        //                                 );
        //                                 await DataStore.instance.isStructureInitialized.then(
        //                                     async (isInitialized) => {
        //                                         if (!isInitialized) {
        //                                             await DataStore.instance.isStructureInitialized;
        //                                         }
        //                                         await DataStore.instance.migrateDataStore(oldMode);
        //                                         await this.settingsManager.save();
        //                                         this.display();
        //                                     },
        //                                 );
        //                             },
        //                         ).open();
        //                     });
        //             });
        //     });

        // dataStorageGroup.addSetting((setting: Setting) => {
        //     setting.infoEl.insertAdjacentText("beforeend", t("PLUGIN_DATA_STORE_INFO"));
        // });

        // if (this.settingsManager.settings.dataStore === StorageType.FOLDER) {
        //     dataStorageGroup.addSetting((setting: Setting) => {
        //         setting
        //             .setName("Schedule data location in vault")
        //             .setDesc(
        //                 'Root folder for schedule files. Data is stored in "Schedule Data" as markdown files.',
        //             )
        //             .addText((text) => {
        //                 const commitValue = async () => {
        //                     this.settingsManager.settings.scheduleDataVaultLocation =
        //                         text.getValue().trim() ||
        //                         DEFAULT_SETTINGS.scheduleDataVaultLocation;
        //                     await this.settingsManager.save();
        //                 };

        //                 text.setPlaceholder(DEFAULT_SETTINGS.scheduleDataVaultLocation)
        //                     .setValue(this.settingsManager.settings.scheduleDataVaultLocation)
        //                     .onChange(() => {
        //                         this.settingsManager.settings.scheduleDataVaultLocation =
        //                             text.getValue().trim() ||
        //                             DEFAULT_SETTINGS.scheduleDataVaultLocation;
        //                     });

        //                 text.inputEl.addEventListener("blur", () => {
        //                     void commitValue();
        //                 });
        //             });
        //     });
        // }

        dataStorageGroup
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("INLINE_SCHEDULING_COMMENTS"))
                    .setDesc(t("INLINE_SCHEDULING_COMMENTS_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.settingsManager.settings.cardCommentOnSameLine)
                            .onChange(async (value) => {
                                this.settingsManager.settings.cardCommentOnSameLine = value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("USE_CALLOUTS_FOR_SCHEDULING_COMMENTS"))
                    .setDesc(t("USE_CALLOUTS_FOR_SCHEDULING_COMMENTS_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(
                                this.settingsManager.settings.useCalloutsForSchedulingComments,
                            )
                            .onChange(async (value) => {
                                this.settingsManager.settings.useCalloutsForSchedulingComments =
                                    value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("MIGRATE_SCHEDULING_COMMENTS_TO_CALLOUT"))
                    .setDesc(t("MIGRATE_SCHEDULING_COMMENTS_TO_CALLOUT_DESC"))
                    .addButton((button) => {
                        button
                            .setButtonText(t("MIGRATE_SCHEDULING_COMMENTS_TO_CALLOUT_BUTTON"))
                            .setClass("mod-warning")
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("MIGRATE_SCHEDULING_COMMENTS_TO_CALLOUT"),
                                    t("CONFIRM_MIGRATE_SCHEDULING_COMMENTS_TO_CALLOUT"),
                                    t("MIGRATING_SCHEDULING_COMMENTS_TO_CALLOUT"),
                                    async () => {
                                        await DataStore.instance.fileModifier.migrateCommentsToCallouts();
                                        this.display();
                                    },
                                ).open();
                            });
                    });
            });

        new SettingGroup(this.containerEl)
            .setHeading(t("DELETE_SCHEDULING_DATA_ALL"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DELETE_TAGS_WHEN_DELETING_SCHEDULING_DATA"))
                    .setDesc(t("DELETE_TAGS_WHEN_DELETING_SCHEDULING_DATA_DESC"))
                    .addToggle((toggle) =>
                        toggle
                            .setValue(
                                this.settingsManager.settings.deleteTagsOnSchedulingDataDeletion,
                            )
                            .onChange(async (value) => {
                                this.settingsManager.settings.deleteTagsOnSchedulingDataDeletion =
                                    value;
                                await this.settingsManager.save();
                            }),
                    );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DELETE_SCHEDULING_DATA_ALL"))
                    .setDesc(t("DELETE_SCHEDULING_DATA_ALL_DESC"))
                    .addButton((button) => {
                        button
                            .setButtonText(t("DELETE"))
                            .setClass("mod-warning")
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("DELETE_SCHEDULING_DATA_ALL"),
                                    t("CONFIRM_SCHEDULING_DATA_ALL_DELETION"),
                                    t("SCHEDULING_DATA_ALL_DELETION_IN_PROGRESS"),
                                    async () => {
                                        const settings = this.settingsManager.settings;
                                        await DataStore.instance.fileModifier.deleteAllSchedulingData(
                                            settings.deleteTagsOnSchedulingDataDeletion,
                                            settings.flashcardTags,
                                            settings.tagsToReview,
                                        );
                                    },
                                ).open();
                            });
                    });
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DELETE_SCHEDULING_DATA_IN_NOTES"))
                    .setDesc(t("DELETE_SCHEDULING_DATA_IN_NOTES_DESC"))
                    .addButton((button) => {
                        button
                            .setButtonText(t("DELETE"))
                            .setClass("mod-warning")
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("DELETE_SCHEDULING_DATA_IN_NOTES"),
                                    t("CONFIRM_SCHEDULING_DATA_IN_NOTES_DELETION"),
                                    t("SCHEDULING_DATA_IN_NOTES_DELETION_IN_PROGRESS"),
                                    async () => {
                                        await DataStore.instance.fileModifier.deleteAllSchedulingDataInNotes(
                                            this.settingsManager.settings
                                                .deleteTagsOnSchedulingDataDeletion,
                                            this.settingsManager.settings.tagsToReview,
                                        );
                                    },
                                ).open();
                            });
                    });
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DELETE_SCHEDULING_DATA_IN_CARDS"))
                    .setDesc(t("DELETE_SCHEDULING_DATA_IN_CARDS_DESC"))
                    .addButton((button) => {
                        button
                            .setButtonText(t("DELETE"))
                            .setClass("mod-warning")
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("DELETE_SCHEDULING_DATA_IN_CARDS"),
                                    t("CONFIRM_SCHEDULING_DATA_IN_CARDS_DELETION"),
                                    t("SCHEDULING_DATA_IN_CARDS_DELETION_IN_PROGRESS"),
                                    async () => {
                                        await DataStore.instance.fileModifier.deleteAllSchedulingDataInCards(
                                            this.settingsManager.settings
                                                .deleteTagsOnSchedulingDataDeletion,
                                            this.settingsManager.settings.flashcardTags,
                                        );
                                    },
                                ).open();
                            });
                    });
            });

        new SettingGroup(this.containerEl)
            .setHeading(t("GROUP_RESET_SETTINGS"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("GROUP_RESET_SETTINGS"))
                    .setDesc(t("GROUP_RESET_SETTINGS_DESC"))
                    .addButton((button) => {
                        button
                            .setButtonText(t("RESET_SETTINGS"))
                            .setClass("mod-warning")
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.plugin.app,
                                    t("RESET_SETTINGS"),
                                    t("CONFIRM_RESET_SETTINGS"),
                                    t("RESET_SETTINGS_CONFIRMATION"),
                                    async () => {
                                        await this.settingsManager.saveSettings(DEFAULT_SETTINGS);
                                        this.display();
                                    },
                                ).open();
                            });
                    });
            });
    }

    /**
     * Copies the settings of the original Spaced Repetition plugin, when it is installed in this vault.
     */
    private async importSpacedRepetitionSettings(): Promise<void> {
        const path = normalizePath(
            `${this.plugin.app.vault.configDir}/plugins/obsidian-spaced-repetition/data.json`,
        );
        const adapter = this.plugin.app.vault.adapter;
        if (!(await adapter.exists(path))) {
            new Notice(t("SR_SETTINGS_NOT_FOUND"));
            return;
        }

        let imported: unknown;
        try {
            imported = JSON.parse(await adapter.read(path));
        } catch {
            new Notice(t("SR_SETTINGS_NOT_FOUND"));
            return;
        }

        const { settings, importedKeys } = mergeImportedSettings(
            this.settingsManager.settings,
            imported,
        );
        Object.assign(this.settingsManager.settings, settings);
        await this.settingsManager.save();
        this.dataManager.setupDataStoreAndAlgorithmInstances(this.settingsManager.settings);
        new Notice(t("SR_SETTINGS_IMPORTED", { count: importedKeys.length }));
        this.display();
    }
}
