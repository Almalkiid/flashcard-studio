import type {
    Setting,
    SettingDefinition,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingDefinitionRender,
    SettingGroupItem,
} from "obsidian";
import { Notice } from "obsidian";

import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import {
    formatFsrsWeights,
    hasStepOfADayOrMore,
    parseFsrsSteps,
    parseFsrsWeights,
} from "src/scheduling/fsrs/fsrs-settings";
import { MIN_REVIEWS_TO_OPTIMIZE } from "src/scheduling/optimizer/optimize";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import type { SettingsContext } from "src/settings/context";
import { bindKeys, restoreDefaultsButton } from "src/settings/definitions/helpers";
import {
    decimalRangeError,
    normalizeEasyDays,
    RETENTION_MAX_PERCENT,
    RETENTION_MIN_PERCENT,
    startOfDayError,
    stepsError,
    weightsError,
    wholeNumberError,
} from "src/settings/validators";
import { workloadText } from "src/settings/workload";
import { FsrsOptimizerModal } from "src/ui/obsidian-ui-components/modals/fsrs-optimizer-modal";
import { collectStatsCards, currentDayKeyFn } from "src/ui/statistics-view/stats-data";

const STEPS_NOTICE = "Steps of a day or more work better as regular reviews.";

/** Says so when the typed steps have a step of a day or more and the steps stored so far had none. */
function stepsNotice(
    key: "fsrsLearningSteps" | "fsrsRelearningSteps",
): (raw: unknown, settings: StudioSettings) => string | undefined {
    return (raw, settings) => {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the control hands over the text as typed
        const typed = hasStepOfADayOrMore(parseFsrsSteps(String(raw)) ?? []);
        const stored = hasStepOfADayOrMore(parseFsrsSteps(settings[key]) ?? []);
        return typed && !stored ? STEPS_NOTICE : undefined;
    };
}

/** How many numbers were typed when they make up parameters of the older 17 or 19, otherwise 0. */
function olderParameterCount(text: string, relearningSteps: string): number {
    const relearning = (parseFsrsSteps(relearningSteps) ?? []).length;
    const { error, typedCount } = parseFsrsWeights(text, relearning);
    return error === null && (typedCount === 17 || typedCount === 19) ? typedCount : 0;
}

/**
 * Notices to show after a typed value has been saved, by control key. They are decided from what was typed and from
 * the settings as they were before it was written, and only on a change: more keystrokes into steps that already
 * had a day, or into parameters already converted, say nothing again.
 *
 * `previous` is what was typed into the same control the time before, if anything was. The stored parameters are
 * always the 21 an older list became, so only the text typed before can say that it had the same count.
 */
export const schedulingNotices: Partial<
    Record<
        string,
        (raw: unknown, settings: StudioSettings, previous?: unknown) => string | undefined
    >
> = {
    fsrsLearningSteps: stepsNotice("fsrsLearningSteps"),
    fsrsRelearningSteps: stepsNotice("fsrsRelearningSteps"),
    fsrsWeights: (raw, settings, previous) => {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the control hands over the text as typed
        const count = olderParameterCount(String(raw), settings.fsrsRelearningSteps);
        if (count === 0) return undefined;
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- it is the text that was typed before
        const before = previous === undefined ? settings.fsrsWeights : String(previous);
        return olderParameterCount(before, settings.fsrsRelearningSteps) === count
            ? undefined
            : "Converted to the 21 parameters of FSRS-6.";
    },
};

/** A stored fraction as the percent a number control shows. */
const asPercent = (fraction: number) => Math.round(fraction * 100);

const onFsrs = (ctx: SettingsContext) => () => ctx.settings.algorithm === SchedulerKind.FSRS;

/**
 * The algorithm choice. Changing it rewrites how every card is saved from its next answer, so the dropdown stays on
 * the stored algorithm until the change is confirmed.
 */
function algorithmRow(ctx: SettingsContext): SettingDefinition {
    return bindKeys<SettingDefinition>(["algorithm"], {
        name: "Algorithm",
        desc: "FSRS learns how well you remember. Note review always uses SM-2.",
        aliases: ["fsrs", "sm-2", "sm2"],
        render: (setting: Setting) => {
            setting.addDropdown((dropdown) => {
                dropdown
                    .addOption(SchedulerKind.FSRS, "FSRS (recommended)")
                    .addOption(SchedulerKind.SM2, "SM-2")
                    .setValue(ctx.settings.algorithm)
                    .onChange((value) => {
                        // The dropdown offers only the two algorithms.
                        const chosen = value as SchedulerKind;
                        if (chosen === ctx.settings.algorithm) return;
                        dropdown.setValue(ctx.settings.algorithm);
                        const toFsrs = chosen === SchedulerKind.FSRS;
                        ctx.confirm(
                            toFsrs ? "Switch to FSRS?" : "Switch to SM-2?",
                            toFsrs
                                ? "Each card keeps its due date. The next time you answer a card, its schedule is written in the FSRS format."
                                : "Each card keeps its due date. The next time you answer a card, its schedule is written in the SM-2 format and its FSRS memory data is dropped.",
                            async () => {
                                ctx.settings.algorithm = chosen;
                                await ctx.commit(["algorithm"]);
                                ctx.refresh();
                                dropdown.setValue(chosen);
                            },
                        );
                    });
            });
        },
    });
}

