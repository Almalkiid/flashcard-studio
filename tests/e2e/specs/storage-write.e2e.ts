import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import { before, describe, it } from "mocha";
import * as path from "path";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
// The note writes of the plugin rely on how Obsidian's `Vault.process` behaves; this checks that in the real app.

const NOTE = "CIA/Part1/Deck.md";

function noteOnDisk(): string {
    return fs.readFileSync(path.join(obsidianPage.getVaultPath(), NOTE), "utf8");
}

describe("note writes", function () {
    before(async function () {
        await obsidianPage.resetVault();
        await browser.waitUntil(() =>
            browser.executeObsidian(
                ({ app }, notePath) => app.vault.getFileByPath(notePath) !== null,
                NOTE,
            ),
        );
    });

    it("process writes what the callback returns", async function () {
        const before = noteOnDisk();
        await browser.executeObsidian(async ({ app }, notePath) => {
            const file = app.vault.getFileByPath(notePath);
            await app.vault.process(file, (text) => text + "\nwritten by process\n");
        }, NOTE);
        await browser.waitUntil(() => noteOnDisk() === before + "\nwritten by process\n");
    });

    it("an error thrown by the callback writes nothing and comes back as a rejection", async function () {
        const before = noteOnDisk();
        const outcome = await browser.executeObsidian(async ({ app }, notePath) => {
            const file = app.vault.getFileByPath(notePath);
            let modified = 0;
            const ref = app.vault.on("modify", () => modified++);
            let rejected = "";
            try {
                await app.vault.process(file, () => {
                    throw new Error("nothing to write");
                });
            } catch (error) {
                rejected = (error as Error).message;
            }
            // Give a stray write the time to be reported
            await new Promise((resolve) => window.setTimeout(resolve, 500));
            app.vault.offref(ref);
            return { rejected, modified };
        }, NOTE);

        expect(outcome).toEqual({ rejected: "nothing to write", modified: 0 });
        expect(noteOnDisk()).toBe(before);
    });
});
