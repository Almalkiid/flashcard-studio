import type { SettingDefinitionItem, SettingDefinitionPage, SettingGroupItem } from "obsidian";

import { reviewOpensInTab } from "src/settings/adapters";
import type { SettingsContext } from "src/settings/context";
import { desktopTabWanted } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

/** What the status bar shows. */
function statusBarPage(ctx: SettingsContext): SettingDefinitionPage {
    const off = () => !ctx.settings.showStatusBar;
    return {
        type: "page",
        name: "Status bar",
        displayValue: () => (ctx.settings.showStatusBar ? "On" : "Off"),
        items: [
            {
                type: "group",
                items: [
                    {
                        name: "Status bar items",
                        desc: "Show the plugin's counters in the status bar.",
                        control: { type: "toggle", key: "showStatusBar" },
                    },
                    {
                        name: "Due cards",
                        control: { type: "toggle", key: "showCardStatusBarItem", disabled: off },
                    },
                    {
                        name: "Due notes",
                        control: { type: "toggle", key: "showNoteStatusBarItem", disabled: off },
                    },
                    {
                        name: "Update notice",
                        desc: "Checks GitHub for a newer release.",
                        control: {
                            type: "toggle",
                            key: "showUpdateAvailableStatusBarItem",
                            disabled: off,
                        },
                    },
                ],
            },
        ],
    };
}

/** How the review looks and where it opens, what shows beside the cards, the file menu and the status bar. */
export function displayGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    const popUpOnly = () => !reviewOpensInTab(ctx.settings, ctx.env);
    const size = (key: "windowHeight" | "windowWidth", name: string, desc?: string) => ({
        name,
        desc,
        visible: popUpOnly,
        control: {
            type: "slider" as const,
            key,
            min: 10,
            max: 100,
            step: 5,
            displayFormat: (value: number) => value + "%",
        },
    });
    const rows: SettingGroupItem[] = [
        {
            name: "Look",
            desc: "Studio is the full design; Classic keeps the plain look.",
            aliases: ["theme", "style"],
            control: {
                type: "dropdown",
                key: "reviewLook",
                options: { studio: "Studio", classic: "Classic" },
            },
        },
        {
            name: "Desktop layout",
            desc: "Open Studio as a full tab with a sidebar and dashboard.",
            visible: () => !ctx.env.isMobile,
            control: {
                type: "toggle",
                key: "desktopLayout",
                disabled: () => ctx.settings.reviewLook === "classic",
            },
        },
        {
            name: "Your name",
            desc: "Used in the greeting on the home screen.",
            control: { type: "text", key: "learnerName" },
        },
        {
            name: "Open in a tab",
            desc: "Open the review in a tab instead of a pop-up window.",
            aliases: ["modal", "window"],
            // The desktop layout already opens the review as a tab, so there is nothing to choose then.
            visible: () => !desktopTabWanted(ctx.settings, ctx.env.isMobile),
            control: { type: "toggle", key: "openInTab" },
        },
        size("windowHeight", "Window height", "Size of the pop-up review window."),
        size("windowWidth", "Window width"),
        {
            name: "Show where a card comes from",
            desc: "The note title and headings above each card.",
            aliases: ["breadcrumb"],
            control: { type: "toggle", key: "showContextInCards" },
        },
        {
            name: "Expand decks",
            desc: "Deck lists start with every subdeck open.",
            control: { type: "toggle", key: "initiallyExpandAllSubdecksInTree" },
        },
        {
            name: "Custom hotkeys",
            desc: "Answer with your own hotkeys from Obsidian's hotkey list instead of the number keys.",
            aliases: ["shortcut"],
            control: {
                type: "toggle",
                key: "useCustomHotkeys",
                disabled: () => !reviewOpensInTab(ctx.settings, ctx.env),
            },
        },
        {
            name: "Rate notes from the file menu",
            control: { type: "toggle", key: "showFileMenuReviewOptions" },
        },
        {
            name: "Delete schedules from the file menu",
            control: { type: "toggle", key: "showDeleteButtonInFileMenu" },
        },
        {
            name: "Delete button on cards",
            control: { type: "toggle", key: "showDeleteButtonInCardView" },
        },
        statusBarPage(ctx),
    ];
    return [{ type: "group", heading: "Display", items: rows }];
}
