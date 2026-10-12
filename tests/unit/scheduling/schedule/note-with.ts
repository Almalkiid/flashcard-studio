import type { FileManager, MetadataCache, TFile, Vault } from "obsidian";

import { VaultNoteFile } from "src/data/data-structures/file/vault-note";

export type Frontmatter = Record<string, unknown>;
export type Pairs = [string, unknown][];

/** The note file over a frontmatter object that the metadata cache serves and the file manager edits in place. */
export function noteWith(frontmatter: Frontmatter | undefined): {
    note: VaultNoteFile;
    current: () => Pairs;
} {
    const state: { frontmatter: Frontmatter | undefined } = {
        frontmatter:
            frontmatter === undefined
                ? undefined
                : (JSON.parse(JSON.stringify(frontmatter)) as Frontmatter),
    };
    const metadataCache = {
        getFileCache: () =>
            state.frontmatter === undefined ? null : { frontmatter: state.frontmatter },
    };
    const fileManager = {
        processFrontMatter: (_file: TFile, edit: (frontmatter: Frontmatter) => void) => {
            state.frontmatter ??= {};
            edit(state.frontmatter);
            return Promise.resolve();
        },
    };
    const note = new VaultNoteFile(
        {} as Vault,
        metadataCache as unknown as MetadataCache,
        fileManager as unknown as FileManager,
        { path: "note.md", basename: "note" } as never,
    );
    return { note, current: () => Object.entries(state.frontmatter ?? {}) };
}
