import { App, requestUrl } from "obsidian";

import { aiProviderLabel, AiRequestFn, AiSettings, aiSetupProblem } from "src/ai/ai-provider";
import { gradeTypedAnswer, SemanticGradeInput, SemanticOutcome } from "src/ai/typed-answer-grading";
import type { StudioSettings } from "src/data/settings-model";

/*
 * The AI set up for card generation, for the other features that use it: its settings and its key, read each time they
 * are needed and never kept.
 */

/** The AI settings of the plugin's settings: the provider, model and server address. */
export function aiSettingsOf(settings: StudioSettings): AiSettings {
    return { provider: settings.aiProvider, model: settings.aiModel, baseUrl: settings.aiBaseUrl };
}

/**
 * The API key from Obsidian's secret storage, trimmed (a secret pasted with a newline must not turn into a confusing
 * network error); "" when none is chosen or the storage cannot be read. Never logged.
 */
export function readAiKey(app: App, secretId: string): string {
    if (secretId === "") return "";
    try {
        return (app.secretStorage.getSecret(secretId) ?? "").trim();
    } catch {
        return "";
    }
}

/** The review's meaning check (#4) as an exam uses it. Settings and key are read at each call, never kept. */
export interface MeaningChecker {
    /** Whether a check can be sent now: nothing the provider needs is missing. */
    usable(): boolean;
    /** Who the answers go to, for the privacy line: "Anthropic", "OpenAI" or the server's host. */
    provider(): string;
    /** `gradeTypedAnswer` with the plugin's settings and key: its prompt, guard vetoes and 10 s deadline. */
    check(input: SemanticGradeInput): Promise<SemanticOutcome>;
}

export function meaningChecker(
    app: App,
    settings: () => StudioSettings,
    request: AiRequestFn = (params) => requestUrl(params),
): MeaningChecker {
    const key = () => readAiKey(app, settings().aiKeySecret);
    return {
        usable: () => aiSetupProblem(aiSettingsOf(settings()), key()) === null,
        provider: () => aiProviderLabel(aiSettingsOf(settings())),
        check: (input) => gradeTypedAnswer(input, aiSettingsOf(settings()), key(), request),
    };
}
