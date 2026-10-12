import type { FileManager, MetadataCache, TFile, Vault } from "obsidian";

import { VaultNoteFile } from "./api";

/** A vault whose `process` works like Obsidian's: the callback gets the text and what it returns is written. */
function noteIn(text: string): { note: VaultNoteFile; text: () => string; writes: () => number } {
    let current = text;
    let writes = 0;
    const vault = {
        process: (_file: TFile, edit: (text: string) => string) => {
            current = edit(current);
            writes++;
            return Promise.resolve(current);
        },
    } as unknown as Vault;
    const note = new VaultNoteFile(
        vault,
        {} as MetadataCache,
        {} as FileManager,
        {
            path: "n.md",
        } as never,
    );
    return { note, text: () => current, writes: () => writes };
}

describe("edit", () => {
    test("writes what the callback gives, and says so", async () => {
        const { note, text } = noteIn("a");
        expect(await note.edit((old) => old + "b")).toBe(true);
        expect(text()).toBe("ab");
    });

    test("writes nothing when the callback gives null, and says so", async () => {
        const { note, text, writes } = noteIn("a");
        expect(await note.edit(() => null)).toBe(false);
        expect(text()).toBe("a");
        expect(writes()).toBe(0);
    });

    test("passes on an error of the callback", async () => {
        const { note } = noteIn("a");
        await expect(
            note.edit(() => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
    });
});
