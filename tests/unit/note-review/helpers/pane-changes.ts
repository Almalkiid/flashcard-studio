import type { Change } from "./parity";

// The values of the pane that a fix changes (golden file path -> the fix). Behavioural tests of each fix are in
// pane-fixes.test.ts; here only the differences against the old values are accounted for.

const isDateKey = (was: unknown, now: unknown) =>
    typeof was === "string" &&
    typeof now === "string" &&
    /^due:\d+$/.test(now) &&
    !/^due:/.test(was);

const SUBSCRIBES_ALWAYS: Change = {
    fix: "bug 4: the pane listens for file-open, rename and delete whether or not it was on at startup (no stale rows)",
    paths: /subscribedEvents\[2\]$|whenSetting(On|Off)\[\d\]$/,
    only: (was, now) => was === undefined && typeof now === "string",
};

const DATED_KEYS: Change = {
    fix: "bug 11: a dated group is kept by its due instant, so groups with the same title do not share fold state",
    paths: /(activeFoldersByDeck|activeFoldersAfterFirst)\.[^.]+\[2\]$/,
    only: isDateKey,
};

/** The wording the rewritten language file gives these texts (and the icon id of the renamed plugin icon). */
export const NEW_WORDING = new Map<string, string>([
    ["Review a note", "Open the next note to review"],
    [
        "There are no notes to review. To add some notes, add the tag 'review' in one of your notes.",
        "No notes are waiting. Give a note one of these tags to add it to the queue: ${tags}",
    ],
    [
        "Click on any note to open it for review. To rate a review click on the 3 dots next to the note.",
        "Choose a note to open it. The dots beside a note let you rate it.",
    ],
    ["Review: Easy", "Rate note: Easy"],
    ["Review: Good", "Rate note: Good"],
    ["Review: Hard", "Rate note: Hard"],
    ["Review: Simple", "Rate note: Simple"],
    ["Delete note scheduling data in note", "Erase the note's own schedule"],
    ["Notes Review Queue", "Note review queue"],
    ["StudioIcon", "studio-card-spark"],
    ["No deck exists for #nope", "There is no deck called #nope."],
    ["You're all caught up now :D.", "Nothing left to review right now."],
]);

export const WORDING: Change = {
    fix: "plumbing: the language file was reworded and the plugin icon renamed",
    paths: /./,
    only: (was, now) => typeof was === "string" && NEW_WORDING.get(was) === now,
};

export const PANE_CHANGES: Record<string, Change[]> = {
    groups: [
        WORDING,
        SUBSCRIBES_ALWAYS,
        DATED_KEYS,
        {
            fix: "bug 2: opening a note in a collapsed group shows its list (the old inline display:none stayed)",
            paths: /^cases\[9\]\.decks\[0\]\.folders\[0\]\.childrenInlineDisplay$/,
            only: (was, now) => was === "none" && now === null,
        },
    ],
    boundary: [
        WORDING,
        {
            fix: "bug 5: the labels count calendar days from the study day (04:00 start: at 02:00 the day is still the 6th)",
            paths: /^cases\[0\]\.decks\[0\]\.folders\[\d\]\.(title|classCollapsed|iconCollapsed|childrenInlineDisplay)$/,
        },
    ],
    dst: [],
    dstNewYork: [
        {
            fix: "bug 5: on the 25-hour day of the clocks going back a day is counted on the calendar, not in 24-hour steps",
            paths: /^cases\[\d+\]\.labels\[\d\]\[1\]$/,
            only: (was, now) =>
                (was === "Nov 02 2026" && now === "Tomorrow") ||
                (was === "Oct 31 2026" && now === "Yesterday") ||
                (was === "Yesterday" && now === "Today"),
        },
    ],
    interactions: [
        WORDING,
        {
            fix: "bug 1: a click on a folder toggles the stored state the right way round, and a redraw keeps it",
            paths: /^steps\[[1-5]\]\.(activeFoldersByDeck\.#review\[\d\]|decks\[0\](\.folders\[\d\])?\.(classCollapsed|iconCollapsed|childrenInlineDisplay))$/,
        },
        {
            fix: "bug 12: the menu has no trailing separator when there is no delete item",
            paths: /^steps\[9\]\.items\[3\]$/,
            only: (was, now) => was === "---" && now === undefined,
        },
        SUBSCRIBES_ALWAYS,
    ],
    active: [
        DATED_KEYS,
        {
            fix: "bug 2: a redraw for the open note shows the group list, and opens a collapsed deck, the same on the first draw as on the next",
            paths: /^cases\[\d\]\.firstRedraw\[0\](\.folders\[\d\])?\.(classCollapsed|iconCollapsed|childrenInlineDisplay|folderInlineDisplay)$/,
        },
    ],
    userFlow: [
        WORDING,
        {
            fix: "bug 1: expanding New is remembered, and the redraw for the open note keeps it open with its list showing (bug 2)",
            paths: /^steps\[[123]\]\.(activeFoldersByDeck\.#review\[2\]|decks\[0\]\.folders\[0\]\.childrenInlineDisplay)$/,
        },
    ],
};
