import { browser, expect } from "@wdio/globals";
import { Collection } from "ankipack";
import * as fs from "fs";
import { afterEach, before, beforeEach, describe, it } from "mocha";
import * as path from "path";
import initSqlJs from "sql.js";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
//
// The Anki fixtures in tests/e2e/fixtures are made up (see build-fixtures.mjs): a package with a basic note, a
// reversed note, a note with an image and a sound, a cloze note and a note whose front has "::" in it, in the decks
// Spanish and Spanish::Verbs; and a text file in Anki's format with two decks.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const FIXTURES = path.resolve("tests/e2e/fixtures");
const IMPORT_FOLDER = "Flashcards/Imported";
// The size of the sql.js binary, which the plugin loads from inside main.js when an import or export starts
const SQL_WASM_BYTES = 658410;

interface PluginState {
    isInitialized?: boolean;
    dataManager: {
        osrCore: {
            reviewableDeckTree: {
                toDeckArray(): {
                    isRootDeck: boolean;
                    getTopicPath(): { path: string[] };
                    getDistinctRepItemCount(state: number, includeSubdecks: boolean): number;
                }[];
            };
        };
        settingsManager: { settings: { clozePatterns: string[] } };
    };
}
interface AppWithPlugins {
    plugins: {
        plugins: Record<string, PluginState | undefined>;
        disablePlugin(id: string): Promise<void>;
        enablePlugin(id: string): Promise<void>;
    };
}
interface WindowWithWasmLog {
    __srWasmLoads?: number[];
}

function vaultPath(relative: string): string {
    return path.join(obsidianPage.getVaultPath(), relative);
}

function readVault(relative: string): string {
    return fs.readFileSync(vaultPath(relative), "utf8");
}

function copyIntoVault(fixture: string, relative: string): void {
    fs.mkdirSync(path.dirname(vaultPath(relative)), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, fixture), vaultPath(relative));
}

/**
 * Presses a button in the page. In the emulated phone a driver click is sometimes refused or lands beside the
 * button: the driver computes points beyond the emulated screen, so the buttons here are pressed in the page.
 */
async function press(element: WebdriverIO.Element | ChainablePromiseElement): Promise<void> {
    // A chained element has to be resolved first, or the page is handed the promise and not the element
    const resolved = await element;
    await browser.execute((target: HTMLElement) => target.click(), resolved);
}

async function waitForPlugin(): Promise<void> {
    await browser.waitUntil(
        () =>
            browser.executeObsidian(({ app }, id) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                return plugin !== undefined && plugin.isInitialized === true;
            }, pluginId),
        { timeoutMsg: `plugin ${pluginId} did not finish initialising` },
    );
}

/** Counts the sql.js binaries that are handed to WebAssembly, from now on. */
async function watchWebAssembly(): Promise<void> {
    await browser.execute((wasmBytes: number) => {
        const target = window as unknown as WindowWithWasmLog;
        target.__srWasmLoads = [];
        const original = WebAssembly.instantiate.bind(WebAssembly) as (
            ...args: unknown[]
        ) => Promise<unknown>;
        (WebAssembly as unknown as { instantiate: unknown }).instantiate = (
            ...args: unknown[]
        ): Promise<unknown> => {
            const source = args[0] as { byteLength?: number };
            if (source?.byteLength === wasmBytes) target.__srWasmLoads?.push(wasmBytes);
            return original(...args);
        };
    }, SQL_WASM_BYTES);
}

async function sqlLoadCount(): Promise<number> {
    return browser.execute(
        () => ((window as unknown as WindowWithWasmLog).__srWasmLoads ?? []).length,
    );
}

/** The modal of an import or export command, once it shows. */
async function openModal(command: string): Promise<void> {
    await browser.waitUntil(async () => !(await browser.$(".sr-anki-modal").isExisting()), {
        timeoutMsg: "a dialog of an earlier step is still open",
    });
    await browser.executeObsidianCommand(`${pluginId}:${command}`);
    await browser.$(".sr-anki-modal").waitForDisplayed({ timeoutMsg: "the dialog never opened" });
    expect(await browser.$$(".sr-anki-modal")).toHaveLength(1);
}

async function closeModal(): Promise<void> {
    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await browser.$(".sr-anki-modal").isExisting()));
}

