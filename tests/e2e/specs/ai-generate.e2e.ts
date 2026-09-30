import { browser, expect } from "@wdio/globals";
import * as fs from "fs";
import * as http from "http";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import type { AddressInfo } from "net";
import * as path from "path";
import { setTimeout as later } from "timers";
import { obsidianPage } from "wdio-obsidian-service";

// Runs once per capability in wdio.conf.mts: desktop, and emulated mobile.
//
// "Generate cards with AI" is tested against a fake provider: a small HTTP server in this file that answers like an
// OpenAI-compatible endpoint. No real provider is ever called and no real key is used.

const manifest = JSON.parse(fs.readFileSync(path.resolve("manifest.json"), "utf8")) as {
    id: string;
};
const pluginId = manifest.id;
const DECK_NOTE = "CIA/Part1/Deck.md";
const PLAIN_NOTE = "Plain.md";
const PLAIN_TEXT = "# Plain\n\nThe board approves the internal audit charter.\n";
const SECRET_ID = "e2e-test-key";
const FAKE_KEY = "sk-e2e-0123456789abcdef";
// The README screenshots are only written when asked for (SCREENSHOTS=1), so a normal run leaves the repository
// unchanged. E2E_SCREENSHOT_DIR writes every screenshot of this spec to a folder, for looking at the design.
const README_DIR =
    process.env.SCREENSHOTS === "1" ? path.resolve("docs/media/screenshots") : undefined;
const REVIEW_DIR = process.env.E2E_SCREENSHOT_DIR;

interface PluginState {
    isInitialized?: boolean;
    saveData: (data: unknown) => Promise<void>;
    dataManager: {
        sync: () => Promise<void>;
        data: { settings: Record<string, unknown> };
        settingsManager: { save: () => Promise<void> };
        osrCore: {
            reviewableDeckTree: {
                toDeckArray(): {
                    isRootDeck: boolean;
                    getTopicPath(): { path: string[] };
                    getDistinctRepItemCount(state: number, includeSubdecks: boolean): number;
                }[];
            };
        };
    };
}
interface AppWithPlugins {
    plugins: { plugins: Record<string, PluginState | undefined> };
}

interface AppWithSetting {
    setting: { open: () => void; openTabById: (id: string) => void };
}
interface WindowWithSaves {
    __saves?: string[];
    __settingsCalls?: string[];
    __settingsOriginals?: Pick<AppWithSetting["setting"], "open" | "openTabById">;
    __originalSync?: () => Promise<void>;
}

interface SeenRequest {
    url: string;
    headers: http.IncomingHttpHeaders;
    body: {
        model: string;
        max_tokens: number;
        messages: { role: string; content: string }[];
    };
}

// The fake provider
let server: http.Server;
let baseUrl = "";
const seen: SeenRequest[] = [];
let reply: { status: number; body: string; delayMs: number } = {
    status: 200,
    body: "",
    delayMs: 0,
};

/* eslint-disable camelcase -- the provider's reply uses snake_case names */
function completion(cards: unknown[], finishReason = "stop"): string {
    return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ cards }) }, finish_reason: finishReason }],
    });
}

/* eslint-enable camelcase -- end of the reply builder */

const TWO_BASIC = [
    { kind: "basic", front: "What does CAE stand for?", back: "Chief Audit Executive" },
    { kind: "basic", front: "Who approves the charter?", back: "The board" },
];

const ALL_KINDS = [
    { kind: "basic", front: "What does CAE stand for?", back: "Chief Audit Executive" },
    { kind: "reversed", front: "CAE", back: "Chief Audit Executive" },
    { kind: "cloze", front: "The {{board}} approves the charter.", back: "" },
    {
        kind: "choice",
        front: "Who approves the charter?",
        back: "",
        options: [
            { text: "The CAE", correct: false },
            { text: "The board", correct: true },
        ],
        explanation: "The board approves it.",
    },
];

function startServer(): Promise<void> {
    server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            seen.push({
                url: request.url ?? "",
                headers: request.headers,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as SeenRequest["body"],
            });
            const answer = reply;
            later(() => {
                response.writeHead(answer.status, { "content-type": "application/json" });
                response.end(answer.body);
            }, answer.delayMs);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
            resolve();
        });
    });
}

