import type { SettingDefinitionItem } from "obsidian";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import type { SettingsContext } from "src/settings/context";
import { nonEmptyError, tagListError, wholeNumberError } from "src/settings/validators";

/** Which notes join note review, how the pane lists them, and what happens after a rating. */
export function noteReviewGroup(_ctx: SettingsContext): SettingDefinitionItem[] {
    return [
        {
            type: "group",
            heading: "Note review",
            items: [
                {
                    name: "Review tags",
                    desc: "Notes with any of these tags join note review.",
                    control: {
                        type: "text",
                        key: "tagsToReview",
                        placeholder: "#review",
                        validate: tagListError,
                    },
                },
                {
                    name: "Tags to skip",
                    desc: "Notes with any of these tags stay out of note review.",
                    control: { type: "text", key: "noteTagsToIgnore", validate: tagListError },
                },
                {
                    name: "Date format",
                    desc: "How due dates show in the review pane, as a Moment.js format.",
                    control: {
                        type: "text",
                        key: "preferredDateFormatForNoteReviewQueue",
                        placeholder: "MMM DD YYYY",
                        validate: nonEmptyError,
                    },
                },
                {
                    name: "Open the next note",
                    desc: "After you rate a note, open the next one due.",
                    control: { type: "toggle", key: "autoNextNote" },
                },
                {
                    name: "Random order",
                    desc: "Pick due notes at random instead of by how linked they are.",
                    control: { type: "toggle", key: "openRandomNote" },
                },
                {
                    name: "Review pane at startup",
                    desc: "Open the note review pane when Obsidian starts.",
                    control: { type: "toggle", key: "enableNoteReviewPaneOnStartup" },
                },
                {
                    name: "Days shown in the pane",
                    desc: "Notes due later than this are left out of the pane.",
                    control: {
                        type: "number",
                        key: "maxNDaysNotesReviewQueue",
                        min: 1,
                        max: 36500,
                        defaultValue: DEFAULT_SETTINGS.maxNDaysNotesReviewQueue,
                        validate: (value) => wholeNumberError(value, 1, 36500),
                    },
                },
            ],
        },
    ];
}
