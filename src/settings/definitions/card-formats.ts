import type {
    SettingDefinitionAction,
    SettingDefinitionItem,
    SettingDefinitionList,
    SettingDefinitionPage,
    SettingGroupItem,
} from "obsidian";

import type { StudioSettings } from "src/data/settings-model";
import { CardRegionsModal } from "src/settings/card-regions-modal";
import type { SettingsContext } from "src/settings/context";
import {
    bindKeys,
    distinctEntries,
    removeEntry,
    restoreDefaultsButton,
} from "src/settings/definitions/helpers";
import { TextPromptModal } from "src/settings/text-prompt-modal";
import { clozePatternError, separatorError } from "src/settings/validators";

const SEPARATOR_KEYS = [
    "singleLineCardSeparator",
    "singleLineReversedCardSeparator",
    "multilineCardSeparator",
    "multilineReversedCardSeparator",
] as const;
type SeparatorKey = (typeof SEPARATOR_KEYS)[number];

/** A separator row. Each separator must differ from the other three, which are read as they are when it is checked. */
function separatorRow(
    ctx: SettingsContext,
    key: SeparatorKey,
    name: string,
    desc: string,
): SettingGroupItem {
    return {
        name,
        desc,
        control: {
            type: "text",
            key,
            validate: (value) =>
                separatorError(
                    value,
                    SEPARATOR_KEYS.filter((other) => other !== key).map(
                        (other) => ctx.settings[other],
                    ),
                ),
        },
    };
}

/**
 * What the markers do, as src/parser.ts reads them. A marker is set when it is not empty, with no trimming, as there.
 * A start marker turns regions on: multi-line and cloze cards are found only inside one. The first start marker opens
 * a region, an end marker closes it, and with no end marker it stays open to the end of the note. When both markers
 * are the same text, each such line opens a region or closes the one that is open, so cards sit between pairs of
 * them. An end marker without a start marker opens no region, but it still ends multi-line and cloze cards, and a
 * blank line then doesn't.
 */
function regionsDescription(settings: StudioSettings): string {
    const start = settings.multilineCardStartMarker;
    const end = settings.multilineCardEndMarker;
    if (start !== "") {
        if (end === "") {
            return "Multi-line and cloze cards are found only after the first " + start + ".";
        }
        if (end === start) {
            return (
                "Multi-line and cloze cards are found only between pairs of " + start + " lines."
            );
        }
        return "Multi-line and cloze cards are found only between " + start + " and " + end + ".";
    }
    if (end !== "") return "Multi-line and cloze cards end at a line with " + end + ".";
    return "Off: cards are found anywhere in a note.";
}

/** The row that opens the markers dialog. It is rebuilt on save, which is when its description changes. */
function cardRegionsRow(ctx: SettingsContext): SettingDefinitionAction {
    return bindKeys<SettingDefinitionAction>(
        ["multilineCardStartMarker", "multilineCardEndMarker"],
        {
            name: "Card regions",
            desc: regionsDescription(ctx.settings),
            aliases: ["region", "marker"],
            action: () =>
                new CardRegionsModal(
                    ctx.app,
                    ctx.settings.multilineCardStartMarker,
                    ctx.settings.multilineCardEndMarker,
                    async (start, end) => {
                        ctx.settings.multilineCardStartMarker = start;
                        ctx.settings.multilineCardEndMarker = end;
                        await ctx.commit(["multilineCardStartMarker", "multilineCardEndMarker"]);
                        ctx.rebuild();
                    },
                ).open(),
        },
    );
}

/** The patterns that mark hidden text in a cloze card, as a list to add to and delete from, on their own page. */
function clozePatternsPage(ctx: SettingsContext): SettingDefinitionPage {
    const list = bindKeys<SettingDefinitionList>(["clozePatterns"], {
        type: "list",
        heading: "Patterns",
        emptyState: "No cloze patterns: cloze cards are off.",
        // A pattern stored twice shows once, and deleting it takes out every copy.
        items: distinctEntries(ctx.settings.clozePatterns).map((pattern) => ({
            name: pattern,
            searchable: false,
        })),
        onDelete: (index) => {
            removeEntry(
                ctx.settings.clozePatterns,
                distinctEntries(ctx.settings.clozePatterns)[index],
            );
            void ctx.commit(["clozePatterns"]);
            ctx.rebuild();
        },
        addItem: {
            name: "Add pattern",
            action: () =>
                new TextPromptModal(ctx.app, {
                    title: "Add a cloze pattern",
                    placeholder: "{{[123;;]answer[;;hint]}}",
                    check: (value) => clozePatternError(value, ctx.settings.clozePatterns),
                    onSubmit: async (value) => {
                        ctx.settings.clozePatterns.push(value.trim());
                        await ctx.commit(["clozePatterns"]);
                        ctx.rebuild();
                    },
                }).open(),
        },
    });

    return {
        type: "page",
        name: "Cloze patterns",
        desc: "Write answer where the hidden text goes, and hint where an optional hint goes.",
        displayValue: () => {
            const count = distinctEntries(ctx.settings.clozePatterns).length;
            if (count === 0) return "None";
            return count === 1 ? "1 pattern" : count + " patterns";
        },
        items: [list],
    };
}

/** How cards are written in notes: the separators, callouts, cloze options, regions and cloze patterns. */
export function cardFormatsGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    return [
        {
            type: "group",
            heading: "Card formats",
            extraButtons: [restoreDefaultsButton(ctx, [...SEPARATOR_KEYS])],
            items: [
                separatorRow(
                    ctx,
                    "singleLineCardSeparator",
                    "One-line separator",
                    "Between question and answer on one line, as in Question::Answer. Cards written with the old separator stop working.",
                ),
                separatorRow(
                    ctx,
                    "singleLineReversedCardSeparator",
                    "Two-way one-line separator",
                    "Same, but you're also asked the answer side.",
                ),
                separatorRow(
                    ctx,
                    "multilineCardSeparator",
                    "Multi-line separator",
                    "A line with only this, between question and answer.",
                ),
                separatorRow(
                    ctx,
                    "multilineReversedCardSeparator",
                    "Two-way multi-line separator",
                    "Same, but you're also asked the answer side.",
                ),
                {
                    name: "Callout card types",
                    desc: "Callouts of these types are cards: the title asks, the body answers. Empty turns them off.",
                    aliases: ["callout"],
                    control: {
                        type: "text",
                        key: "calloutCardTypes",
                        placeholder: "flashcard, question, card",
                    },
                },
                {
                    name: "One line per cloze card",
                    desc: "A cloze card shows only its own line, not the whole paragraph.",
                    aliases: ["cloze"],
                    control: {
                        type: "toggle",
                        key: "atomicClozes",
                        // The reader ignores this option while a start marker is set, so it can't be changed then.
                        disabled: () => ctx.settings.multilineCardStartMarker !== "",
                    },
                },
                {
                    name: "Clozes in math",
                    desc: "Use \\cloze{answer} inside $…$ and $$…$$ math.",
                    aliases: ["latex", "mathjax"],
                    control: { type: "toggle", key: "latexClozes" },
                },
                cardRegionsRow(ctx),
                clozePatternsPage(ctx),
            ],
        },
    ];
}
