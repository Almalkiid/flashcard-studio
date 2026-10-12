import {
    FileManager,
    getAllTags,
    HeadingCache,
    MetadataCache,
    TagCache,
    TFile,
    Vault,
} from "obsidian";

import { PREFERRED_DATE_FORMAT } from "src/data/formats";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { DateUtil, formatDate } from "src/utils/clock";
import { parseObsidianFrontmatterTag, TextDirection } from "src/utils/text";

/** Where the tags of the frontmatter are put in a list of tags: they have no position in the text. */
export const frontmatterTagPseudoLineNum = -1;
export const frontmatterTagPseudoCol = -1;
export const frontmatterTagPseudoOffset = -1;

/** A file with text in it. */
export interface INoteFile {
    path: string;
    basename: string;
    tfile: TFile;
    getFrontmatter(): Promise<Map<string, string>>;
    /** The tags Obsidian found in the note and its frontmatter, with the `#`; no positions. */
    getAllTagsFromCache(): string[];
    /** The tags in the text with their positions, then the tags of the frontmatter at line -1. */
    getAllTagsFromText(): TagCache[];
    getTextDirection(): TextDirection;
    read(): Promise<string>;
    /** The text as Obsidian last read it; for reading only. */
    cachedRead(): Promise<string>;
    write(content: string): Promise<void>;
    /**
     * Reads, changes and writes the text in one step, so an edit made elsewhere in between is not lost.
     *
     * @param change - Gets the text and gives the new text, or null to leave the file alone.
     * @returns Whether the file was written.
     */
    edit(change: (text: string) => string | null): Promise<boolean>;
}

/** A note that is scheduled itself, or whose cards are. */
export interface IVaultNoteFile extends INoteFile {
    setNoteSchedule(scheduleState: ScheduleState): Promise<void>;
    getNoteSchedule(): Promise<ScheduleState | null>;
    /** The headings above a line, from the top level down. */
    getQuestionContext(cardLine: number): string[];
}

/** A file of the vault, read through Obsidian's vault and metadata cache. */
export abstract class VaultTFile implements INoteFile {
    constructor(
        protected vault: Vault,
        protected metadataCache: MetadataCache,
        protected fileManager: FileManager,
        protected file: TFile,
    ) {}

    /** What Obsidian has parsed of the file so far; null while it has not got to it. */
    private get cached() {
        return this.metadataCache.getFileCache(this.file);
    }

    get path() {
        return this.file.path;
    }

    get basename() {
        return this.file.basename;
    }

    get tfile() {
        return this.file;
    }

    async getFrontmatter(): Promise<Map<string, string>> {
        // A list stands for its first item
        const firstOf = (value: unknown): string | number | boolean =>
            Array.isArray(value) && value.length > 0 ? (value[0] as string) : (value as string);
        const entries = Object.entries(this.cached?.frontmatter ?? {});
        return new Map(entries.map(([key, value]) => [key, String(firstOf(value))]));
    }

    getAllTagsFromCache(): string[] {
        const cache = this.cached;
        return (cache && getAllTags(cache)) || [];
    }

    getAllTagsFromText(): TagCache[] {
        const cache = this.cached;
        if (!cache) return [];
        const inText = cache.tags ?? [];

        // A note with frontmatter but no tags has no "tags" field (null when it is left empty): stop here, or the
        // missing value would be read as the text "undefined" and become a tag
        const declared = cache.frontmatter?.["tags"] as string | string[] | null | undefined;
        if (declared == null) return [...inText];

        // The cache holds either a list or a text; a list joins with commas, which is how it is split below
        const spot = {
            line: frontmatterTagPseudoLineNum,
            col: frontmatterTagPseudoCol,
            offset: frontmatterTagPseudoOffset,
        };
        const fromFrontmatter = parseObsidianFrontmatterTag(String(declared)).map((tag) => ({
            tag,
            position: { start: spot, end: spot },
        }));
        return [...inText, ...fromFrontmatter];
    }

    getTextDirection(): TextDirection {
        const declared = this.cached?.frontmatter?.["direction"] as string | number | undefined;
        if (!declared) return TextDirection.Unspecified;
        return /^rtl$/i.test(String(declared)) ? TextDirection.Rtl : TextDirection.Ltr;
    }

    read = (): Promise<string> => this.vault.read(this.file);

    cachedRead = (): Promise<string> => this.vault.cachedRead(this.file);

    write = (content: string): Promise<void> => this.vault.modify(this.file, content);

    async edit(change: (text: string) => string | null): Promise<boolean> {
        // `process` writes whatever the callback returns, and an error from the callback is the way to write nothing
        const refusal = new Error("Flashcard Studio: nothing to write");
        try {
            await this.vault.process(this.file, (text) => {
                const replacement = change(text);
                if (replacement === null) throw refusal;
                return replacement;
            });
            return true;
        } catch (error) {
            if (error === refusal) return false;
            throw error;
        }
    }
}

/** A note of the vault: its schedule is kept in the frontmatter, the schedules of its cards in the text. */
export class VaultNoteFile extends VaultTFile implements IVaultNoteFile {
    async getNoteSchedule(): Promise<ScheduleState | null> {
        const fields = await this.getFrontmatter();
        // The schedule-comment and frontmatter format shared with the Spaced Repetition plugin, kept so existing schedules carry over.
        const [rawDue, rawInterval, rawEase] = ["sr-due", "sr-interval", "sr-ease"].map((key) =>
            fields.get(key),
        );
        if (!rawDue || !rawInterval || !rawEase) return null;

        const due = DateUtil.dateStrToMoment(rawDue);
        const interval = parseFloat(rawInterval);
        const ease = parseFloat(rawEase);
        if (due.isValid() && !isNaN(interval) && !isNaN(ease)) {
            return new Sm2State(due, interval, ease);
        }
        // A schedule with a part that is not a date or a number cannot be answered; it reads as a note with no schedule
        console.warn(
            `Flashcard Studio: ignored a note schedule that cannot be read: sr-due "${rawDue}", sr-interval "${rawInterval}", sr-ease "${rawEase}" in ${this.path}`,
        );
        return null;
    }

    async setNoteSchedule(schedule: ScheduleState): Promise<void> {
        const due = formatDate(schedule.dueDateAsUnix, PREFERRED_DATE_FORMAT);
        await this.fileManager.processFrontMatter(this.file, (fields: Record<string, unknown>) => {
            Object.assign(fields, {
                "sr-due": due,
                "sr-interval": schedule.interval,
                "sr-ease": schedule.latestEase,
            });
        });
    }

    getQuestionContext(cardLine: number): string[] {
        const all: HeadingCache[] = this.metadataCache.getFileCache(this.file)?.headings ?? [];
        // The headings above the line that no later heading of the same level or higher has closed
        const open: HeadingCache[] = [];
        for (const heading of all.filter((h) => h.position.start.line <= cardLine)) {
            while (open.length > 0 && open[open.length - 1].level >= heading.level) open.pop();
            open.push(heading);
        }
        return open.map(({ heading }) => heading.replace(/\[\^\d+\]/gm, "").trim());
    }
}
