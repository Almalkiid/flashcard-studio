import "moment/locale/ar";
import { MetadataCache } from "obsidian";

import { VaultNoteFile } from "src/data/data-structures/file/vault-note";
import { moment } from "src/utils/moment-en";

// Importing the Arabic locale file makes Arabic the app language; start from English
beforeAll(() => {
    moment.locale("en");
});

function noteWithFrontmatter(frontmatter: Record<string, unknown>): VaultNoteFile {
    // Only the metadata cache matters to reading the schedule
    const metadataCache = { getFileCache: () => ({ frontmatter }) } as unknown as MetadataCache;
    return new VaultNoteFile(undefined, metadataCache, undefined, undefined);
}

async function dueDate(srDue: string): Promise<string> {
    const schedule = await noteWithFrontmatter({
        "sr-due": srDue,
        "sr-interval": 10,
        "sr-ease": 250,
    }).getNoteSchedule();
    return schedule.dueDate.format("YYYY-MM-DD HH:mm");
}

describe("the due date in a note's frontmatter", () => {
    // Notes written by older versions hold all three shapes, and lenient reading keeps the rest working
    test.each([
        ["2023-09-06", "2023-09-06 00:00"],
        ["06-09-2023", "2023-09-06 00:00"],
        ["Wed Sep 06 2023", "2023-09-06 00:00"],
        ["2023-9-6", "2023-09-06 00:00"],
    ])("%j is read as %s", async (text, expected) => {
        expect(await dueDate(text)).toBe(expected);
    });

    test("it is read the same when Obsidian runs in Arabic", async () => {
        moment.locale("ar");
        try {
            expect(await dueDate("Wed Sep 06 2023")).toBe("2023-09-06 00:00");
            expect(await dueDate("2023-09-06")).toBe("2023-09-06 00:00");
        } finally {
            moment.locale("en");
        }
    });

    test("a note without all three fields has no schedule", async () => {
        expect(await noteWithFrontmatter({ "sr-due": "2023-09-06" }).getNoteSchedule()).toBeNull();
    });
});
