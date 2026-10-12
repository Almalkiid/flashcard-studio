import type { SettingDefinitionItem } from "obsidian";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import type { SettingsContext } from "src/settings/context";
import { wholeNumberError } from "src/settings/validators";

/** Nudges to review when cards are due; every option is off while the switch is. */
export function remindersGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    const off = () => !ctx.settings.enableReviewReminders;
    const onComputer = () => !ctx.env.isMobile;
    return [
        {
            type: "group",
            heading: "Reminders",
            items: [
                {
                    name: "Review reminders",
                    desc: "Check for due cards now and then, and remind you.",
                    control: { type: "toggle", key: "enableReviewReminders" },
                },
                {
                    name: "Check every (minutes)",
                    control: {
                        type: "number",
                        key: "reviewReminderIntervalMinutes",
                        min: 1,
                        max: 1440,
                        defaultValue: DEFAULT_SETTINGS.reviewReminderIntervalMinutes,
                        validate: (value) => wholeNumberError(value, 1, 1440),
                        disabled: off,
                    },
                },
                {
                    name: "Check at startup",
                    control: { type: "toggle", key: "reviewReminderCheckOnStartup", disabled: off },
                },
                {
                    name: "Reminder text",
                    desc: "Empty uses the built-in message.",
                    control: { type: "text", key: "reviewReminderMessage", disabled: off },
                },
                {
                    name: "Open the review",
                    control: { type: "toggle", key: "reviewReminderAutoOpen", disabled: off },
                },
                {
                    name: "Show a notice",
                    control: { type: "toggle", key: "reviewReminderShowNotice", disabled: off },
                },
                {
                    name: "Play a sound",
                    visible: onComputer,
                    control: { type: "toggle", key: "reviewReminderPlaySound", disabled: off },
                },
                {
                    name: "Bounce the dock icon",
                    visible: onComputer,
                    control: { type: "toggle", key: "reviewReminderBounceDock", disabled: off },
                },
            ],
        },
    ];
}