/** The stability in days of every FSRS card in play, or none while the cards are still loading. */
function fsrsStabilities(ctx: SettingsContext): number[] {
    const { dataManager } = ctx.plugin;
    if (!dataManager.isVaultIndexLoaded()) return [];
    const { cards } = collectStatsCards(
        dataManager.vaultIndex.reviewableRoot,
        currentDayKeyFn()(Date.now()),
    );
    return cards.filter((c) => c.isFsrs && !c.suspended && c.stability > 0).map((c) => c.stability);
}

/**
 * What the desired retention costs: the reviews a day these cards would need, redrawn as the algorithm, retention,
 * the parameters or the maximum interval change. Nothing is read while the algorithm is not FSRS, as the row is not
 * shown then; the cards are read once, the first time it is. A failure is logged and the row says it could not
 * estimate, so the rest of the settings still open.
 */
function workloadRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: "Expected workload",
        visible: onFsrs(ctx),
        render: (setting: Setting) => {
            let stabilities: number[] | undefined;
            const show = () => {
                if (!onFsrs(ctx)()) return;
                try {
                    stabilities ??= fsrsStabilities(ctx);
                    setting.setDesc(
                        workloadText(stabilities, ctx.settings) ??
                            "Review more cards to see an estimate.",
                    );
                } catch (error) {
                    console.error("Couldn't estimate the workload", error);
                    setting.setDesc("Couldn't estimate the workload.");
                }
            };
            show();
            return ctx.watch(
                ["algorithm", "fsrsDesiredRetention", "fsrsWeights", "maximumInterval"],
                show,
            );
        },
    };
}

/** Fits the FSRS parameters to the person's own reviews, in the optimizer dialog. */
function optimizeRow(ctx: SettingsContext): SettingDefinition {
    return bindKeys<SettingDefinition>(["fsrsWeights"], {
        name: "Optimize parameters",
        desc:
            "Fit FSRS to your own reviews. Needs at least " + MIN_REVIEWS_TO_OPTIMIZE + " reviews.",
        aliases: ["optimizer", "weights"],
        visible: onFsrs(ctx),
        action: () =>
            new FsrsOptimizerModal(ctx.app, ctx.plugin, async (weights: number[]) => {
                ctx.settings.fsrsWeights = formatFsrsWeights(weights);
                await ctx.commit(["fsrsWeights"]);
                // The Advanced FSRS entry says whether the parameters are the defaults.
                ctx.rebuild();
                new Notice("FSRS parameters updated.");
            }).open(),
    });
}

