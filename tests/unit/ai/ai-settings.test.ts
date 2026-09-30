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
