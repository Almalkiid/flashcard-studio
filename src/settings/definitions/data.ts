import type { SettingDefinitionAction, SettingDefinitionItem } from "obsidian";

import { DISCUSSIONS_URL, DOCS_URL, ISSUES_URL, RELEASES_URL } from "src/data/product";
import {
    deleteSchedules,
    importFromLegacyPlugin,
    moveCommentsIntoCallouts,
    resetAllSettings,
} from "src/settings/actions";
import type { SettingsContext } from "src/settings/context";

const NO_UNDO = "This can't be undone. Back up your vault first.";

/** A row that asks first, then deletes the schedules named by `which` (and the tags, if that option is on). */
function deleteRow(
    ctx: SettingsContext,
    name: string,
    which: "all" | "notes" | "cards",
): SettingDefinitionAction {
    return {
        name,
        action: () => ctx.confirm(name + "?", NO_UNDO, () => deleteSchedules(ctx, which)),
    };
}

/** A row that opens one of the product's web pages. */
function linkRow(name: string, url: string): SettingDefinitionAction {
    return { name, action: () => window.open(url) };
}

/**
 * Where schedules live and the actions on them: the review log, moving and deleting schedules, importing, a full
 * reset, two debug switches and the links to help.
 */
export function dataGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    return [
        {
            type: "group",
            heading: "Data",
            items: [
                {
                    name: "Review log folder",
                    desc: "Every answer is logged here, one file per device and month, so sync never clashes.",
                    control: {
                        type: "folder",
                        key: "reviewLogFolder",
                        placeholder: "Flashcard Studio/Review log",
                    },
                },
                {
                    name: "Schedule on the card's last line",
                    desc: "Keeps lists intact by writing the schedule on the same line.",
                    control: { type: "toggle", key: "cardCommentOnSameLine" },
                },
                {
                    name: "Hide schedules in a callout",
                    desc: "New schedules go inside a folded callout instead of a comment.",
                    control: { type: "toggle", key: "useCalloutsForSchedulingComments" },
                },
                {
                    name: "Move existing schedules into callouts",
                    desc: "Rewrites every note in the vault. Back up first.",
                    action: () =>
                        ctx.confirm(
                            "Move all schedules into callouts?",
                            "This rewrites every note in your vault that holds a schedule. Make a backup first.",
                            () => moveCommentsIntoCallouts(ctx),
                        ),
                },
                {
                    name: "Import from Spaced Repetition",
                    desc: "Copy settings from the Spaced Repetition plugin in this vault.",
                    action: () =>
                        ctx.confirm(
                            "Import from Spaced Repetition?",
                            "Your options are replaced by its settings, including the algorithm. This can't be undone.",
                            () => importFromLegacyPlugin(ctx),
                        ),
                },
            ],
        },
        {
            type: "group",
            heading: "Delete schedules",
            items: [
                {
                    name: "Also remove tags",
                    desc: "Remove the flashcard and review tags along with the schedules.",
                    control: { type: "toggle", key: "deleteTagsOnSchedulingDataDeletion" },
                },
                deleteRow(ctx, "Delete all schedules", "all"),
                deleteRow(ctx, "Delete note schedules", "notes"),
                deleteRow(ctx, "Delete card schedules", "cards"),
            ],
        },
        {
            type: "group",
            heading: "Reset",
            items: [
                {
                    name: "Reset all settings",
                    desc: "Go back to how a new install starts. Your cards and schedules stay.",
                    action: () =>
                        ctx.confirm(
                            "Reset all settings?",
                            "Every option goes back to how a new install starts. Your notes, cards and review history are not touched.",
                            () => resetAllSettings(ctx),
                        ),
                },
            ],
        },
        {
            type: "group",
            heading: "Developer",
            items: [
                {
                    name: "Log scheduling details",
                    desc: "Writes extra details to the developer console after each scan.",
                    control: { type: "toggle", key: "showSchedulingDebugMessages" },
                },
                {
                    name: "Log parser details",
                    desc: "Writes how each note is read to the developer console.",
                    control: { type: "toggle", key: "showParserDebugMessages" },
                },
            ],
        },
        {
            type: "group",
            heading: "Help",
            items: [
                linkRow("Documentation", DOCS_URL),
                linkRow("Report a problem", ISSUES_URL),
                linkRow("Discussions", DISCUSSIONS_URL),
                linkRow("Release notes", RELEASES_URL),
            ],
        },
    ];
}