// Helpers
function vaultPath(relative: string): string {
    return path.join(obsidianPage.getVaultPath(), relative);
}

function readVault(relative: string): string {
    return fs.readFileSync(vaultPath(relative), "utf8");
}

/** Read from the capabilities, so it also works in a window the Obsidian test service is not loaded in. */
function isMobile(): boolean {
    return (
        (browser.requestedCapabilities as Record<string, { emulateMobile?: boolean }>)[
            "wdio:obsidianOptions"
        ].emulateMobile === true
    );
}

async function screenshot(name: string, forReadme = false): Promise<void> {
    const folder = (forReadme ? README_DIR : undefined) ?? REVIEW_DIR;
    if (folder === undefined) return;
    fs.mkdirSync(folder, { recursive: true });
    await browser.saveScreenshot(
        path.join(folder, `${name}-${isMobile() ? "mobile" : "desktop"}.png`),
    );
}

async function setBodyTheme(light: boolean): Promise<void> {
    await browser.execute((useLight: boolean) => {
        document.body.classList.toggle("theme-light", useLight);
        document.body.classList.toggle("theme-dark", !useLight);
    }, light);
    await browser.pause(200);
}

async function setSetting(key: string, value: unknown): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, id, settingKey, settingValue) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error("the plugin is not loaded");
            plugin.dataManager.data.settings[settingKey] = settingValue;
            await plugin.dataManager.settingsManager.save();
        },
        pluginId,
        key,
        value,
    );
}

/** Keeps a copy of everything the plugin hands to Obsidian to save as its settings. */
async function recordSaves(): Promise<void> {
    await browser.executeObsidian(({ app }, id) => {
        const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
        if (plugin === undefined) throw new Error("the plugin is not loaded");
        const saves: string[] = [];
        (window as unknown as WindowWithSaves).__saves = saves;
        const original = plugin.saveData.bind(plugin);
        plugin.saveData = (data: unknown) => {
            saves.push(JSON.stringify(data));
            return original(data);
        };
    }, pluginId);
}

async function useFakeProvider(withKey: boolean): Promise<void> {
    await setSetting("aiProvider", "openai-compatible");
    await setSetting("aiBaseUrl", baseUrl);
    await setSetting("aiModel", "fake-model");
    await setSetting("aiKeySecret", withKey ? SECRET_ID : "");
}

async function createNote(notePath: string, content: string): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, file, text) => {
            const existing = app.vault.getFileByPath(file);
            if (existing) await app.vault.modify(existing, text);
            else await app.vault.create(file, text);
        },
        notePath,
        content,
    );
}

async function openInEditor(notePath: string): Promise<void> {
    await browser.executeObsidian(async ({ app }, file) => {
        const target = app.vault.getFileByPath(file);
        if (target === null) throw new Error(`no note ${file}`);
        await app.workspace.getLeaf(false).openFile(target);
    }, notePath);
    await browser.$(".workspace-leaf.mod-active .cm-editor").waitForExist({
        timeoutMsg: "the note never opened in an editor",
    });
}

async function openDialog(notePath: string): Promise<void> {
    await openInEditor(notePath);
    await browser.executeObsidianCommand(`${pluginId}:fs-generate-cards-ai`);
    await browser.$(".fs-ai-modal .fs-ai-generate").waitForExist({
        timeoutMsg: "the Generate cards dialog did not open",
    });
    // On the phone layout the dialog slides in, and a click during that lands where a button was, not where it is
    let last = -1;
    await browser.waitUntil(
        async () => {
            const top = await browser.execute(
                () => document.querySelector(".fs-ai-modal")?.getBoundingClientRect().top ?? -1,
            );
            const settled = top === last;
            last = top;
            return settled;
        },
        { interval: 120, timeoutMsg: "the dialog kept moving" },
    );
}

async function clickGenerate(): Promise<void> {
    const button = browser.$(".fs-ai-modal .fs-ai-generate");
    await button.waitForClickable();
    await button.click();
}

async function waitForPreview(rows: number): Promise<void> {
    await browser.waitUntil(
        async () => (await browser.$$(".fs-ai-modal .fs-ai-row").length) === rows,
        {
            timeoutMsg: `the preview never showed ${rows} cards`,
        },
    );
}

