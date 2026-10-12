import type { SettingDefinitionItem, SettingDefinitionList, SettingDefinitionPage } from "obsidian";

import type { SettingsContext } from "src/settings/context";
import { bindKeys, distinctEntries, removeEntry } from "src/settings/definitions/helpers";
import { TextPromptModal } from "src/settings/text-prompt-modal";
import { isNegatedFolderPattern, skippedFolderError, tagListError } from "src/settings/validators";

const NEGATED_WARNING = "Starts with !: skips every other folder";

/** The skipped folders and patterns as a list to add to and delete from, shown on their own page. */
function skippedFoldersPage(ctx: SettingsContext): SettingDefinitionPage {
    const list = bindKeys<SettingDefinitionList>(["noteFoldersToIgnore"], {
        type: "list",
        heading: "Folders and patterns",
        emptyState: "No folders are skipped.",
        // A folder stored twice shows once, and deleting it takes out every copy.
        // An entry that starts with ! can only have been saved by an earlier version: it is shown, flagged, so it can
        // be deleted, and never changed for the person.
        items: distinctEntries(ctx.settings.noteFoldersToIgnore).map((entry) => ({
            name: entry,
            ...(isNegatedFolderPattern(entry) ? { desc: NEGATED_WARNING } : {}),
            searchable: false,
        })),
        onDelete: (index) => {
            removeEntry(
                ctx.settings.noteFoldersToIgnore,
                distinctEntries(ctx.settings.noteFoldersToIgnore)[index],
            );
            void ctx.commit(["noteFoldersToIgnore"]);
            ctx.rebuild();
        },
        addItem: {
            name: "Add folder",
            action: () =>
                new TextPromptModal(ctx.app, {
                    title: "Skip a folder",
                    placeholder: "Templates or **/*.excalidraw.md",
                    check: (value) => skippedFolderError(value, ctx.settings.noteFoldersToIgnore),
                    onSubmit: async (value) => {
                        ctx.settings.noteFoldersToIgnore.push(value.trim());
                        await ctx.commit(["noteFoldersToIgnore"]);
                        ctx.rebuild();
                    },
                }).open(),
        },
    });

    return {
        type: "page",
        name: "Skipped folders",
        desc: "Folders, or patterns such as **/*.excalidraw.md, that are never scanned for cards or notes.",
        status: () =>
            ctx.settings.noteFoldersToIgnore.some(isNegatedFolderPattern) ? "warning" : null,
        displayValue: () => {
            const count = distinctEntries(ctx.settings.noteFoldersToIgnore).length;
            if (count === 0) return "None";
            return count === 1 ? "1 folder" : count + " folders";
        },
        items: [list],
    };
}

/** Where cards come from: the tags that mark flashcard notes, folders as decks, and what to skip. */
export function sourcesGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    return [
        {
            type: "group",
            items: [
                {
                    name: "Flashcard tags",
                    desc: "Notes with any of these tags hold flashcards. Separate tags with spaces.",
                    aliases: ["tag", "deck"],
                    control: {
                        type: "text",
                        key: "flashcardTags",
                        placeholder: "#flashcards",
                        validate: tagListError,
                    },
                },
                {
                    name: "Use folders as decks",
                    desc: "Each folder becomes a deck, instead of the tag.",
                    aliases: ["folder"],
                    control: { type: "toggle", key: "convertFoldersToDecks" },
                },
                {
                    name: "Tags to skip",
                    desc: "Notes with any of these tags never make flashcards.",
                    aliases: ["ignore", "exclude"],
                    control: {
                        type: "text",
                        key: "flashcardTagsToIgnore",
                        validate: tagListError,
                    },
                },
                skippedFoldersPage(ctx),
            ],
        },
    ];
}