/**
 * Chooses an option of the nth dropdown in the dialog (in the order they are shown) by its value. Obsidian makes a
 * second, hidden select for each dropdown to measure its width, which is left out here.
 */
const DROPDOWNS = ".sr-anki-modal select.dropdown:not(.is-measuring)";

async function chooseOption(dropdown: number, value: string): Promise<void> {
    const selects = await browser.$$(DROPDOWNS);
    await selects[dropdown].selectByAttribute("value", value);
}

async function setText(index: number, value: string): Promise<void> {
    const inputs = await browser.$$(".sr-anki-modal input[type='text']");
    await inputs[index].setValue(value);
}

async function clickPrimary(): Promise<void> {
    const button = browser.$(".sr-anki-modal .sr-anki-buttons button.mod-cta");
    await button.waitForEnabled({ timeoutMsg: "the primary button never became enabled" });
    await press(button);
}

async function resultText(): Promise<string> {
    const headline = browser.$(".sr-anki-modal .sr-anki-result-headline");
    await headline.waitForDisplayed({
        timeout: 30000,
        timeoutMsg: "the dialog never showed a result",
    });
    const details = await browser.$$(".sr-anki-modal .sr-anki-result-details li");
    const lines = [await headline.getText()];
    for (const detail of details) lines.push(await detail.getText());
    return lines.join("\n");
}

async function errorText(): Promise<string> {
    const status = browser.$(".sr-anki-modal .sr-anki-status.sr-anki-error");
    await status.waitForDisplayed({
        timeout: 30000,
        timeoutMsg: "the dialog never showed an error",
    });
    return status.getText();
}

/** Waits for the dropdown of vault files to list a file (it is filled while the dialog is open). */
async function waitForVaultFile(file: string): Promise<void> {
    await browser.waitUntil(
        async () => (await browser.$(`.sr-anki-modal select option[value="${file}"]`)).isExisting(),
        { timeoutMsg: `the dialog never listed ${file}` },
    );
}

/** Imports a file that is in the vault with the dialog and returns what the dialog says. */
async function importVaultFile(file: string, targetFolder?: string): Promise<string> {
    await openModal("srs-import-anki-deck");
    await waitForVaultFile(file);
    await chooseOption(0, file);
    if (targetFolder !== undefined) await setText(0, targetFolder);
    await clickPrimary();
    const text = await resultText();
    await closeModal();
    return text;
}

async function deckCounts(): Promise<Record<string, number>> {
    return browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        const counts: Record<string, number> = {};
        const tree = plugin?.dataManager.osrCore.reviewableDeckTree;
        for (const deck of tree?.toDeckArray() ?? []) {
            if (!deck.isRootDeck)
                counts[deck.getTopicPath().path.join("/")] = deck.getDistinctRepItemCount(2, true);
        }
        return counts;
    }, pluginId);
}