async function addCards(): Promise<void> {
    const button = browser.$(".fs-ai-modal .fs-ai-add");
    await button.waitForClickable();
    await button.click();
    await browser.$(".fs-ai-modal").waitForExist({
        reverse: true,
        timeoutMsg: "the dialog stayed open after Add",
    });
}

async function deckCount(deck: string): Promise<number> {
    return browser.executeObsidian(
        ({ app }, id, name) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            const decks = plugin?.dataManager.osrCore.reviewableDeckTree.toDeckArray() ?? [];
            const found = decks.find(
                (d) => !d.isRootDeck && d.getTopicPath().path.join("/") === name,
            );
            return found === undefined ? 0 : found.getDistinctRepItemCount(2, true);
        },
        pluginId,
        deck,
    );
}

/** The card count of a deck after the plugin has read the vault again: resetVault() does not tell it to. */
async function syncedDeckCount(deck: string): Promise<number> {
    await browser.executeObsidian(async ({ app }, id) => {
        await (app as unknown as AppWithPlugins).plugins.plugins[id]?.dataManager.sync();
    }, pluginId);
    return deckCount(deck);
}

async function waitForDeckCount(deck: string, expected: number): Promise<void> {
    await browser.waitUntil(async () => (await deckCount(deck)) === expected, {
        timeout: 15_000,
        timeoutMsg: `the ${deck} deck never had ${expected} cards after the cards were added`,
    });
}

/**
 * Opens this plugin's settings. Desktop Obsidian shows the settings in a window of their own, the phone layout in the
 * main one; this leaves the browser on whichever window holds them.
 *
 * @returns A function that closes the settings again and goes back to the main window.
 */
async function openSettings(): Promise<() => Promise<void>> {
    const main = await browser.getWindowHandle();
    await browser.executeObsidian(({ app }, id) => {
        const setting = (app as unknown as AppWithSetting).setting;
        setting.open();
        setting.openTabById(id);
    }, pluginId);
    await browser.waitUntil(
        async () => {
            for (const handle of await browser.getWindowHandles()) {
                await browser.switchToWindow(handle);
                const found = await browser.execute(
                    () => document.querySelectorAll(".sr-main-page").length,
                );
                if (found > 0) return true;
            }
            return false;
        },
        { timeoutMsg: "the settings did not open in any window" },
    );
    return async () => {
        if ((await browser.getWindowHandle()) !== main) await browser.closeWindow();
        await browser.switchToWindow(main);
    };
}

async function closeModals(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        if (!(await browser.$(".modal-container").isExisting())) return;
        await browser.keys("Escape");
        await browser.pause(150);
    }
}

