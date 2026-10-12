import { readdirSync, readFileSync } from "fs";
import type { FileManager, MetadataCache, TagCache, TFile, Vault } from "obsidian";
import * as path from "path";

import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore, DataStoreAlgorithm, type IFileModifier } from "src/data/data-store/store";
import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { VaultNoteFile } from "src/data/data-structures/file/vault-note";
import { StudioSettings } from "src/data/settings-model";
import { VaultIndex } from "src/data/vault-core";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { FsrsCardScheduler } from "src/scheduling/fsrs/fsrs-card-scheduler";
import { ActiveScheduler, SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { ObsidianVaultNoteLinkInfoFinder } from "src/scheduling/sm2/note-graph";
import { Sm2Scheduler } from "src/scheduling/sm2/sm2-scheduler";
import { TextDirection } from "src/utils/text";

export type Frontmatter = Record<string, unknown>;

/** Reads the `key: value` lines of a note's frontmatter the way a metadata cache serves them (numbers as numbers). */
function frontmatterOf(text: string): { frontmatter: Frontmatter | undefined; bodyStart: number } {
    const lines = text.split("\n");
    if (lines[0] !== "---") return { frontmatter: undefined, bodyStart: 0 };
    const end = lines.indexOf("---", 1);
    if (end < 0) return { frontmatter: undefined, bodyStart: 0 };
    const frontmatter: Frontmatter = {};
    for (const line of lines.slice(1, end)) {
        const match = /^([\w-]+):\s*(.*)$/.exec(line);
        if (match)
            frontmatter[match[1]] = /^-?\d+(\.\d+)?$/.test(match[2]) ? Number(match[2]) : match[2];
    }
    return { frontmatter, bodyStart: end + 1 };
}

/** Every `#tag` in the body of a note, with the positions a metadata cache gives. */
function tagsOf(text: string, bodyStart: number): TagCache[] {
    const tags: TagCache[] = [];
    let offset = 0;
    text.split("\n").forEach((line, lineNumber) => {
        if (lineNumber >= bodyStart) {
            for (const match of line.matchAll(/(^|\s)(#[\w/-]+)/g)) {
                const col = match.index + match[1].length;
                const start = { line: lineNumber, col, offset: offset + col };
                const end = {
                    line: lineNumber,
                    col: col + match[2].length,
                    offset: offset + col + match[2].length,
                };
                tags.push({ tag: match[2], position: { start, end } });
            }
        }
        offset += line.length + 1;
    });
    return tags;
}

/** A note file over a `FakeVault`: the real note-file code, with tags read from the text instead of Obsidian. */
export class FakeNoteFile extends VaultNoteFile {
    constructor(
        private readonly owner: FakeVault,
        filePath: string,
    ) {
        super(owner.vault, owner.metadataCache, owner.fileManager, owner.tfileOf(filePath));
    }

    getAllTagsFromCache(): string[] {
        return [...new Set(this.getAllTagsFromText().map((tag) => tag.tag))];
    }

    get text(): string {
        return this.owner.texts.get(this.path);
    }
}

/**
 * Markdown files in memory, with a metadata cache (frontmatter, tags and resolved links read from the text), a vault
 * and a file manager that serve the real note-file code. Not Obsidian: just enough for the scan and a review.
 */
export class FakeVault {
    readonly texts = new Map<string, string>();
    readonly frontmatter = new Map<string, Frontmatter>();
    private readonly tfiles = new Map<string, TFile>();

    constructor(files: Record<string, string>) {
        for (const [filePath, text] of Object.entries(files)) {
            this.texts.set(filePath, text);
            const { frontmatter } = frontmatterOf(text);
            if (frontmatter) this.frontmatter.set(filePath, frontmatter);
        }
        const cache = {
            getFileCache: (file: TFile) => {
                const text = this.texts.get(file.path);
                const { bodyStart } = frontmatterOf(text);
                return {
                    frontmatter: this.frontmatter.get(file.path),
                    tags: tagsOf(text, bodyStart),
                };
            },
        };
        // Obsidian lists a link only when it leads to a file that exists
        Object.defineProperty(cache, "resolvedLinks", { get: () => this.resolvedLinks() });
        this.metadataCache = cache as unknown as MetadataCache;
    }

    /** The markdown files of one of the repo's test vaults (`tests/vaults/<name>`). */
    static fromTestVault(name: string): FakeVault {
        const dir = path.join(__dirname, "../../../vaults", name);
        const files: Record<string, string> = {};
        for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
            if (entry.endsWith(".md")) files[entry] = readFileSync(path.join(dir, entry), "utf8");
        }
        return new FakeVault(files);
    }

    tfileOf(filePath: string): TFile {
        if (!this.tfiles.has(filePath)) {
            const basename = path.basename(filePath, ".md");
            this.tfiles.set(filePath, { path: filePath, basename } as never);
        }
        return this.tfiles.get(filePath);
    }

    readonly vault = {
        read: (file: TFile) => Promise.resolve(this.texts.get(file.path)),
        cachedRead: (file: TFile) => Promise.resolve(this.texts.get(file.path)),
        modify: (file: TFile, text: string) => {
            this.texts.set(file.path, text);
            this.links = null;
            return Promise.resolve();
        },
        process: (file: TFile, edit: (text: string) => string) => {
            const text = edit(this.texts.get(file.path));
            this.texts.set(file.path, text);
            this.links = null;
            return Promise.resolve(text);
        },
    } as unknown as Vault;

    readonly fileManager = {
        processFrontMatter: (file: TFile, edit: (frontmatter: Frontmatter) => void) => {
            if (!this.frontmatter.has(file.path)) this.frontmatter.set(file.path, {});
            edit(this.frontmatter.get(file.path));
            return Promise.resolve();
        },
    } as unknown as FileManager;

    readonly metadataCache: MetadataCache;

    /** The notes in path order. */
    files(): FakeNoteFile[] {
        return [...this.texts.keys()].sort().map((filePath) => new FakeNoteFile(this, filePath));
    }

    file(filePath: string): FakeNoteFile {
        return new FakeNoteFile(this, filePath);
    }

    private links: Record<string, Record<string, number>> | null = null;

    /** The `resolvedLinks` of the cache: for each note, the notes it links to and how often. */
    private resolvedLinks(): Record<string, Record<string, number>> {
        if (this.links !== null) return this.links;
        const byBasename = new Map([...this.texts.keys()].map((p) => [path.basename(p, ".md"), p]));
        const result: Record<string, Record<string, number>> = {};
        for (const [source, text] of this.texts) {
            result[source] = {};
            for (const match of text.matchAll(/\[\[([^\]|#]+)/g)) {
                const target = byBasename.get(match[1]);
                if (target !== undefined)
                    result[source][target] = (result[source][target] ?? 0) + 1;
            }
        }
        this.links = result;
        return result;
    }
}

export interface CoreSetup {
    core: VaultIndex;
    queue: NoteReviewQueue;
    settings: StudioSettings;
}

/** Installs the data store and the scheduler the core works through, and builds a core over the vault. */
export function makeCore(vault: FakeVault, settings: StudioSettings): CoreSetup {
    DataStore.instance = new NotesDataStore(settings, {} as IFileModifier);
    DataStoreAlgorithm.instance = new Sm2NoteStore(settings);
    ActiveScheduler.instance =
        settings.algorithm === SchedulerKind.FSRS
            ? new FsrsCardScheduler(settings)
            : new Sm2Scheduler(settings);
    const queue = new NoteReviewQueue();
    const core = new VaultIndex(
        new BuriedCards(null, settings, []),
        new ObsidianVaultNoteLinkInfoFinder(vault.metadataCache),
        settings,
        () => Promise.resolve(),
        queue,
        TextDirection.Ltr,
    );
    return { core, queue, settings };
}

/** A full scan: the notes in path order, then the page ranks, deck hierarchies and histograms. */
export async function scan(vault: FakeVault, core: VaultIndex): Promise<void> {
    core.loadInitialStateOfCore();
    for (const file of vault.files()) await core.processFile(file);
    await core.finalizeLoad();
}