/** The plugin keeps its settings between tests: start from the ones a new install has, without the curly cloze pattern. */
async function resetClozePatterns(): Promise<void> {
    await browser.executeObsidian(async ({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        const settings = plugin?.dataManager.settingsManager.settings as unknown as Record<
            string,
            unknown
        >;
        settings.clozePatterns = ["==[123;;]answer[;;hint]=="];
        settings.convertCurlyBracketsToClozes = false;
        await (plugin?.dataManager.settingsManager as unknown as { save(): Promise<void> }).save();
    }, pluginId);
}

async function screenshot(name: string): Promise<void> {
    const folder = process.env.E2E_SCREENSHOT_DIR;
    if (folder === undefined) return;
    const mode = (browser.requestedCapabilities as Record<string, { emulateMobile?: boolean }>)[
        "wdio:obsidianOptions"
    ].emulateMobile
        ? "mobile"
        : "desktop";
    fs.mkdirSync(folder, { recursive: true });
    await browser.saveScreenshot(path.join(folder, `${name}-${mode}.png`));
}

/** Opens the exported package with ankipack, in Node, apart from the plugin that wrote it. */
async function readPackage(relative: string) {
    const SQL = await initSqlJs();
    return Collection.open(new Uint8Array(fs.readFileSync(vaultPath(relative))), SQL);
}

// Runs first and without resetVault(), which removes the plugin's own files from the test vault: the plugin could not
// be enabled again after that.
describe("anki bridge startup", function () {
    before(async function () {
        await waitForPlugin();
        await watchWebAssembly();
    });

    it("loads sql.js only when an import starts, never while the plugin starts", async function () {
        // Restart the plugin with the counter in place: nothing may load the binary while it starts up
        await browser.executeObsidian(async ({ app }, id) => {
            const plugins = (app as unknown as AppWithPlugins).plugins;
            await plugins.disablePlugin(id);
            await plugins.enablePlugin(id);
        }, pluginId);
        await waitForPlugin();
        expect(await sqlLoadCount()).toEqual(0);

        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await importVaultFile("Anki/anki-synthetic.apkg");
        expect(await sqlLoadCount()).toEqual(1);
    });
});

describe("anki bridge", function () {
    before(async function () {
        await waitForPlugin();
    });

    beforeEach(async function () {
        await obsidianPage.resetVault();
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const file = app.vault.getFileByPath("CIA/Part1/Deck.md");
                    const tags = file ? app.metadataCache.getFileCache(file)?.tags : undefined;
                    return (tags ?? []).some((tag) => tag.tag === "#flashcards");
                }),
            { timeoutMsg: "Obsidian never indexed the restored fixture note" },
        );
    });

    afterEach(async function () {
        await browser.keys("Escape");
    });

    it("imports an Anki package from the vault: notes, media and decks", async function () {
        await resetClozePatterns();
        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await openModal("srs-import-anki-deck");
        await screenshot("import-dialog");
        await waitForVaultFile("Anki/anki-synthetic.apkg");
        await chooseOption(0, "Anki/anki-synthetic.apkg");
        await clickPrimary();
        const result = await resultText();
        await screenshot("import-result");
        await closeModal();

        expect(result).toContain("Imported 5 cards in 2 decks (2 media files).");
        expect(result).toContain("Cloze notes were written as {{1;;answer;;hint}}.");
        expect(result).toContain("Turned on the cloze pattern {{[123;;]answer[;;hint]}}");

        const spanish = readVault(`${IMPORT_FOLDER}/Spanish/Spanish.md`);
        expect(spanish.split("\n")[0]).toEqual("#flashcards/Spanish #greetings #week1");
        expect(spanish).toContain("hola\n?\n**hello**\n(a greeting)\n<!--anki:e2e%2Dhola-->");
        expect(spanish).toContain("gracias\n??\nthanks\n<!--anki:e2e%2Dgracias-->");
        expect(spanish).toContain("![[pixel.png]]");
        expect(spanish).toContain("![[beep.wav]]");
        const verbs = readVault(`${IMPORT_FOLDER}/Spanish/Verbs/Verbs.md`);
        expect(verbs).toContain("Yo {{1;;hablo;;hablar}} y tu {{2;;hablas}}\n<br>\nPresent tense");
        expect(verbs).toContain("std:&#58;vector is a\n?\ncontainer");
        expect(fs.existsSync(vaultPath(`${IMPORT_FOLDER}/attachments/pixel.png`))).toBe(true);
        expect(fs.existsSync(vaultPath(`${IMPORT_FOLDER}/attachments/beep.wav`))).toBe(true);

        // The plugin found the cards: 4 in Spanish (the reversed note is two) and 3 in Verbs (the cloze is two)
        const counts = await deckCounts();
        expect(counts["flashcards/Spanish/Verbs"]).toEqual(3);
        expect(counts["flashcards/Spanish"]).toEqual(7);
        const patterns = await browser.executeObsidian(
            ({ app }, id) =>
                (app as unknown as AppWithPlugins).plugins.plugins[id]?.dataManager.settingsManager
                    .settings.clozePatterns ?? [],
            pluginId,
        );
        expect(patterns).toContain("{{[123;;]answer[;;hint]}}");
    });

    it("skips notes it already imported when the same package is imported again", async function () {
        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await importVaultFile("Anki/anki-synthetic.apkg");
        const before = readVault(`${IMPORT_FOLDER}/Spanish/Spanish.md`);

        const again = await importVaultFile("Anki/anki-synthetic.apkg");
        expect(again).toContain("Imported 0 cards in 0 decks.");
        expect(again).toContain("5 duplicates skipped, already imported.");
        expect(readVault(`${IMPORT_FOLDER}/Spanish/Spanish.md`)).toEqual(before);
    });

    it("reviews imported cards and keeps their Anki guid comments", async function () {
        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await importVaultFile("Anki/anki-synthetic.apkg");
        const note = `${IMPORT_FOLDER}/Spanish/Spanish.md`;
        expect(readVault(note)).not.toContain("<!--SR:");

        await browser.executeObsidianCommand(`${pluginId}:srs-review-flashcards`);
        // Several decks: the list comes first. Open the Spanish deck, which holds the note above
        const rows = browser.$$(
            ".sr-view .sr-deck-container:not(.sr-is-hidden) .tag-pane-tag-self",
        );
        await browser.waitUntil(async () => (await rows.length) > 0, {
            timeoutMsg: "the deck list never showed",
        });
        let opened = false;
        for (const row of await rows) {
            if ((await row.getText()).trim() === "Spanish") {
                // In the emulated phone the row can be under the edge of the modal, which a driver click refuses
                await press(row);
                opened = true;
                break;
            }
        }
        expect(opened).toBe(true);

        const showAnswer = browser.$(".sr-view .sr-card-container .sr-show-answer-button");
        await showAnswer.waitForClickable({ timeoutMsg: "no card front was shown" });
        await press(showAnswer);
        const good = browser.$(".sr-view .sr-card-container .sr-good-button");
        await good.waitForClickable({ timeoutMsg: "Good was not shown" });
        await press(good);

        await browser.waitUntil(() => readVault(note).includes("<!--SR:"), {
            timeoutMsg: "the answered card never got a schedule",
        });
        const after = readVault(note);
        expect(after.match(/<!--anki:/g)).toHaveLength(3);
        // Wherever a card got its schedule, the guid comment is still on the line after it
        expect(after).toMatch(/<!--SR:[^\n]+-->\n<!--anki:e2e%2D[a-z]+-->/);
    });

    it("imports a package chosen with the file picker of the device", async function () {
        await openModal("srs-import-anki-deck");
        const input = await browser.$(".sr-anki-modal input[type='file']");
        // The input is only visually hidden, but Chromium's driver wants it visible to send a file to it
        await browser.execute((element: HTMLElement) => {
            (
                element as unknown as { setCssProps(props: Record<string, string>): void }
            ).setCssProps({
                opacity: "1",
                width: "20px",
                height: "20px",
            });
        }, input);
        // addValue, not setValue: a file input cannot be cleared first
        await input.addValue(path.join(FIXTURES, "anki-synthetic.apkg"));
        await expect(browser.$(".sr-anki-modal .sr-anki-file-name")).toHaveText(
            "anki-synthetic.apkg",
        );
        await clickPrimary();
        expect(await resultText()).toContain("Imported 5 cards in 2 decks (2 media files).");
        await closeModal();
        expect(fs.existsSync(vaultPath(`${IMPORT_FOLDER}/Spanish/Verbs/Verbs.md`))).toBe(true);
    });

    it("imports a text file in Anki's format, with decks, tags and quoted fields", async function () {
        copyIntoVault("anki-notes.txt", "Anki/anki-notes.txt");
        const result = await importVaultFile("Anki/anki-notes.txt", "Text import");
        expect(result).toContain("Imported 3 cards in 2 decks.");

        const europe = readVault("Text import/Geography/Europe/Europe.md");
        expect(europe.split("\n")[0]).toEqual("#flashcards/Geography/Europe #cities");
        expect(europe).toContain("capital of France\n?\nParis");
        expect(europe).toContain('two lines\nof question\n?\nanswer with "quotes"');
        expect(readVault("Text import/Geography/Asia/Asia.md")).toContain(
            "capital of Japan\n?\nTokyo",
        );
    });

    it("says clearly when a file is not an Anki package", async function () {
        fs.mkdirSync(vaultPath("Anki"), { recursive: true });
        fs.writeFileSync(vaultPath("Anki/broken.apkg"), "this is not a zip file");
        await openModal("srs-import-anki-deck");
        await waitForVaultFile("Anki/broken.apkg");
        await chooseOption(0, "Anki/broken.apkg");
        await clickPrimary();
        expect(await errorText()).toContain("This file is not an Anki package.");
        await closeModal();
        expect(fs.existsSync(vaultPath(`${IMPORT_FOLDER}/broken`))).toBe(false);
    });

    it("exports all decks to an Anki package that opens in ankipack, and the export imports again", async function () {
        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await importVaultFile("Anki/anki-synthetic.apkg");

        await openModal("srs-export-anki");
        await screenshot("export-dialog");
        await clickPrimary();
        const result = await resultText();
        await screenshot("export-result");
        await closeModal();
        expect(result).toMatch(
            /^Exported 9 cards in \d+ decks \(2 media files\) to Flashcards\/Exports\/All decks-\d{4}-\d{2}-\d{2}\.apkg\.$/m,
        );

        const exported = fs
            .readdirSync(vaultPath("Flashcards/Exports"))
            .filter((name) => name.endsWith(".apkg"));
        expect(exported).toHaveLength(1);
        const file = `Flashcards/Exports/${exported[0]}`;

        // Read with ankipack in Node, apart from the plugin
        const collection = await readPackage(file);
        const byGuid = new Map(collection.notes().map((note) => [note.guid, note]));
        expect(byGuid.size).toEqual(9);
        expect(byGuid.get("e2e-hola")?.fields).toEqual(["hola", "<b>hello</b><br>(a greeting)"]);
        expect(byGuid.get("e2e-hola")?.tags).toEqual(["greetings", "week1"]);
        expect(byGuid.get("e2e-gracias")?.notetypeName).toEqual(
            "Flashcard Studio Basic (and reversed card)",
        );
        expect(byGuid.get("e2e-cloze")?.fields).toEqual([
            "Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}",
            "Present tense",
        ]);
        expect(byGuid.get("e2e-media")?.fields[0]).toContain('<img src="pixel.png">');
        expect(collection.data.media.map((media) => media.name).sort()).toEqual([
            "beep.wav",
            "pixel.png",
        ]);
        expect(collection.deckNames()).toEqual(
            expect.arrayContaining(["Spanish", "Spanish::Verbs"]),
        );
        // Cards written in Obsidian: the highlight cloze of the fixture note is an Anki cloze now
        const written = collection.notes().filter((note) => note.guid.startsWith("cw-"));
        expect(written).toHaveLength(4);
        expect(written.map((note) => note.fields[0])).toContain(
            "The CAE reports {{c1::functionally}} to the {{c2::board}}.",
        );

        // Importing the export into the same folder finds every Anki note again: only the 4 new ones are cards
        const again = await importVaultFile(file);
        expect(again).toContain("Imported 4 cards");
        expect(again).toContain("5 duplicates skipped, already imported.");
    });

    it("exports one deck as a text file in Anki's format", async function () {
        copyIntoVault("anki-synthetic.apkg", "Anki/anki-synthetic.apkg");
        await importVaultFile("Anki/anki-synthetic.apkg");

        await openModal("srs-export-anki");
        // Decks: All decks, then the decks with cards in the order of the tree
        const options = await browser.$$(DROPDOWNS)[0].$$("option");
        const labels: string[] = [];
        for (const option of options) labels.push(await option.getText());
        const verbs = labels.findIndex((label) => label.startsWith("Spanish / Verbs"));
        expect(verbs).toBeGreaterThan(0);
        await chooseOption(0, String(verbs - 1));
        await chooseOption(1, "txt");
        const pathInput = (await browser.$$(".sr-anki-modal input[type='text']"))[0];
        expect(await pathInput.getValue()).toMatch(
            /^Flashcards\/Exports\/Verbs-\d{4}-\d{2}-\d{2}\.txt$/,
        );
        await clickPrimary();
        expect(await resultText()).toMatch(
            /^Exported 2 cards in 1 deck to Flashcards\/Exports\/Verbs-/m,
        );
        await closeModal();

        const name = fs
            .readdirSync(vaultPath("Flashcards/Exports"))
            .find((file) => file.endsWith(".txt"));
        const lines = readVault(`Flashcards/Exports/${name}`).split("\n");
        expect(lines.slice(0, 6)).toEqual([
            "#separator:tab",
            "#html:true",
            "#guid column:1",
            "#notetype column:2",
            "#deck column:3",
            "#tags column:6",
        ]);
        expect(lines[6]).toEqual(
            "e2e-cloze\tCloze\tSpanish::Verbs\tYo {{c1::hablo::hablar}} y tu {{c2::hablas}}\tPresent tense\t",
        );
        expect(lines[7]).toEqual(
            'e2e-colons\tBasic\tSpanish::Verbs\t"std:&#58;vector is a"\tcontainer\t',
        );
    });
});
