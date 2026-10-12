import { normalizePath, TFile, Vault } from "obsidian";

import { LogFileAdapter } from "src/data/review-log/review-log-store";

/**
 * Review log file access through the Obsidian vault API, so writes go through Obsidian's file handling and sync.
 */
export class ObsidianLogAdapter implements LogFileAdapter {
    private readonly vault: Vault;

    constructor(vault: Vault) {
        this.vault = vault;
    }

    async read(path: string): Promise<string | null> {
        const file = this.vault.getFileByPath(normalizePath(path));
        return file ? this.vault.read(file) : null;
    }

    async append(path: string, text: string): Promise<void> {
        const normalized = normalizePath(path);
        const file = this.vault.getFileByPath(normalized);
        if (file) {
            await this.vault.append(file, text);
            return;
        }
        await this.ensureFolder(normalized.substring(0, normalized.lastIndexOf("/")));
        await this.vault.create(normalized, text);
    }

    async process(path: string, fn: (text: string) => string): Promise<void> {
        const file = this.vault.getFileByPath(normalizePath(path));
        if (file) await this.vault.process(file, fn);
    }

    async list(folder: string): Promise<string[]> {
        const dir = this.vault.getFolderByPath(normalizePath(folder));
        if (!dir) return [];
        return dir.children
            .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
            .map((file) => file.path);
    }

    private async ensureFolder(folder: string): Promise<void> {
        if (folder.length === 0) return;
        let current = "";
        for (const part of folder.split("/")) {
            current = current ? `${current}/${part}` : part;
            if (!this.vault.getFolderByPath(current)) {
                await this.vault.createFolder(current);
            }
        }
    }
}
