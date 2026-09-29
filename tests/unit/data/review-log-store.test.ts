import {
    parseEntryLine,
    ReviewLogEntry,
    serializeEntry,
} from "src/data/review-log/review-log-entry";
import { LogFileAdapter, ReviewLogStore } from "src/data/review-log/review-log-store";

class MemoryAdapter implements LogFileAdapter {
    files = new Map<string, string>();

    async read(path: string): Promise<string | null> {
        return this.files.get(path) ?? null;
    }

    async append(path: string, text: string): Promise<void> {
        this.files.set(path, (this.files.get(path) ?? "") + text);
    }

    async process(path: string, fn: (text: string) => string): Promise<void> {
        this.files.set(path, fn(this.files.get(path) ?? ""));
    }

    async list(folder: string): Promise<string[]> {
        return [...this.files.keys()].filter(
            (key) => key.startsWith(folder + "/") && key.endsWith(".md"),
        );
    }
}

function entry(t: number, c = "abc123", r: 0 | 1 | 2 | 3 | 4 = 3): ReviewLogEntry {
    return { t, c, r, k: 1, ivl: 3, li: 1, ms: 5000, dk: "CIA/Part1", f: "CIA/Part1/x.md" };
}

const SEP_15 = new Date(2026, 8, 15, 10).getTime();
const OCT_02 = new Date(2026, 9, 2, 10).getTime();

describe("ReviewLogStore", () => {
    test("append creates the header once and one line per entry", async () => {
        const adapter = new MemoryAdapter();
        const store = new ReviewLogStore(adapter, "Flashcard Studio/Review log", "mac-3f9a");
        await store.append(entry(SEP_15));
        await store.append(entry(SEP_15 + 1));

        const text = adapter.files.get("Flashcard Studio/Review log/2026-09 mac-3f9a.md");
        expect(text.startsWith("---\nflashcard-studio: review-log\ndevice: mac-3f9a\n---\n")).toBe(
            true,
        );
        expect(text.match(/```srlog/g)).toHaveLength(1);
        expect(ReviewLogStore.parseFile(text)).toHaveLength(2);
        expect(store.deviceId).toBe("mac-3f9a");
    });

    test("months shard into separate files", async () => {
        const adapter = new MemoryAdapter();
        const store = new ReviewLogStore(adapter, "L", "d1");
        await store.append(entry(SEP_15));
        await store.append(entry(OCT_02));
        expect([...adapter.files.keys()].sort()).toEqual(["L/2026-09 d1.md", "L/2026-10 d1.md"]);
    });

    test("readMonths merges devices and sorts by time", async () => {
        const adapter = new MemoryAdapter();
        await new ReviewLogStore(adapter, "L", "phone").append(entry(SEP_15 + 5, "bbbbbb"));
        await new ReviewLogStore(adapter, "L", "mac").append(entry(SEP_15, "aaaaaa"));
        await new ReviewLogStore(adapter, "L", "mac").append(entry(OCT_02, "cccccc"));

        const september = await new ReviewLogStore(adapter, "L", "mac").readMonths(["2026-09"]);
        expect(september.map((e) => e.c)).toEqual(["aaaaaa", "bbbbbb"]);
    });

    test("remove deletes only the matching line from this device's file", async () => {
        const adapter = new MemoryAdapter();
        const store = new ReviewLogStore(adapter, "L", "d1");
        const first = entry(SEP_15);
        const second = entry(SEP_15 + 1, "zzzzzz");
        await store.append(first);
        await store.append(second);

        expect(await store.remove(second)).toBe(true);
        const remaining = ReviewLogStore.parseFile(adapter.files.get("L/2026-09 d1.md"));
        expect(remaining.map((e) => e.c)).toEqual(["abc123"]);
        expect(await store.remove(second)).toBe(false);
    });

    test("remove on a missing file returns false", async () => {
        const store = new ReviewLogStore(new MemoryAdapter(), "L", "d1");
        expect(await store.remove(entry(SEP_15))).toBe(false);
    });

    test("malformed and partial lines are skipped", () => {
        const text =
            ReviewLogStore.header("d") +
            serializeEntry(entry(1)) +
            '\n{"t":2,"c":\n' +
            "garbage\n\n" +
            serializeEntry(entry(3)) +
            "\n";
        expect(ReviewLogStore.parseFile(text).map((e) => e.t)).toEqual([1, 3]);
    });

    test("a file without the srlog fence has no entries", () => {
        expect(ReviewLogStore.parseFile("just a note\n" + serializeEntry(entry(1)))).toEqual([]);
    });

    test("readAll reads every review log in the folder and ignores other notes", async () => {
        const adapter = new MemoryAdapter();
        const store = new ReviewLogStore(adapter, "L", "d1");
        await store.append(entry(SEP_15));
        await store.append(entry(OCT_02));
        adapter.files.set("L/notes.md", "hello\n```srlog\n" + serializeEntry(entry(9)) + "\n");
        expect((await store.readAll()).map((e) => e.t)).toEqual([SEP_15, OCT_02]);
    });

    test("fileFor pads the month", () => {
        const store = new ReviewLogStore(new MemoryAdapter(), "L", "d1");
        expect(store.fileFor(new Date(2026, 0, 3).getTime())).toBe("L/2026-01 d1.md");
    });
});

describe("review log entries", () => {
    test("serialize uses a fixed key order and omits undefined keys", () => {
        const e: ReviewLogEntry = {
            f: "x.md",
            dk: "D",
            ms: 1200,
            li: 0,
            ivl: 0.0069,
            n: 1,
            k: 0,
            r: 3,
            c: "abc123",
            t: 5,
            s: 2.3,
            d: 5.1,
        };
        expect(serializeEntry(e)).toBe(
            '{"t":5,"c":"abc123","r":3,"k":0,"n":1,"ivl":0.0069,"li":0,"s":2.3,"d":5.1,"ms":1200,"dk":"D","f":"x.md"}',
        );
        expect(serializeEntry(entry(7))).not.toContain('"n"');
    });

    test("parse round-trips", () => {
        const e = entry(SEP_15);
        expect(parseEntryLine(serializeEntry(e))).toEqual(e);
    });

    test.each([
        ['{"t":"x","c":"a","r":3,"k":1,"ivl":1,"li":0,"ms":1,"dk":"","f":""}'],
        ['{"t":1,"c":"a","r":7,"k":1,"ivl":1,"li":0,"ms":1,"dk":"","f":""}'],
        ['{"t":1,"c":"a","r":3,"k":9,"ivl":1,"li":0,"ms":1,"dk":"","f":""}'],
        ['{"t":1,"c":5,"r":3,"k":1,"ivl":1,"li":0,"ms":1,"dk":"","f":""}'],
        ['{"t":1,"c":"a","r":3,"k":1,"ivl":1,"li":0,"ms":1,"dk":""}'],
        ['{"t":1,"c":"a","r":3,"k":1,"ivl":1,"li":0,"ms":1,"dk":"","f":"","n":2}'],
        ['{"t":1,"c":"a","r":3,"k":1,"ivl":1,"li":0,"ms":1,"dk":"","f":"","s":"x"}'],
        ["[1,2,3]"],
        ["null"],
        [""],
    ])("parseEntryLine rejects %s", (line: string) => {
        expect(parseEntryLine(line)).toBeNull();
    });
});
