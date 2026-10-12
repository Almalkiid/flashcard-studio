import type { CachedMetadata, FileManager, MetadataCache } from "obsidian";

import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { moment } from "src/utils/moment-en";

import { BuriedCards, VaultNoteFile } from "./api";
import { golden } from "./helpers";

interface Golden {
    questionContext: {
        id: string;
        headings: { heading: string; level: number; line: number }[];
        results: { cardLine: number; context: string[] }[];
        headingsInCacheAfter: string[];
    }[];
    noteSchedule: {
        id: string;
        frontmatter: Record<string, unknown> | null;
        result: { comment: string; interval: number | null; ease: number } | null;
    }[];
    noteIds: { setNoteScheduleWrote: Record<string, unknown> };
    tagsFromText: {
        id: string;
        cache: CachedMetadata | null;
        tags: { tag: string; line: number }[];
    }[];
    textDirection: { frontmatter: Record<string, unknown>; textDirection: string }[];
    frontmatterMap: { frontmatter: Record<string, unknown>; map: [string, string][] }[];
}

const data = golden<Golden>("file-and-list");

function noteOver(cache: Partial<CachedMetadata> | null, fileManager?: FileManager): VaultNoteFile {
    const metadataCache = { getFileCache: () => cache } as unknown as MetadataCache;
    return new VaultNoteFile(undefined, metadataCache, fileManager, { path: "n.md" } as never);
}

describe.each(data.questionContext)("heading context: $id", (row) => {
    test("the breadcrumbs, and the headings left in the cache", () => {
        const headings = row.headings.map((h) => ({
            heading: h.heading,
            level: h.level,
            position: {
                start: { line: h.line, col: 0, offset: 0 },
                end: { line: h.line, col: 0, offset: 0 },
            },
        }));
        const note = noteOver(row.id === "ctx-no-cache" ? null : { headings });
        for (const result of row.results)
            expect(note.getQuestionContext(result.cardLine)).toEqual(result.context);
        // The headings of the cache are Obsidian's and are not edited (the old reader stripped the footnote marks in them)
        expect(headings.map((h) => h.heading)).toEqual(row.headings.map((h) => h.heading));
    });
});

describe.each(data.noteSchedule)("note schedule: $id", (row) => {
    test("read from the frontmatter", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const note = noteOver(row.frontmatter === null ? {} : { frontmatter: row.frontmatter });
        const info = await note.getNoteSchedule();
        // A text that is not a number reads as no schedule (the old reader gave NaN)
        const result =
            info === null
                ? null
                : {
                      comment: info.formatScheduleAsComment(),
                      interval: info.interval,
                      ease: info.latestEase,
                  };
        const expected = row.id === "ns-bad-interval" ? null : row.result;
        expect(result).toEqual(expected);
    });
});

test("setNoteSchedule writes the three keys and leaves the others", async () => {
    const frontmatter: Record<string, unknown> = { existing: 1 };
    const fileManager = {
        processFrontMatter: (_file: unknown, edit: (f: Record<string, unknown>) => void) => {
            edit(frontmatter);
            return Promise.resolve();
        },
    } as unknown as FileManager;
    await noteOver({}, fileManager).setNoteSchedule(
        new Sm2State(moment("2026-10-20", "YYYY-MM-DD"), 12.5, 260),
    );
    expect(frontmatter).toEqual(data.noteIds.setNoteScheduleWrote);
});

describe.each(data.tagsFromText)("tags from the text: $id", (row) => {
    test("content tags with positions, frontmatter tags at line -1", () => {
        const tags = noteOver(row.cache).getAllTagsFromText();
        expect(tags.map((t) => ({ tag: t.tag, line: t.position.start.line }))).toEqual(row.tags);
    });
});

describe.each(data.textDirection)("text direction: $textDirection", (row) => {
    test("read from the frontmatter", () => {
        const direction = noteOver({ frontmatter: row.frontmatter }).getTextDirection();
        expect(["Unspecified", "Ltr", "Rtl"][direction]).toBe(row.textDirection);
    });
});

describe.each(data.frontmatterMap)("frontmatter map", (row) => {
    test("every value as text, a list as its first element", async () => {
        const map = await noteOver({ frontmatter: row.frontmatter }).getFrontmatter();
        expect([...map.entries()]).toEqual(row.map);
    });
});

describe("buried-cards list", () => {
    const expected = golden<{ buriedCards: Record<string, unknown> }>("file-and-list")
        .buriedCards as {
        afterAdd: string[];
        afterRemove: string[];
        sameDay: { list: string[]; saves: number; buryDate: string };
        newDay: { list: string[]; saves: number; buryDate: string };
    };

    test("add, remove, and the new study day", async () => {
        const { setupStaticDateProvider } = await import("src/utils/clock");
        setupStaticDateProvider("2026-10-12");
        const list: string[] = [];
        let saves = 0;
        const manager = {
            savePluginData: () => {
                saves++;
                return Promise.resolve();
            },
        };
        const postponed = new BuriedCards(manager as never, null, list);
        const question = (hash: string) => ({ questionText: { textHash: hash } }) as never;
        postponed.add(question("h1"));
        postponed.add(question("h2"));
        postponed.add(question("h2"));
        expect([...list]).toEqual(expected.afterAdd);
        expect(postponed.includes(question("h1"))).toBe(true);
        postponed.remove(question("h1"));
        expect([...list]).toEqual(expected.afterRemove);

        const same = { buryDate: "2026-10-12" };
        saves = 0;
        await postponed.clearIfNewDay(same as never);
        expect({ list: [...list], saves, buryDate: same.buryDate }).toEqual(expected.sameDay);
        const other = { buryDate: "2026-10-11" };
        await postponed.clearIfNewDay(other as never);
        expect({ list: [...list], saves, buryDate: other.buryDate }).toEqual(expected.newDay);
        await expect(new BuriedCards(null, null, []).write()).resolves.toBeUndefined();
    });
});
