import type { TFile, Vault } from "obsidian";

import { NoteDataFileModifier } from "./api";

/** Markdown files in memory: `process` applies the edit to the text, `processFrontMatter` to a plain object. */
export class Files {
    texts = new Map<string, string>();
    frontmatter = new Map<string, Record<string, unknown>>();
    /** The notes `process` wrote, in order: an edit that gives up (throws) writes nothing, as in Obsidian. */
    writes: string[] = [];

    constructor(
        files: Record<string, string>,
        frontmatter: Record<string, Record<string, unknown>> = {},
    ) {
        for (const [name, text] of Object.entries(files)) this.texts.set(name, text);
        for (const [name, value] of Object.entries(frontmatter))
            this.frontmatter.set(
                name,
                JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
            );
    }

    tfile = (name: string): TFile => ({ path: name, name, extension: "md" }) as never;

    vault = {
        process: (file: TFile, edit: (text: string) => string) => {
            const text = edit(this.texts.get(file.path) ?? "");
            this.texts.set(file.path, text);
            this.writes.push(file.path);
            return Promise.resolve(text);
        },
        getMarkdownFiles: () => [...this.texts.keys()].sort().map(this.tfile),
    } as unknown as Vault;

    fileManager = {
        processFrontMatter: (file: TFile, edit: (frontmatter: Record<string, unknown>) => void) => {
            if (!this.frontmatter.has(file.path)) this.frontmatter.set(file.path, {});
            edit(this.frontmatter.get(file.path));
            return Promise.resolve();
        },
    };

    metadataCache = {
        getFileCache: (file: TFile) => ({ frontmatter: this.frontmatter.get(file.path) }),
    };

    modifier = new NoteDataFileModifier({
        app: {
            vault: this.vault,
            fileManager: this.fileManager,
            metadataCache: this.metadataCache,
        },
    } as never);
}
