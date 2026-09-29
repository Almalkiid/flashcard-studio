import { readFileSync } from "fs";
import * as path from "path";
import { env } from "process";
import { parseObsidianVersions } from "wdio-obsidian-service";

// wdio-obsidian-service downloads Obsidian versions into this directory (gitignored).
const cacheDir = path.resolve(".obsidian-cache");

// Obsidian app/installer version(s) to test, "app/installer" space separated.
// "latest/latest" is resolved to a concrete version at start-up, so the run log shows exactly which
// Obsidian was tested. Override with e.g. OBSIDIAN_VERSIONS="1.9.14/latest".
const versions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? "latest/latest", {
    cacheDir,
});

// The service loads a plugin from a directory containing manifest.json + main.js (+ styles.css).
// This repo builds to build/main.js, so `pnpm test:e2e` first copies the build output here
// (see tests/e2e/stage-plugin.mjs).
const pluginDir = ".e2e-plugin";
const vaultDir = "tests/e2e/vault";

export const config: WebdriverIO.Config = {
    runner: "local",
    framework: "mocha",

    specs: ["./tests/e2e/specs/**/*.e2e.ts"],

    // Desktop and mobile run in parallel, each in its own sandboxed Obsidian with its own vault copy.
    maxInstances: Number(env.WDIO_MAX_INSTANCES || 2),

    capabilities: [
        // Desktop
        ...versions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
            browserName: "obsidian",
            "wdio:obsidianOptions": {
                appVersion,
                installerVersion,
                plugins: [pluginDir],
                vault: vaultDir,
            },
        })),
        // Emulated mobile: desktop Electron with Obsidian's app.emulateMobile(true) and a phone-sized window.
        ...versions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
            browserName: "obsidian",
            "wdio:obsidianOptions": {
                appVersion,
                installerVersion,
                emulateMobile: true,
                plugins: [pluginDir],
                vault: vaultDir,
            },
            "goog:chromeOptions": {
                mobileEmulation: {
                    deviceMetrics: { width: 390, height: 844 },
                },
            },
        })),
    ],

    services: ["obsidian"],
    // Wraps the spec reporter so the run output shows the Obsidian version instead of the Chromium one.
    reporters: ["obsidian"],

    mochaOpts: {
        ui: "bdd",
        timeout: 60 * 1000,
    },
    waitforInterval: 250,
    waitforTimeout: 10 * 1000,
    logLevel: "warn",

    cacheDir,

    injectGlobals: false, // import describe/it/expect explicitly

    // Every spec starts in a fresh vault, where the plugin shows its first-run welcome guide. Close it so specs
    // start from a clean workspace; tests/e2e/specs/welcome.e2e.ts reopens it on purpose.
    before: async () => {
        const { browser } = await import("@wdio/globals");
        const pluginId = (
            JSON.parse(readFileSync(path.resolve("manifest.json"), "utf8")) as { id: string }
        ).id;
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }, id) => {
                    const plugins = (
                        app as unknown as {
                            plugins: { plugins: Record<string, { isInitialized?: boolean }> };
                        }
                    ).plugins.plugins;
                    return plugins[id]?.isInitialized === true;
                }, pluginId),
            { timeout: 30 * 1000, timeoutMsg: `plugin ${pluginId} did not finish initialising` },
        );
        const welcome = browser.$(".sr-welcome-modal");
        if (await welcome.isExisting()) await browser.keys("Escape");
        await welcome.waitForExist({ reverse: true, timeout: 5000 });
    },
};
