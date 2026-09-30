import { ButtonComponent, SecretComponent, setIcon, Setting, SettingGroup } from "obsidian";

import type { AiProviderId } from "src/ai/ai-provider";
import { DataManager } from "src/data/data-manager";
import { DebugLoggerInstance } from "src/data/debug-logger";
import {
    DISCUSSIONS_URL,
    DOCS_URL,
    ISSUES_URL,
    RELEASES_URL,
    REPOSITORY_URL,
    ROADMAP_URL,
} from "src/data/product";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import { t, tHTML } from "src/lang/helpers";
import { LocaleManagerInstance } from "src/lang/locale-manager";
import SRPlugin from "src/main";
import { setDebugParser } from "src/parser";
import { SettingsPage } from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page";
import {
    getPageIcon,
    getPageName,
    SettingsPageType,
    SettingsPageTypesArray,
} from "src/ui/obsidian-ui-components/content-container/settings-page/settings-page-manager";

/** Where Ollama listens by default; the example in the empty base URL field. */
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Represents the main settings page, from which all other settings pages are accessed.
 *
 * @class MainPage
 * @extends {SettingsPage}
 */
export class MainPage extends SettingsPage {
    constructor(
        pageContainerEl: HTMLElement,
        plugin: SRPlugin,
        settingsManager: SettingsManager,
        dataManager: DataManager,
        pageType: SettingsPageType,
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
            () => {},
            display,
            openPage,
            scrollListener,
        );

        this.containerEl.addClass("sr-main-page");

        const mainSettingsGroup = new SettingGroup(this.containerEl).setHeading(
            t("SETTINGS_TAB_HEADING"),
        );
        SettingsPageTypesArray.forEach((pageType) => {
            if (pageType === "main-page") return;
            if (pageType === "statistics-page") return;
            mainSettingsGroup.addSetting((setting: Setting) => {
                setting.setName(getPageName(pageType)).addButton((button: ButtonComponent) => {
                    button.setIcon("chevron-right").onClick(() => {
                        this.openPage(pageType);
                    });

                    button.buttonEl.addClass("clickable-icon");
                });
                const iconEl = createDiv();
                iconEl.addClass("sr-settings-page-title-icon");
                setIcon(iconEl, getPageIcon(pageType));

                setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
                setting.nameEl.addClass("sr-settings-page-title");
                setting.settingEl.addClass("sr-settings-page-title-setting");
                setting.settingEl.addEventListener("click", () => {
                    this.openPage(pageType);
                });
            });
        });

        mainSettingsGroup.addSetting((setting: Setting) => {
            setting
                .setName(t("LANGUAGE_SETTINGS"))
                .setDesc(t("LANGUAGE_SETTINGS_DESC"))
                .addDropdown((dropdown) => {
                    dropdown.addOption("-", t("DEFAULT_LOCALE_NAME"));

                    LocaleManagerInstance.getInstance()
                        .getLocaleOptionsList()
                        .forEach((option) => {
                            dropdown.addOption(option.language, option.languageName);
                        });

                    dropdown.setValue(this.settingsManager.settings.preferredLocale);

                    dropdown.onChange(async (value) => {
                        if (value === "-") {
                            const loadedLocale: string =
                                LocaleManagerInstance.getInstance().loadedLocale;
                            LocaleManagerInstance.getInstance().currentLocale = loadedLocale;
                        } else {
                            LocaleManagerInstance.getInstance().currentLocale = value;
                        }
                        this.settingsManager.settings.preferredLocale = value;
                        await this.plugin.dataManager.savePluginData();
                        this.display();
                    });
                });
        });

        this.addAiSettings();

