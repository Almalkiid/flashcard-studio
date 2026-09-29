import { ImportHost } from "src/import-export/anki-importer";

/** An in-memory vault for the importer: notes and binary files by path. */
export class FakeHost implements ImportHost {
    texts = new Map<string, string>();
    binaries = new Map<string, Uint8Array>();
    folders = new Set<string>();
    /** Every write, in order, to check what was done and in which order. */
    log: string[] = [];

    async exists(path: string): Promise<boolean> {
        return this.texts.has(path) || this.binaries.has(path) || this.folders.has(path);
    }

    async ensureFolder(path: string): Promise<void> {
        const parts = path.split("/").filter((part) => part !== "");
        for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
    }

    async readText(path: string): Promise<string> {
        const text = this.texts.get(path);
        if (text === undefined) throw new Error(`No note at ${path}`);
        return text;
    }

    async createText(path: string, text: string): Promise<void> {
        if (this.texts.has(path)) throw new Error(`${path} exists`);
        this.log.push(`create ${path}`);
        this.texts.set(path, text);
    }

    async processText(path: string, transform: (text: string) => string): Promise<void> {
        this.log.push(`process ${path}`);
        this.texts.set(path, transform(await this.readText(path)));
    }

    async readBinary(path: string): Promise<Uint8Array> {
        const data = this.binaries.get(path);
        if (data === undefined) throw new Error(`No file at ${path}`);
        return data;
    }

    async createBinary(path: string, data: Uint8Array): Promise<void> {
        if (this.binaries.has(path)) throw new Error(`${path} exists`);
        this.log.push(`create ${path}`);
        this.binaries.set(path, data);
    }

    async listNotes(folder: string): Promise<string[]> {
        return Array.from(this.texts.keys()).filter((path) => path.startsWith(folder + "/"));
    }
}
