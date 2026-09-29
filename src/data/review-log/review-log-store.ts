import {
    parseEntryLine,
    ReviewLogEntry,
    serializeEntry,
} from "src/data/review-log/review-log-entry";

/**
 * The file operations the review log needs. Implemented on the Obsidian vault in production and in memory in tests.
 */
export interface LogFileAdapter {
    /** Returns the file's text, or null when it does not exist. */
    read(path: string): Promise<string | null>;
    /** Appends text, creating the file (and its folders) when missing. */
    append(path: string, text: string): Promise<void>;
    /** Rewrites an existing file atomically. */
    process(path: string, fn: (text: string) => string): Promise<void>;
    /** Lists the markdown files directly inside a folder; empty when the folder is missing. */
    list(folder: string): Promise<string[]>;
}

const FENCE_OPEN = "```srlog";
const FRONTMATTER_MARKER = "cardwright: review-log";

/**
 * Append-only review history, one file per device per month: `<folder>/<YYYY-MM> <device>.md`.
 *
 * Each device only ever writes its own files, so syncing never has two devices editing the same file. The files are
 * markdown so every sync service carries them, and the entries sit inside an open `srlog` code fence so Obsidian does
 * not index tags or links that appear in paths.
 */
export class ReviewLogStore {
    private readonly adapter: LogFileAdapter;
    private readonly folder: string;
    private readonly _deviceId: string;

    constructor(adapter: LogFileAdapter, folder: string, deviceId: string) {
        this.adapter = adapter;
        this.folder = folder.replace(/\/+$/, "");
        this._deviceId = deviceId;
    }

    get deviceId(): string {
        return this._deviceId;
    }

    static header(deviceId: string): string {
        return (
            `---\n${FRONTMATTER_MARKER}\ndevice: ${deviceId}\n---\n` +
            "Review history written by Cardwright. One JSON object per line. Do not edit.\n\n" +
            `${FENCE_OPEN}\n`
        );
    }

    /**
     * Extracts the entries from a log file's text, skipping anything malformed.
     */
    static parseFile(text: string): ReviewLogEntry[] {
        const lines = text.split("\n");
        const fenceIndex = lines.findIndex((line) => line.trim() === FENCE_OPEN);
        if (fenceIndex < 0) return [];

        const entries: ReviewLogEntry[] = [];
        for (const line of lines.slice(fenceIndex + 1)) {
            const trimmed = line.trim();
            if (trimmed.length === 0 || trimmed === "```") continue;
            const entry = parseEntryLine(trimmed);
            if (entry !== null) entries.push(entry);
        }
        return entries;
    }

    private static monthKey(epochMs: number): string {
        const date = new Date(epochMs);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    fileFor(epochMs: number): string {
        return `${this.folder}/${ReviewLogStore.monthKey(epochMs)} ${this._deviceId}.md`;
    }

    async append(entry: ReviewLogEntry): Promise<void> {
        const path = this.fileFor(entry.t);
        const existing = await this.adapter.read(path);
        const line = serializeEntry(entry) + "\n";
        await this.adapter.append(
            path,
            existing === null ? ReviewLogStore.header(this._deviceId) + line : line,
        );
    }

    /**
     * Removes the most recent line equal to this entry from this device's file (used by undo).
     *
     * @returns Whether a line was removed.
     */
    async remove(entry: ReviewLogEntry): Promise<boolean> {
        const path = this.fileFor(entry.t);
        if ((await this.adapter.read(path)) === null) return false;

        const target = serializeEntry(entry);
        let removed = false;
        await this.adapter.process(path, (text) => {
            const lines = text.split("\n");
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim() === target) {
                    lines.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            return lines.join("\n");
        });
        return removed;
    }

    /**
     * Reads the entries of the given months (`YYYY-MM`) from every device, sorted by time.
     */
    async readMonths(months: string[]): Promise<ReviewLogEntry[]> {
        const prefixes = months.map((month) => `${this.folder}/${month} `);
        const paths = (await this.adapter.list(this.folder)).filter((path) =>
            prefixes.some((prefix) => path.startsWith(prefix)),
        );
        return this.readPaths(paths);
    }

    /**
     * Reads every review log file in the folder, from every device, sorted by time.
     */
    async readAll(): Promise<ReviewLogEntry[]> {
        return this.readPaths(await this.adapter.list(this.folder));
    }

    private async readPaths(paths: string[]): Promise<ReviewLogEntry[]> {
        const entries: ReviewLogEntry[] = [];
        for (const path of paths) {
            const text = await this.adapter.read(path);
            if (text === null || !ReviewLogStore.isReviewLog(text)) continue;
            entries.push(...ReviewLogStore.parseFile(text));
        }
        return entries.sort((a, b) => a.t - b.t);
    }

    private static isReviewLog(text: string): boolean {
        const end = text.indexOf("\n---", 3);
        return (
            text.startsWith("---\n") && end > 0 && text.slice(0, end).includes(FRONTMATTER_MARKER)
        );
    }
}
