import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

/*
 * Requests to an AI provider, for "Generate cards with AI". Every call goes through Obsidian's `requestUrl`, which
 * works on phones and is not blocked by CORS; this file only builds the request and reads the reply, so it can be
 * tested without a network.
 *
 * The API key is a parameter of the two functions that need it and is never stored, logged or put in an error.
 */

export type AiProviderId = "anthropic" | "openai" | "openai-compatible";

export interface AiSettings {
    provider: AiProviderId;
    model: string;
    /** Only used by "openai-compatible": the address up to and excluding `/chat/completions`. */
    baseUrl: string;
}

export interface AiPrompt {
    system: string;
    user: string;
    maxTokens: number;
}

export type AiErrorKind = "no-key" | "auth" | "rate-limit" | "server" | "network" | "format";

/** A failure that the person can act on. The message is safe to show: it never contains the key or a header. */
export class AiError extends Error {
    readonly kind: AiErrorKind;

    constructor(kind: AiErrorKind, message: string) {
        super(message);
        this.name = "AiError";
        this.kind = kind;
    }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** A big generation on a slow local model can take minutes. */
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_DETAIL_LENGTH = 200;

/**
 * What is missing before a request can be made. A key is needed by Anthropic and OpenAI only; an OpenAI-compatible
 * server (Ollama, LM Studio) usually has none.
 */
export function aiSetupProblem(
    settings: AiSettings,
    apiKey: string,
): "no-key" | "no-model" | "no-base-url" | null {
    if (settings.provider === "openai-compatible") {
        if (settings.baseUrl.trim() === "") return "no-base-url";
    } else if (apiKey.trim() === "") {
        return "no-key";
    }
    if (settings.model.trim() === "") return "no-model";
    return null;
}

/* eslint-disable camelcase -- the providers' request bodies use snake_case names */
export function buildAiRequest(
    settings: AiSettings,
    apiKey: string,
    prompt: AiPrompt,
): RequestUrlParam {
    const model = settings.model.trim();
    if (settings.provider === "anthropic") {
        return {
            url: ANTHROPIC_URL,
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model,
                max_tokens: prompt.maxTokens,
                system: prompt.system,
                messages: [{ role: "user", content: prompt.user }],
            }),
            throw: false,
        };
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey !== "") headers.Authorization = `Bearer ${apiKey}`;
    const messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
    ];
    if (settings.provider === "openai") {
        return {
            url: OPENAI_URL,
            method: "POST",
            headers,
            body: JSON.stringify({ model, max_completion_tokens: prompt.maxTokens, messages }),
            throw: false,
        };
    }
    // Servers other than OpenAI's know `max_tokens`, and many do not know `max_completion_tokens`
    return {
        url: `${settings.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`,
        method: "POST",
        headers,
        body: JSON.stringify({ model, max_tokens: prompt.maxTokens, messages }),
        throw: false,
    };
}

/* eslint-enable camelcase -- end of the request builders */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function unexpectedShape(): AiError {
    return new AiError(
        "format",
        "The provider's reply was not in the expected shape. Check the provider, the model name and the base URL.",
    );
}

/** The text of a reply. Throws an AiError of kind "format" when the reply has another shape. */
export function readAiText(provider: AiProviderId, json: unknown): string {
    if (!isRecord(json)) throw unexpectedShape();

    if (provider === "anthropic") {
        const blocks = json.content;
        if (!Array.isArray(blocks)) throw unexpectedShape();
        const texts = blocks
            .filter(
                (block): block is { text: string } =>
                    isRecord(block) &&
                    (block.type === undefined || block.type === "text") &&
                    typeof block.text === "string",
            )
            .map((block) => block.text);
        if (texts.length === 0) throw unexpectedShape();
        return texts.join("");
    }

    const choices = json.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) throw unexpectedShape();
    const message = choices[0].message;
    if (!isRecord(message) || typeof message.content !== "string") throw unexpectedShape();
    return message.content;
}

/** Masks anything that looks like an API key, in text that came from a provider. */
function maskKeyLikeText(text: string): string {
    return text.replace(/\b(?:sk|pk|rk|key|sess)[-_][A-Za-z0-9_-]{8,}/gi, "…");
}

/** The reason a provider gives in the body of an error reply, shortened, or "" when it gives none. */
function providerDetail(body: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return "";
    }
    if (!isRecord(parsed)) return "";
    const error = parsed.error;
    let message: unknown = parsed.message;
    if (typeof error === "string") message = error;
    else if (isRecord(error) && typeof error.message === "string") message = error.message;
    if (typeof message !== "string") return "";
    const flat = maskKeyLikeText(message.replace(/\s+/g, " ").trim());
    return flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH)}…` : flat;
}

/**
 * A reply with an error status as a clear error. Providers sometimes repeat part of a rejected key in the reason for
 * a 401, so an auth error never includes the provider's text.
 */
export function aiErrorFromStatus(status: number, body: string): AiError {
    if (status === 401 || status === 403) {
        return new AiError(
            "auth",
            "The provider did not accept the API key. Check the key and the provider in the settings.",
        );
    }
    const detail = providerDetail(body);
    const suffix = detail === "" ? "" : ` ${detail}`;
    if (status === 429) {
        return new AiError(
            "rate-limit",
            `The provider is limiting requests, or your quota is used up. Wait a moment and try again.${suffix}`,
        );
    }
    if (status >= 500) {
        return new AiError(
            "server",
            `The provider had a problem (HTTP ${status}). Try again in a moment.${suffix}`,
        );
    }
    return new AiError(
        "server",
        `The provider rejected the request (HTTP ${status}). Check the model name.${suffix}`,
    );
}

/** What the caller must supply to send a request: `requestUrl` in the plugin, a fake in tests. */
export type AiRequestFn = (
    request: RequestUrlParam,
) => Promise<Pick<RequestUrlResponse, "status" | "text">>;

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return "the provider";
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
            () => reject(new AiError("network", "The provider did not answer in time. Try again.")),
            timeoutMs,
        );
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                window.clearTimeout(timer);
                reject(error instanceof Error ? error : new Error("The request failed."));
            },
        );
    });
}

/**
 * Sends the prompt and returns the reply text.
 *
 * @throws AiError for every failure. No message contains the key, even when the provider or the network layer
 * repeats it.
 */
export async function requestAiText(
    settings: AiSettings,
    apiKey: string,
    prompt: AiPrompt,
    request: AiRequestFn,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
    if (settings.provider !== "openai-compatible" && apiKey.trim() === "") {
        throw new AiError("no-key", "There is no API key yet. Add it in the settings.");
    }

    try {
        const built = buildAiRequest(settings, apiKey, prompt);
        let response: Pick<RequestUrlResponse, "status" | "text">;
        try {
            response = await withTimeout(request(built), timeoutMs);
        } catch (error) {
            if (error instanceof AiError) throw error;
            const where = hostOf(built.url);
            const hint = settings.provider === "openai-compatible" ? " and the base URL" : "";
            throw new AiError("network", `Could not reach ${where}. Check the connection${hint}.`);
        }

        if (response.status >= 400) throw aiErrorFromStatus(response.status, response.text);

        let json: unknown;
        try {
            json = JSON.parse(response.text);
        } catch {
            throw new AiError(
                "format",
                "The provider's reply was not JSON. Check the provider and the base URL.",
            );
        }
        return readAiText(settings.provider, json);
    } catch (error) {
        if (error instanceof AiError) {
            // A provider or a network layer may echo the key back in its own words
            const message = apiKey === "" ? error.message : error.message.split(apiKey).join("…");
            throw new AiError(error.kind, message);
        }
        throw error;
    }
}
