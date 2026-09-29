import { App, normalizePath, TFile, Vault } from "obsidian";

import { ExportMediaHost } from "src/import-export/anki-exporter";
import { ImportHost } from "src/import-export/anki-importer";
import { joinPath } from "src/import-export/deck-note";

/** Files that can be imported: Anki packages and text files. */
export const IMPORTABLE_EXTENSIONS = ["apkg", "colpkg", "txt", "csv", "tsv"];

/** A copy of the bytes as an ArrayBuffer of exactly their length, which is what the vault writes. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** The vault operations of an import and an export, on Obsidian's vault, using only what works on mobile too. */
export class ObsidianVaultHost implements ImportHost, ExportMediaHost {
    private readonly vault: Vault;

    constructor(private readonly app: App) {
        this.vault = app.vault;
    }

    exists(path: string): Promise<boolean> {
        return this.vault.adapter.exists(normalizePath(path));
    }

    async ensureFolder(path: string): Promise<void> {
        const parts = normalizePath(path)
            .split("/")
            .filter((part) => part !== "");
        for (let i = 1; i <= parts.length; i++) {
            const folder = parts.slice(0, i).join("/");
            if (!(await this.vault.adapter.exists(folder))) {
                try {
                    await this.vault.createFolder(folder);
                } catch (error) {
                    // Made in the meantime, by a sync for example
                    if (!(await this.vault.adapter.exists(folder))) throw error;
                }
            }
        }
    }

    readText(path: string): Promise<string> {
        return this.vault.adapter.read(normalizePath(path));
    }

    async createText(path: string, text: string): Promise<void> {
        await this.vault.create(normalizePath(path), text);
    }

    async processText(path: string, transform: (text: string) => string): Promise<void> {
        const file = this.vault.getFileByPath(normalizePath(path));
        if (file === null) throw new Error(`No note at ${path}`);
        await this.vault.process(file, transform);
    }

    async readBinary(path: string): Promise<Uint8Array> {
        return new Uint8Array(await this.vault.adapter.readBinary(normalizePath(path)));
    }

    async createBinary(path: string, data: Uint8Array): Promise<void> {
        await this.vault.createBinary(normalizePath(path), toArrayBuffer(data));
    }

    listNotes(folder: string): Promise<string[]> {
        const prefix = normalizePath(folder) + "/";
        return Promise.resolve(
            this.vault
                .getMarkdownFiles()
                .map((file) => file.path)
                .filter((path) => path.startsWith(prefix)),
        );
    }

    /** The vault path of the file a link in a note points at, or null. */
    resolve(target: string, fromPath: string): string | null {
        const linked = this.app.metadataCache.getFirstLinkpathDest(target, fromPath);
        if (linked !== null) return linked.path;
        // A path written relative to the note, such as ../attachments/a.png
        const folder = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
        const relative = this.vault.getAbstractFileByPath(normalizePath(joinPath(folder, target)));
        return relative instanceof TFile ? relative.path : null;
    }

    read(path: string): Promise<Uint8Array> {
        return this.readBinary(path);
    }

    /**
     * Anki packages and text files in the vault. Obsidian's file list leaves out files of a kind it does not know,
     * so the folders are walked, one folder at a time so that a large vault does not stall a phone.
     */
    async findImportableFiles(limit = 200): Promise<string[]> {
        const found: string[] = [];
        const queue = [""];
        let visited = 0;
        while (queue.length > 0 && found.length < limit && visited < 5000) {
            const folder = queue.shift();
            visited++;
            let listing;
            try {
                listing = await this.vault.adapter.list(folder);
            } catch {
                continue;
            }
            for (const file of listing.files) {
                const extension = file.split(".").pop()?.toLowerCase() ?? "";
                if (IMPORTABLE_EXTENSIONS.includes(extension)) found.push(file);
            }
            // Folders that start with a dot hold settings and caches, not the user's files
            for (const sub of listing.folders) {
                if (!sub.split("/").pop()?.startsWith(".")) queue.push(sub);
            }
        }
        return found.sort((a, b) => a.localeCompare(b));
    }

    /**
     * Waits until Obsidian has read the given notes' tags, or until the timeout. A note that was just created has
     * none in the cache yet, and the decks are made from tags.
     */
    async waitForIndexing(paths: string[], timeoutMs = 10000): Promise<void> {
        const started = Date.now();
        const pending = (): boolean =>
            paths.some((path) => {
                const file = this.vault.getFileByPath(path);
                return file === null || this.app.metadataCache.getFileCache(file) === null;
            });
        while (pending() && Date.now() - started < timeoutMs) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        }
    }

    /** A path that is free: the given one, or with a number before the extension. */
    async freePath(path: string): Promise<string> {
        const normalized = normalizePath(path);
        const dot = normalized.lastIndexOf(".");
        const stem = dot > normalized.lastIndexOf("/") ? normalized.slice(0, dot) : normalized;
        const extension = dot > normalized.lastIndexOf("/") ? normalized.slice(dot) : "";
        let candidate = normalized;
        for (let number = 2; await this.vault.adapter.exists(candidate); number++) {
            candidate = `${stem} ${number}${extension}`;
        }
        return candidate;
    }
}
