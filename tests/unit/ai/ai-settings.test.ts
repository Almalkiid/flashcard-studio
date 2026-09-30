import * as fs from "fs";

import { DEFAULT_SETTINGS } from "src/data/settings";
import { mergeImportedSettings } from "src/data/settings-import";

describe("AI settings", () => {
    test("default to Anthropic with its default model, no server address and no secret chosen", () => {
        expect(DEFAULT_SETTINGS.aiProvider).toBe("anthropic");
        expect(DEFAULT_SETTINGS.aiModel).toBe("claude-sonnet-5-5");
        expect(DEFAULT_SETTINGS.aiBaseUrl).toBe("");
        expect(DEFAULT_SETTINGS.aiKeySecret).toBe("");
    });

    test("an imported Spaced Repetition settings file never changes them", () => {
        const current = {
            ...DEFAULT_SETTINGS,
            aiProvider: "openai" as const,
            aiModel: "gpt-5.5",
            aiBaseUrl: "http://localhost:1/v1",
            aiKeySecret: "my-key",
        };
        const { settings, importedKeys } = mergeImportedSettings(current, {
            settings: {
                aiProvider: "anthropic",
                aiModel: "other",
                aiBaseUrl: "http://elsewhere",
                aiKeySecret: "stolen",
            },
        });
        expect(settings.aiProvider).toBe("openai");
        expect(settings.aiModel).toBe("gpt-5.5");
        expect(settings.aiBaseUrl).toBe("http://localhost:1/v1");
        expect(settings.aiKeySecret).toBe("my-key");
        expect(importedKeys).toEqual([]);
    });
});

describe("the AI strings", () => {
    test("use each ${placeholder} once: t() replaces only the first occurrence of a name", async () => {
        const { default: en } = await import("src/lang/locale/en");
        const repeated = Object.entries(en)
            .filter(([key]) => key.startsWith("AI_"))
            .filter(([, text]) => {
                const names = String(text).match(/\$\{\w+\}/g) ?? [];
                return new Set(names).size !== names.length;
            })
            .map(([key]) => key);
        expect(repeated).toEqual([]);
    });

    test("fill in their placeholders when shown", async () => {
        const { t } = await import("src/lang/helpers");
        const shown = t("AI_PREVIEW_EXTRA", { total: 5, count: 2 });
        expect(shown).toContain("5");
        expect(shown).toContain("2");
        expect(shown).not.toContain("${");
    });
});

describe("the dialog's stylesheet", () => {
    test("every rule about a primary button names one of the dialog's own classes", () => {
        const css = fs.readFileSync("src/ai/generate-cards.css", "utf8");
        const selectors = css
            .split("{")
            .map((part) => part.split("}").pop() ?? "")
            .filter((selector) => selector.includes(".fs-primary-button"));
        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors) expect(selector).toMatch(/\.fs-ai-/);
    });
});
