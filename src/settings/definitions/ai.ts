import { SecretComponent, type SettingDefinitionItem } from "obsidian";

import type { AiProviderId } from "src/ai/ai-provider";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import type { SettingsContext } from "src/settings/context";
import { bindKeys } from "src/settings/definitions/helpers";
import { urlError } from "src/settings/validators";

/** An example model name for each provider, shown while the model is empty. */
const MODEL_PLACEHOLDER: Record<AiProviderId, string> = {
    anthropic: DEFAULT_SETTINGS.aiModel,
    openai: "gpt-5.1",
    "openai-compatible": "llama3.2",
};

/** Making cards with AI: which provider, which model, where it lives, and the key kept in secret storage. */
export function aiGroup(ctx: SettingsContext): SettingDefinitionItem[] {
    return [
        {
            type: "group",
            heading: "AI cards",
            items: [
                {
                    name: "Provider",
                    control: {
                        type: "dropdown",
                        key: "aiProvider",
                        options: {
                            anthropic: "Anthropic",
                            openai: "OpenAI",
                            "openai-compatible": "Compatible server (such as Ollama)",
                        },
                    },
                },
                {
                    name: "Model",
                    desc: "The exact model name.",
                    // Changing the provider resets the model and redraws the tab, so the provider read here is current.
                    control: {
                        type: "text",
                        key: "aiModel",
                        placeholder: MODEL_PLACEHOLDER[ctx.settings.aiProvider],
                    },
                },
                {
                    name: "Server address",
                    desc: "Up to, but not including, /chat/completions.",
                    visible: () => ctx.settings.aiProvider === "openai-compatible",
                    control: {
                        type: "text",
                        key: "aiBaseUrl",
                        placeholder: "http://localhost:11434/v1",
                        validate: urlError,
                    },
                },
                // What is stored is the secret's name in Obsidian's storage, never the key itself.
                bindKeys(["aiKeySecret"], {
                    name: "API key",
                    desc: "Pick or add a key in Obsidian's secret storage. A local server usually needs none.",
                    render: (setting) => {
                        setting.addComponent((el) =>
                            new SecretComponent(ctx.app, el)
                                .setValue(ctx.settings.aiKeySecret)
                                .onChange(async (value) => {
                                    ctx.settings.aiKeySecret = value;
                                    await ctx.commit(["aiKeySecret"]);
                                }),
                        );
                    },
                }),
                {
                    name: "Privacy",
                    desc: "A note's text is sent to the provider only when you run the command to make cards.",
                },
            ],
        },
    ];
}