/** Learning steps, spreading, and custom FSRS parameters. */
function advancedFsrsPage(ctx: SettingsContext): SettingDefinitionPage {
    return {
        type: "page",
        name: "Advanced FSRS",
        visible: onFsrs(ctx),
        displayValue: () => (ctx.settings.fsrsWeights === "" ? "Default" : "Custom"),
        items: [
            {
                type: "group",
                extraButtons: [
                    restoreDefaultsButton(ctx, [
                        "fsrsLearningSteps",
                        "fsrsRelearningSteps",
                        "fsrsEnableFuzz",
                        "fsrsLoadBalance",
                        "fsrsWeights",
                    ]),
                ],
                items: [
                    {
                        name: "Learning steps",
                        desc: "Waits before a new card graduates, such as 1m 10m. Empty lets FSRS decide.",
                        control: { type: "text", key: "fsrsLearningSteps", validate: stepsError },
                    },
                    {
                        name: "Relearning steps",
                        desc: "Waits after you forget a card, such as 10m.",
                        control: { type: "text", key: "fsrsRelearningSteps", validate: stepsError },
                    },
                    {
                        name: "Spread out due dates",
                        desc: "Vary long intervals a little so cards learned together don't all come due the same day.",
                        control: { type: "toggle", key: "fsrsEnableFuzz" },
                    },
                    {
                        name: "Balance due dates",
                        desc: "Prefer quieter days inside FSRS's fuzz window. Off leaves FSRS unchanged.",
                        control: { type: "toggle", key: "fsrsLoadBalance" },
                    },
                    {
                        name: "Custom parameters",
                        desc: "Paste 17, 19 or 21 numbers, or leave empty for the defaults. Optimize fills this in.",
                        control: {
                            type: "textarea",
                            key: "fsrsWeights",
                            rows: 3,
                            validate: (value) =>
                                weightsError(value, ctx.settings.fsrsRelearningSteps),
                        },
                    },
                ],
            },
        ],
    };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekdays whose candidate weights are reduced while FSRS load balancing is on. */
function easyDaysPage(ctx: SettingsContext): SettingDefinitionPage {
    return bindKeys<SettingDefinitionPage>(["fsrsEasyDays"], {
        type: "page",
        name: "Easy days",
        desc: "Choose weekdays with fewer reviews when FSRS load balancing is on.",
        visible: onFsrs(ctx),
        displayValue: () =>
            ctx.settings.fsrsEasyDays.length === 0
                ? "None"
                : `${ctx.settings.fsrsEasyDays.length} days`,
        items: [
            {
                type: "group",
                items: WEEKDAYS.map((name, day) => ({
                    name,
                    render: (setting: Setting) => {
                        setting.addToggle((toggle) => {
                            toggle
                                .setValue(ctx.settings.fsrsEasyDays.includes(day))
                                .onChange(async (enabled) => {
                                    ctx.settings.fsrsEasyDays = normalizeEasyDays(
                                        enabled
                                            ? [...ctx.settings.fsrsEasyDays, day]
                                            : ctx.settings.fsrsEasyDays.filter(
                                                  (value) => value !== day,
                                              ),
                                    );
                                    await ctx.commit(["fsrsEasyDays"]);
                                    ctx.rebuild();
                                });
                        });
                    },
                })),
            },
        ],
    });
}

/** The options of the SM-2 algorithm, which only matter while it is in use. */
function sm2Page(ctx: SettingsContext): SettingDefinitionPage {
    return {
        type: "page",
        name: "SM-2",
        visible: () => ctx.settings.algorithm === SchedulerKind.SM2,
        displayValue: () => "Starting ease " + ctx.settings.baseEase + "%",
        items: [
            {
                type: "group",
                extraButtons: [
                    restoreDefaultsButton(ctx, [
                        "baseEase",
                        "maxLinkFactor",
                        "lapsesIntervalChange",
                        "easyBonus",
                        "loadBalance",
                    ]),
                ],
                items: [
                    {
                        name: "Starting ease (%)",
                        desc: "Ease of a new note. At least 130.",
                        control: {
                            type: "number",
                            key: "baseEase",
                            min: 130,
                            max: 1000,
                            defaultValue: DEFAULT_SETTINGS.baseEase,
                            validate: (value) => wholeNumberError(value, 130, 1000),
                        },
                    },
                    {
                        name: "Linked notes' share",
                        desc: "How much the ease of linked notes counts toward a new note's ease.",
                        control: {
                            type: "slider",
                            key: "maxLinkFactor",
                            min: 0,
                            max: 100,
                            step: 1,
                            displayFormat: (value) => value + "%",
                        },
                    },
                    {
                        name: "Hard interval",
                        desc: "A Hard answer multiplies the interval by this.",
                        control: {
                            type: "slider",
                            key: "lapsesIntervalChange",
                            min: 1,
                            max: 99,
                            step: 1,
                            displayFormat: (value) => value + "%",
                        },
                    },
                    {
                        name: "Easy bonus (%)",
                        desc: "How much longer an Easy interval is than Good. At least 100.",
                        control: {
                            type: "number",
                            key: "easyBonus",
                            min: 100,
                            max: 1000,
                            defaultValue: asPercent(DEFAULT_SETTINGS.easyBonus),
                            validate: (value) => wholeNumberError(value, 100, 1000),
                        },
                    },
                    {
                        name: "Load balance",
                        desc: "Nudge due dates so each day has about the same number of reviews.",
                        control: { type: "toggle", key: "loadBalance" },
                    },
                ],
            },
        ],
    };
}

/** How cards are scheduled: the algorithm, desired retention, the day boundary and the options of each algorithm. */
export function schedulingGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    const rows: SettingGroupItem[] = [
        algorithmRow(ctx),
        {
            name: "Desired retention (%)",
            desc: "Chance you still remember a card when it comes due. Higher means more reviews.",
            aliases: ["retention", "memory"],
            visible: onFsrs(ctx),
            control: {
                type: "number",
                key: "fsrsDesiredRetention",
                min: RETENTION_MIN_PERCENT,
                max: RETENTION_MAX_PERCENT,
                step: 1,
                defaultValue: asPercent(DEFAULT_SETTINGS.fsrsDesiredRetention),
                validate: (value) =>
                    decimalRangeError(value, RETENTION_MIN_PERCENT, RETENTION_MAX_PERCENT),
            },
        },
        workloadRow(ctx),
        optimizeRow(ctx),
        {
            name: "Next day starts at",
            desc: "When tomorrow's cards become due, in 24-hour time such as 04:00.",
            aliases: ["midnight", "day"],
            control: { type: "text", key: "startOfDay", validate: startOfDayError },
        },
        {
            name: "Maximum interval (days)",
            desc: "No card waits longer than this.",
            control: {
                type: "number",
                key: "maximumInterval",
                min: 1,
                max: 36525,
                defaultValue: DEFAULT_SETTINGS.maximumInterval,
                validate: (value) => wholeNumberError(value, 1, 36525),
            },
        },
        advancedFsrsPage(ctx),
        easyDaysPage(ctx),
        sm2Page(ctx),
    ];
    return [{ type: "group", heading: "Scheduling", items: rows }];
}