        new SettingGroup(this.containerEl)
            .setHeading(t("INFO"))
            .addSetting((setting: Setting) => {
                setting
                    .setName(getPageName("statistics-page"))
                    .addButton((button: ButtonComponent) => {
                        button.setIcon("chevron-right").onClick((evt: MouseEvent) => {
                            // The row opens the view as well, so the click must not reach it twice
                            evt.stopPropagation();
                            this.openStatistics();
                        });

                        button.buttonEl.addClass("clickable-icon");
                    });
                const iconEl = createDiv();
                iconEl.addClass("sr-settings-page-title-icon");
                setIcon(iconEl, getPageIcon("statistics-page"));

                setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
                setting.nameEl.addClass("sr-settings-page-title");
                setting.settingEl.addClass("sr-settings-page-title-setting");
                setting.settingEl.addEventListener("click", () => {
                    this.openStatistics();
                });
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("CHECK_WIKI", {
                    wikiUrl: DOCS_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("CHECK_ROADMAP", {
                    roadMapUrl: ROADMAP_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("CHECK_DEV_NEWS", {
                    devNewsUrl: RELEASES_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            });

        new SettingGroup(this.containerEl)
            .setHeading(t("HELP") + " & " + t("GROUP_CONTRIBUTING"))
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("GITHUB_DISCUSSIONS", {
                    discussionsUrl: DISCUSSIONS_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("GITHUB_ISSUES", {
                    issuesUrl: ISSUES_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("GITHUB_SOURCE_CODE", {
                    githubProjectUrl: REPOSITORY_URL,
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("CODE_CONTRIBUTION_INFO", {
                    codeContributionUrl:
                        "https://stephenmwangi.com/obsidian-spaced-repetition/contributing/#code",
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            })
            .addSetting((setting: Setting) => {
                const elements: (HTMLElement | Text)[] = tHTML("TRANSLATION_CONTRIBUTION_INFO", {
                    translationContributionUrl:
                        "https://stephenmwangi.com/obsidian-spaced-repetition/contributing/#translating",
                });

                setting.infoEl.empty();

                for (let i = 0; i < elements.length; i++) {
                    setting.infoEl.append(elements[i]);
                }
            });

        new SettingGroup(this.containerEl)
            .setHeading(t("LOGGING"))
            .addSetting((setting: Setting) => {
                setting.setName(t("DISPLAY_SCHEDULING_DEBUG_INFO")).addToggle((toggle) =>
                    toggle
                        .setValue(this.settingsManager.settings.showSchedulingDebugMessages)
                        .onChange(async (value) => {
                            this.settingsManager.settings.showSchedulingDebugMessages = value;
                            await this.settingsManager.save();
                        }),
                );
            })
            .addSetting((setting: Setting) => {
                setting.setName(t("DISPLAY_PARSER_DEBUG_INFO")).addToggle((toggle) =>
                    toggle
                        .setValue(this.settingsManager.settings.showParserDebugMessages)
                        .onChange(async (value) => {
                            this.settingsManager.settings.showParserDebugMessages = value;
                            setDebugParser(this.settingsManager.settings.showParserDebugMessages);
                            await this.settingsManager.save();
                        }),
                );
            })
            .addSetting((setting: Setting) => {
                setting
                    .setName(t("DEBUG_LOG"))
                    .addTextArea((text) =>
                        text.setValue(DebugLoggerInstance.getInstance().getLog("info")),
                    )
                    .addExtraButton((button) => {
                        button
                            .setIcon("copy")
                            .setTooltip(t("COPY"))
                            .onClick(async () => {
                                await navigator.clipboard.writeText(
                                    DebugLoggerInstance.getInstance().getLog("info"),
                                );
                            });
                    });
            });
    }

    /**
     * The settings of "Generate cards with AI". The key is kept in Obsidian's secret storage: the setting only holds
     * the id of the secret.
     */
    private addAiSettings(): void {
        const settings = this.settingsManager.settings;
        const group = new SettingGroup(this.containerEl).setHeading(t("AI_SETTINGS_HEADING"));

        group.addSetting((setting: Setting) => {
            setting
                .setName(t("AI_PROVIDER"))
                .setDesc(t("AI_PROVIDER_DESC"))
                .addDropdown((dropdown) => {
                    dropdown
                        .addOption("anthropic", t("AI_PROVIDER_ANTHROPIC"))
                        .addOption("openai", t("AI_PROVIDER_OPENAI"))
                        .addOption("openai-compatible", t("AI_PROVIDER_COMPATIBLE"))
                        .setValue(settings.aiProvider)
                        .onChange(async (value) => {
                            settings.aiProvider = value as AiProviderId;
                            // A model name belongs to one provider: Anthropic has a default, the others none
                            settings.aiModel =
                                value === "anthropic" ? DEFAULT_SETTINGS.aiModel : "";
                            await this.settingsManager.save();
                            this.display();
                        });
                });
        });

        group.addSetting((setting: Setting) => {
            const placeholders: Record<AiProviderId, string> = {
                anthropic: DEFAULT_SETTINGS.aiModel,
                openai: "gpt-5.5",
                "openai-compatible": "llama3.1",
            };
            setting
                .setName(t("AI_MODEL"))
                .setDesc(t("AI_MODEL_DESC"))
                .addText((text) =>
                    text
                        .setPlaceholder(placeholders[settings.aiProvider])
                        .setValue(settings.aiModel)
                        .onChange(async (value) => {
                            settings.aiModel = value.trim();
                            await this.settingsManager.save();
                        }),
                );
        });

        if (settings.aiProvider === "openai-compatible") {
            group.addSetting((setting: Setting) => {
                setting
                    .setName(t("AI_BASE_URL"))
                    .setDesc(t("AI_BASE_URL_DESC"))
                    .addText((text) =>
                        text
                            .setPlaceholder(OLLAMA_BASE_URL)
                            .setValue(settings.aiBaseUrl)
                            .onChange(async (value) => {
                                settings.aiBaseUrl = value.trim();
                                await this.settingsManager.save();
                            }),
                    );
            });
        }

        group.addSetting((setting: Setting) => {
            setting
                .setName(t("AI_API_KEY"))
                .setDesc(t("AI_API_KEY_DESC"))
                .addComponent((el) =>
                    new SecretComponent(this.plugin.app, el)
                        .setValue(settings.aiKeySecret)
                        .onChange(async (secretId) => {
                            settings.aiKeySecret = secretId;
                            await this.settingsManager.save();
                        }),
                );
        });

        group.addSetting((setting: Setting) => {
            setting.setName(t("AI_PRIVACY_NAME")).setDesc(t("AI_PRIVACY_NOTE"));
        });
    }

    /**
     * Opens the statistics view. The settings dialog is closed first, or the view would open behind it.
     */
    private openStatistics(): void {
        (this.plugin.app as unknown as { setting?: { close: () => void } }).setting?.close();
        void this.plugin.uiManager.openStatisticsView();
    }
}
