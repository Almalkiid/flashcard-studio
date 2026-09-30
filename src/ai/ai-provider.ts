import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

import { t } from "src/lang/helpers";

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
): "no-key" | "no-model" | "no-base-url" | "bad-base-url" | null {
    if (settings.provider === "openai-compatible") {
        const baseUrl = settings.baseUrl.trim();
        if (baseUrl === "") return "no-base-url";
        // "localhost:11434/v1" is read as the scheme "localhost:", with no host at all
        if (!/^https?:\/\//i.test(baseUrl)) return "bad-base-url";
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
    // A key pasted with a newline or spaces would fail in a way that looks like a network problem
    const key = apiKey.trim();
    if (settings.provider === "anthropic") {
        return {
            url: ANTHROPIC_URL,
            method: "POST",
            headers: {
                "x-api-key": key,
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
    if (key !== "") headers.Authorization = `Bearer ${key}`;
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
    return new AiError("format", t("AI_ERR_SHAPE"));
}

/** What a provider answered: the text, and whether it stopped because it hit the length limit. */
export interface AiReply {
    text: string;
    truncated: boolean;
}

/** The reply. Throws an AiError of kind "format" when it has another shape. */
export function readAiReply(provider: AiProviderId, json: unknown): AiReply {
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
        return { text: texts.join(""), truncated: json.stop_reason === "max_tokens" };
    }

    const choices = json.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) throw unexpectedShape();
    const message = choices[0].message;
    if (!isRecord(message) || typeof message.content !== "string") throw unexpectedShape();
    return { text: message.content, truncated: choices[0].finish_reason === "length" };
}

/** The text of a reply. Throws an AiError of kind "format" when the reply has another shape. */
export function readAiText(provider: AiProviderId, json: unknown): string {
    return readAiReply(provider, json).text;
}

/** Masks anything that looks like an API key, in text that came from a provider. */
function maskKeyLikeText(text: string): string {
    // Providers echo a key partly hidden ("sk-abc12***xyz9"), so the stars, dots and dashes belong to it
    return text.replace(/\b(?:sk|pk|rk|key|sess)[-_][A-Za-z0-9_*.\u2026-]{3,}/gi, "…");
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
    if (status === 401 || status === 403) return new AiError("auth", t("AI_ERR_AUTH"));
    const reason = providerDetail(body);
    const detail = reason === "" ? "" : ` ${reason}`;
    if (status === 429) return new AiError("rate-limit", t("AI_ERR_RATE_LIMIT", { detail }));
    if (status >= 500) return new AiError("server", t("AI_ERR_SERVER", { status, detail }));
    return new AiError("server", t("AI_ERR_REJECTED", { status, detail }));
}

/** What the caller must supply to send a request: `requestUrl` in the plugin, a fake in tests. */
export type AiRequestFn = (
    request: RequestUrlParam,
) => Promise<Pick<RequestUrlResponse, "status" | "text">>;

function hostOf(url: string): string {
    try {
        return new URL(url).host || t("AI_HOST_FALLBACK");
    } catch {
        return t("AI_HOST_FALLBACK");
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
            () => reject(new AiError("network", t("AI_ERR_TIMEOUT"))),
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
 * Sends the prompt and returns the reply.
 *
 * @throws AiError for every failure. No message contains the key, even when the provider or the network layer
 * repeats it.
 */
export async function requestAiReply(
    settings: AiSettings,
    apiKey: string,
    prompt: AiPrompt,
    request: AiRequestFn,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AiReply> {
    const key = apiKey.trim();
    if (settings.provider !== "openai-compatible" && key === "") {
        throw new AiError("no-key", t("AI_ERR_NO_KEY"));
    }

    try {
        const built = buildAiRequest(settings, key, prompt);
        let response: Pick<RequestUrlResponse, "status" | "text">;
        try {
            response = await withTimeout(request(built), timeoutMs);
        } catch (error) {
            if (error instanceof AiError) throw error;
            const host = hostOf(built.url);
            const compatible = settings.provider === "openai-compatible";
            throw new AiError(
                "network",
                t(compatible ? "AI_ERR_NETWORK_URL" : "AI_ERR_NETWORK", { host }),
            );
        }

        if (response.status >= 400) throw aiErrorFromStatus(response.status, response.text);

        let json: unknown;
        try {
            json = JSON.parse(response.text);
        } catch {
            throw new AiError("format", t("AI_ERR_NOT_JSON"));
        }
        return readAiReply(settings.provider, json);
    } catch (error) {
        if (error instanceof AiError) {
            // A provider or a network layer may echo the key back in its own words
            const message = key === "" ? error.message : error.message.split(key).join("…");
            throw new AiError(error.kind, message);
        }
        throw error;
    }
}