describe("generate cards with AI", function () {
    before(async function () {
        await startServer();
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, id) => {
                    const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                    return plugin !== undefined && plugin.isInitialized === true;
                }, pluginId),
            { timeoutMsg: `plugin ${pluginId} did not finish initialising` },
        );
    });

    after(async function () {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(async function () {
        await obsidianPage.resetVault();
        seen.length = 0;
        reply = { status: 200, body: completion(TWO_BASIC), delayMs: 0 };
        await browser.executeObsidian(({ app }, id) => {
            // A key in the secret storage, as the settings would have put it there; it is not a real key
            app.secretStorage.setSecret(id, "sk-e2e-0123456789abcdef");
        }, SECRET_ID);
        await useFakeProvider(false);
        await setBodyTheme(false);
    });

    afterEach(async function () {
        await closeModals();
    });

    it("adds the ticked cards, with edits, under a Flashcards heading of the note", async function () {
        const before = readVault(DECK_NOTE);
        const cardsBefore = await syncedDeckCount("flashcards");
        await openDialog(DECK_NOTE);
        await screenshot("ai-form");
        // The stepper buttons have names (from the locale strings), not just icons
        await expect(browser.$(".fs-ai-modal .fs-ai-step")).toHaveAttribute(
            "aria-label",
            "Fewer cards",
        );

        await clickGenerate();
        await waitForPreview(2);

        // The request went to the fake server with the note, no key, and the model from the settings
        expect(seen).toHaveLength(1);
        expect(seen[0].url).toBe("/v1/chat/completions");
        expect(seen[0].headers.authorization).toBeUndefined();
        expect(seen[0].body.model).toBe("fake-model");
        expect(seen[0].body.messages[0].content).toContain("JSON");
        expect(seen[0].body.messages[1].content).toContain(
            "Internal audit reports functionally to the board",
        );
        expect(seen[0].body.messages[1].content).not.toContain("tags:");

        // Untick the second card and edit the first one's answer
        const rows = await browser.$$(".fs-ai-modal .fs-ai-row");
        await rows[1].$(".fs-ai-check").click();
        await rows[0].$(".fs-ai-edit-back").setValue("Chief Audit Executive (CAE)");
        await expect(browser.$(".fs-ai-modal .fs-ai-add")).toHaveText("Add 1 card");

        await setBodyTheme(true);
        await screenshot("ai-edit-light");
        await setBodyTheme(false);
        await screenshot("ai-edit");

        await addCards();

        const after = readVault(DECK_NOTE);
        expect(after).toBe(
            `${before.trimEnd()}\n\n## Flashcards\n\nWhat does CAE stand for?::Chief Audit Executive (CAE)\n`,
        );
        // The note was re-synced: one more card in the deck
        await waitForDeckCount("flashcards", cardsBefore + 1);
    });

    it("keeps the dialog open with a clear message on an error, and never shows the key", async function () {
        await recordSaves();
        await useFakeProvider(true);
        reply = {
            status: 401,
            body: JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }),
            delayMs: 0,
        };
        await openDialog(DECK_NOTE);
        await clickGenerate();

        const error = browser.$(".fs-ai-modal .fs-ai-error");
        await error.waitForExist({ timeoutMsg: "no error was shown" });
        const message = await error.getText();
        expect(message).toContain("did not accept the API key");
        expect(message).not.toContain(FAKE_KEY);
        expect(message).not.toContain("sk-e2e");
        await expect(browser.$(".fs-ai-modal .fs-ai-error-button")).toExist();
        // The key came from the secret storage and was sent as a bearer token
        expect(seen[0].headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
        // The dialog is still there, ready to try again
        await expect(browser.$(".fs-ai-modal .fs-ai-generate")).toExist();
        await screenshot("ai-error");

        // The key was never handed to the plugin's settings file, only the id of the secret. resetVault() removes the
        // plugin's folder, so this reads what the plugin writes rather than the file.
        await setSetting("aiModel", "fake-model");
        const saved = await browser.execute(
            () => (window as unknown as WindowWithSaves).__saves ?? [],
        );
        expect(saved.length).toBeGreaterThan(0);
        for (const json of saved) expect(json).not.toContain(FAKE_KEY);
        expect(saved[saved.length - 1]).toContain(SECRET_ID);

        // The button opens this plugin's settings (the settings dialog itself does not open in the emulated phone)
        await browser.executeObsidian(({ app }) => {
            const setting = (app as unknown as AppWithSetting).setting;
            const calls: string[] = [];
            const window_ = window as unknown as WindowWithSaves;
            window_.__settingsCalls = calls;
            window_.__settingsOriginals = { open: setting.open, openTabById: setting.openTabById };
            setting.open = () => {
                calls.push("open");
            };
            setting.openTabById = (id: string) => {
                calls.push(id);
            };
        });
        await browser.$(".fs-ai-modal .fs-ai-error-button").click();
        await browser.waitUntil(
            async () =>
                (
                    await browser.execute(
                        () => (window as unknown as WindowWithSaves).__settingsCalls ?? [],
                    )
                ).includes(pluginId),
            { timeoutMsg: "the button did not open this plugin's settings" },
        );
        // Put Obsidian's own methods back, other tests open the settings for real
        await browser.executeObsidian(({ app }) => {
            const setting = (app as unknown as AppWithSetting).setting;
            const originals = (window as unknown as WindowWithSaves).__settingsOriginals;
            if (originals !== undefined) Object.assign(setting, originals);
        });
        await browser.$(".fs-ai-modal").waitForExist({ reverse: true });
    });

    it("sends nothing when the key is missing, and offers the settings", async function () {
        await setSetting("aiProvider", "openai");
        await setSetting("aiKeySecret", "");
        await openDialog(DECK_NOTE);
        await clickGenerate();

        const error = browser.$(".fs-ai-modal .fs-ai-error");
        await error.waitForExist();
        expect(await error.getText()).toContain("no API key");
        await expect(browser.$(".fs-ai-modal .fs-ai-error-button")).toExist();
        expect(seen).toHaveLength(0);
    });

    it("a card that would break the note is unticked with the reason, and fixing it makes it addable", async function () {
        reply = {
            status: 200,
            body: completion([
                {
                    kind: "basic",
                    front: "In C++ what is std::vector",
                    back: "A dynamic array",
                },
                { kind: "basic", front: "Who approves the charter?", back: "The board" },
            ]),
            delayMs: 0,
        };
        const before = readVault(DECK_NOTE);
        await openDialog(DECK_NOTE);
        await clickGenerate();
        await waitForPreview(2);

        // The first card would be read back as a one-line card and lose its answer: refused, with the reason
        const rows = await browser.$$(".fs-ai-modal .fs-ai-row");
        await expect(rows[0]).toHaveElementClass("is-invalid");
        const hint = rows[0].$(".fs-ai-row-hint");
        await expect(hint).toHaveText(expect.stringContaining("::"));
        await expect(hint).toHaveText(expect.stringContaining("split"));
        await expect(rows[0].$(".fs-ai-check input")).toBeDisabled();
        await expect(browser.$(".fs-ai-modal .fs-ai-add")).toHaveText("Add 1 card");
        await screenshot("ai-blocked");

        // Edited, it is checked again, ticked again, and counted
        await rows[0].$(".fs-ai-edit-front").setValue("In C++ what is a vector");
        await expect(rows[0]).not.toHaveElementClass("is-invalid");
        await expect(browser.$(".fs-ai-modal .fs-ai-add")).toHaveText("Add 2 cards");
        await addCards();

        expect(readVault(DECK_NOTE)).toBe(
            `${before.trimEnd()}\n\n## Flashcards\n\n` +
                "In C++ what is a vector::A dynamic array\n\n" +
                "Who approves the charter?::The board\n",
        );
    });

    it("writes only the cards that read back, and never the one that would break the note", async function () {
        reply = {
            status: 200,
            body: completion([
                { kind: "basic", front: "Q1", back: "A1\n```\nunclosed" },
                { kind: "basic", front: "Q2", back: "A2" },
                { kind: "basic", front: "Q3", back: "A3" },
            ]),
            delayMs: 0,
        };
        const before = readVault(DECK_NOTE);
        await openDialog(DECK_NOTE);
        await clickGenerate();
        await waitForPreview(3);
        const rows = await browser.$$(".fs-ai-modal .fs-ai-row");
        await expect(rows[0].$(".fs-ai-row-hint")).toHaveText(
            expect.stringContaining("code block"),
        );
        await expect(browser.$(".fs-ai-modal .fs-ai-add")).toHaveText("Add 2 cards");
        await addCards();
        expect(readVault(DECK_NOTE)).toBe(
            `${before.trimEnd()}\n\n## Flashcards\n\nQ2::A2\n\nQ3::A3\n`,
        );
    });

    it("shows no more cards than were asked for, and says when the reply was cut off", async function () {
        reply = {
            status: 200,
            body: completion(
                [...TWO_BASIC, { kind: "basic", front: "Third?", back: "Yes" }],
                "length",
            ),
            delayMs: 0,
        };
        await openDialog(DECK_NOTE);
        // Down from 10 to 2 with the stepper's minus button
        const minus = browser.$(".fs-ai-modal .fs-ai-step");
        for (let click = 0; click < 8; click++) await minus.click();
        await expect(browser.$(".fs-ai-modal #fs-ai-count")).toHaveValue("2");
        await clickGenerate();
        await waitForPreview(2);
        const notes = await browser.$$(".fs-ai-modal .fs-ai-note");
        expect(notes).toHaveLength(2);
        await expect(notes[0]).toHaveText(expect.stringContaining("you asked for 2"));
        await expect(notes[1]).toHaveText(expect.stringContaining("cut off"));
        // Every placeholder was filled in
        for (const note of notes) expect(await note.getText()).not.toContain("${");
        await screenshot("ai-notes");
    });

    it("refuses a server address without http:// before anything is sent", async function () {
        await setSetting("aiBaseUrl", "localhost:11434/v1");
        await openDialog(DECK_NOTE);
        await clickGenerate();
        const error = browser.$(".fs-ai-modal .fs-ai-error");
        await error.waitForExist();
        expect(await error.getText()).toContain("http://");
        await expect(browser.$(".fs-ai-modal .fs-ai-error-button")).toExist();
        expect(seen).toHaveLength(0);
    });

    it("reports a re-sync that fails after the cards were added, instead of throwing", async function () {
        await browser.executeObsidian(({ app }, id) => {
            const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
            if (plugin === undefined) throw new Error("the plugin is not loaded");
            const window_ = window as unknown as WindowWithSaves;
            window_.__originalSync = plugin.dataManager.sync;
            plugin.dataManager.sync = () => Promise.reject(new Error("no way"));
        }, pluginId);
        try {
            const before = readVault(DECK_NOTE);
            await openDialog(DECK_NOTE);
            await clickGenerate();
            await waitForPreview(2);
            await addCards();
            await browser.waitUntil(
                async () =>
                    (
                        await browser.execute(() =>
                            Array.from(document.querySelectorAll(".notice")).map(
                                (notice) => notice.textContent ?? "",
                            ),
                        )
                    ).some((text) => text.includes("could not read the note again")),
                { timeoutMsg: "no notice about the failed re-sync" },
            );
            // The cards themselves were written
            expect(readVault(DECK_NOTE).length).toBeGreaterThan(before.length);
        } finally {
            await browser.executeObsidian(({ app }, id) => {
                const plugin = (app as unknown as AppWithPlugins).plugins.plugins[id];
                const original = (window as unknown as WindowWithSaves).__originalSync;
                if (plugin !== undefined && original !== undefined) {
                    plugin.dataManager.sync = original;
                }
            }, pluginId);
        }
    });

    it("a server problem is explained and the dialog stays open", async function () {
        reply = { status: 503, body: "", delayMs: 0 };
        await openDialog(DECK_NOTE);
        await clickGenerate();
        const error = browser.$(".fs-ai-modal .fs-ai-error");
        await error.waitForExist();
        expect(await error.getText()).toContain("HTTP 503");
    });

    it("a reply that is not cards is an error and writes nothing", async function () {
        reply = {
            status: 200,
            body: JSON.stringify({
                choices: [{ message: { content: "Sorry, I cannot do that." } }],
            }),
            delayMs: 0,
        };
        const before = readVault(DECK_NOTE);
        await openDialog(DECK_NOTE);
        await clickGenerate();
        const error = browser.$(".fs-ai-modal .fs-ai-error");
        await error.waitForExist();
        expect(await error.getText()).toContain("usable cards");
        expect(readVault(DECK_NOTE)).toBe(before);
    });

    it("Cancel while waiting returns to the form, and a late reply is ignored", async function () {
        reply = { status: 200, body: completion(TWO_BASIC), delayMs: 1500 };
        await openDialog(DECK_NOTE);
        await clickGenerate();
        await browser.$(".fs-ai-modal .fs-ai-loading").waitForExist();
        await screenshot("ai-loading");
        await browser.$(".fs-ai-modal .fs-ai-loading .fs-ai-ghost").click();
        await browser.$(".fs-ai-modal .fs-ai-generate").waitForExist();

        await browser.pause(2200);
        await expect(browser.$(".fs-ai-modal .fs-ai-row")).not.toExist();
        await expect(browser.$(".fs-ai-modal .fs-ai-generate")).toExist();
    });

    it("writes every kind in the note's syntax and adds the tag to a note without one", async function () {
        reply = { status: 200, body: completion(ALL_KINDS), delayMs: 0 };
        await createNote(PLAIN_NOTE, PLAIN_TEXT);
        const cardsBefore = await syncedDeckCount("flashcards");
        await openDialog(PLAIN_NOTE);

        // Ask for cloze and multiple choice too: the prompt names them
        await browser.$(".fs-ai-modal .fs-ai-chip.is-cloze").click();
        await browser.$(".fs-ai-modal .fs-ai-chip.is-choice").click();
        await clickGenerate();
        await waitForPreview(4);
        await setBodyTheme(true);
        await screenshot("ai-preview-light", true);
        await setBodyTheme(false);
        await screenshot("ai-preview", true);
        // The last rows: the cloze and the multiple choice card, which have their own fields
        await browser.execute(() => {
            const list = document.querySelector(".fs-ai-list");
            if (list) list.scrollTop = list.scrollHeight;
        });
        await browser.pause(200);
        await screenshot("ai-preview-end");
        expect(seen[0].body.messages[0].content).toContain("cloze");
        expect(seen[0].body.messages[0].content).toContain("choice");
        expect(seen[0].body.messages[0].content).not.toContain("reversed");
        await addCards();

        expect(readVault(PLAIN_NOTE)).toBe(
            `${PLAIN_TEXT.trimEnd()}\n\n## Flashcards\n\n#flashcards\n\n` +
                "What does CAE stand for?::Chief Audit Executive\n\n" +
                "CAE:::Chief Audit Executive\n\n" +
                "The ==board== approves the charter.\n\n" +
                "Who approves the charter?\n?\n- [ ] The CAE\n- [x] The board\nExplanation: The board approves it.\n",
        );
        // basic 1 + reversed 2 + cloze 1 + the multiple choice card 1
        await waitForDeckCount("flashcards", cardsBefore + 5);
    });

    it("can put the cards in a new note next to the source", async function () {
        await createNote(PLAIN_NOTE, PLAIN_TEXT);
        await openDialog(PLAIN_NOTE);
        await browser.$(".fs-ai-modal .fs-ai-segment:nth-child(2)").click();
        await clickGenerate();
        await waitForPreview(2);
        await addCards();

        expect(readVault(PLAIN_NOTE)).toBe(PLAIN_TEXT);
        expect(readVault("Plain - flashcards.md")).toBe(
            "#flashcards\n\n" +
                "What does CAE stand for?::Chief Audit Executive\n\n" +
                "Who approves the charter?::The board\n",
        );
    });

    it("uses only the selection when there is one", async function () {
        await createNote(PLAIN_NOTE, "First paragraph.\n\nSelected sentence about risk.\n");
        await openInEditor(PLAIN_NOTE);
        await browser.executeObsidian(({ app, obsidian }) => {
            const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
            if (view === null) throw new Error("no editor");
            view.editor.setSelection({ line: 2, ch: 0 }, { line: 2, ch: 30 });
        });
        await browser.executeObsidianCommand(`${pluginId}:fs-generate-cards-ai`);
        await browser.$(".fs-ai-modal .fs-ai-generate").waitForExist();
        await expect(browser.$(".fs-ai-modal .fs-ai-source-name")).toHaveText("Selected text");
        await clickGenerate();
        await waitForPreview(2);
        const prompt = seen[0].body.messages[1].content;
        expect(prompt).toContain("Selected sentence about risk.");
        expect(prompt).not.toContain("First paragraph.");
    });

    it("has the AI group in the settings, with the key field", async function () {
        await setSetting("aiProvider", "anthropic");
        await setSetting("aiModel", "claude-sonnet-5-5");
        await setSetting("aiKeySecret", "");
        const closeSettings = await openSettings();
        try {
            const heading = browser.$(
                "//div[contains(@class,'sr-main-page')]//div[contains(@class,'setting-item-heading')][normalize-space()='AI cards']",
            );
            await heading.waitForExist({ timeoutMsg: "the AI cards group is not in the settings" });
            await heading.scrollIntoView();
            await browser.pause(300);
            await screenshot("ai-settings");
            // Anthropic is the default provider, with its default model filled in, and the key field is there
            await expect(
                browser.$(".sr-main-page input[placeholder='claude-sonnet-5-5']"),
            ).toExist();
            await expect(
                browser.$(
                    "//div[contains(@class,'sr-main-page')]//div[@class='setting-item-name'][.='API key']",
                ),
            ).toExist();

            // Choosing an OpenAI-compatible server shows its address field and empties the model, which belonged to
            // Anthropic
            const provider = browser.$(
                "//div[contains(@class,'sr-main-page')]//div[@class='setting-item-name'][.='Provider']/ancestor::div[contains(concat(' ',@class,' '),' setting-item ')][1]//select",
            );
            await provider.selectByAttribute("value", "openai-compatible");
            await expect(
                browser.$(".sr-main-page input[placeholder='http://localhost:11434/v1']"),
            ).toExist();
            const model = browser.$(".sr-main-page input[placeholder='llama3.1']");
            await expect(model).toExist();
            expect(await model.getValue()).toBe("");
        } finally {
            await closeSettings();
        }
    });
});
