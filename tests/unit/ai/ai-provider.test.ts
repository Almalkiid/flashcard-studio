/* eslint-disable camelcase -- the providers' request bodies use snake_case names */
import type { RequestUrlParam } from "obsidian";

import {
    AiError,
    aiErrorFromStatus,
    aiSetupProblem,
    buildAiRequest,
    readAiText,
    requestAiText,
} from "src/ai/ai-provider";

const prompt = { system: "S", user: "U", maxTokens: 100 };

test("anthropic request", () => {
    const r = buildAiRequest(
        { provider: "anthropic", model: "claude-sonnet-5-5", baseUrl: "" },
        "k",
        prompt,
    );
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
    expect(JSON.parse(r.body as string)).toEqual({
        model: "claude-sonnet-5-5",
        max_tokens: 100,
        system: "S",
        messages: [{ role: "user", content: "U" }],
    });
    expect(r.throw).toBe(false);
});

test("openai request", () => {
    const r = buildAiRequest({ provider: "openai", model: "gpt-5.5", baseUrl: "" }, "k", prompt);
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(JSON.parse(r.body as string)).toEqual({
        model: "gpt-5.5",
        max_completion_tokens: 100,
        messages: [
            { role: "system", content: "S" },
            { role: "user", content: "U" },
        ],
    });
    expect(r.throw).toBe(false);
});

test("openai-compatible request without a key sends no auth header", () => {
    const r = buildAiRequest(
        { provider: "openai-compatible", model: "llama3", baseUrl: "http://localhost:11434/v1/" },
        "",
        prompt,
    );
    expect(r.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(r.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(r.body as string)).toMatchObject({ max_tokens: 100 });
    expect(JSON.parse(r.body as string)).not.toHaveProperty("max_completion_tokens");
});

test("openai-compatible request with a key sends it", () => {
    const r = buildAiRequest(
        { provider: "openai-compatible", model: "m", baseUrl: "https://openrouter.ai/api/v1" },
        "k",
        prompt,
    );
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r.headers).toMatchObject({ Authorization: "Bearer k" });
});

test("reads text from both shapes", () => {
    expect(
        readAiText("anthropic", {
            content: [
                { type: "text", text: "a" },
                { type: "text", text: "b" },
            ],
        }),
    ).toBe("ab");
    expect(readAiText("openai", { choices: [{ message: { content: "x" } }] })).toBe("x");
    expect(readAiText("openai-compatible", { choices: [{ message: { content: "y" } }] })).toBe("y");
    expect(() => readAiText("openai", { nope: 1 })).toThrow();
});

test("a reply of an unexpected shape is a format error", () => {
    expect(() => readAiText("anthropic", { content: [{ type: "tool_use" }] })).toThrow(AiError);
    expect(() => readAiText("openai", null)).toThrow(AiError);
    try {
        readAiText("openai", { choices: [] });
    } catch (e) {
        expect((e as AiError).kind).toBe("format");
    }
});

test("status codes become clear errors", () => {
    expect(aiErrorFromStatus(401, "").kind).toBe("auth");
    expect(aiErrorFromStatus(403, "").kind).toBe("auth");
    expect(aiErrorFromStatus(429, "").kind).toBe("rate-limit");
    expect(aiErrorFromStatus(503, "").kind).toBe("server");
});

test("other client errors carry the provider's reason", () => {
    const e = aiErrorFromStatus(404, JSON.stringify({ error: { message: "model not found" } }));
    expect(e.kind).toBe("server");
    expect(e.message).toContain("404");
    expect(e.message).toContain("model not found");
});

test("an auth error never repeats the provider's text, which may echo part of the key", () => {
    const body = JSON.stringify({
        error: { message: "Incorrect API key provided: sk-abc123***xyz" },
    });
    const e = aiErrorFromStatus(401, body);
    expect(e.message).not.toContain("sk-abc123");
});

describe("requestAiText", () => {
    const settings = { provider: "anthropic" as const, model: "m", baseUrl: "" };
    const ok = (json: unknown) => ({ status: 200, text: JSON.stringify(json) });

    test("returns the reply text and sends the built request", async () => {
        const seen: RequestUrlParam[] = [];
        const text = await requestAiText(settings, "secret-key", prompt, (p) => {
            seen.push(p);
            return Promise.resolve(ok({ content: [{ type: "text", text: "hi" }] }));
        });
        expect(text).toBe("hi");
        expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    });

    test("an empty key is a no-key error before anything is sent", async () => {
        const request = jest.fn();
        await expect(requestAiText(settings, "", prompt, request)).rejects.toMatchObject({
            kind: "no-key",
        });
        expect(request).not.toHaveBeenCalled();
    });

    test("a compatible endpoint is called without a key", async () => {
        const compat = {
            provider: "openai-compatible" as const,
            model: "m",
            baseUrl: "http://x/v1",
        };
        const seen: RequestUrlParam[] = [];
        const text = await requestAiText(compat, "", prompt, (p) => {
            seen.push(p);
            return Promise.resolve(ok({ choices: [{ message: { content: "hi" } }] }));
        });
        expect(text).toBe("hi");
        expect(seen[0].headers).not.toHaveProperty("Authorization");
    });

    test("a failing status maps to its error kind", async () => {
        await expect(
            requestAiText(settings, "k", prompt, () => Promise.resolve({ status: 429, text: "" })),
        ).rejects.toMatchObject({ kind: "rate-limit" });
    });

    test("a request that throws is a network error", async () => {
        await expect(
            requestAiText(settings, "k", prompt, () =>
                Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
            ),
        ).rejects.toMatchObject({ kind: "network" });
    });

    test("a reply that is not JSON is a format error", async () => {
        await expect(
            requestAiText(settings, "k", prompt, () =>
                Promise.resolve({ status: 200, text: "<html>" }),
            ),
        ).rejects.toMatchObject({ kind: "format" });
    });

    test("a request that never answers times out as a network error", async () => {
        await expect(
            requestAiText(settings, "k", prompt, () => new Promise(() => undefined), 20),
        ).rejects.toMatchObject({ kind: "network" });
    });

    test("the key never appears in any error message", async () => {
        const key = "sk-live-0123456789abcdef";
        const failures: Array<() => Promise<{ status: number; text: string }>> = [
            () => Promise.resolve({ status: 401, text: `bad key ${key}` }),
            () =>
                Promise.resolve({
                    status: 400,
                    text: JSON.stringify({ error: { message: `key ${key} rejected` } }),
                }),
            () => Promise.resolve({ status: 500, text: key }),
            () => Promise.reject(new Error(`failed with ${key}`)),
            () => Promise.resolve({ status: 200, text: key }),
        ];
        for (const fail of failures) {
            const error = await requestAiText(settings, key, prompt, fail).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(AiError);
            expect((error as AiError).message).not.toContain(key);
        }
    });
});

describe("aiSetupProblem", () => {
    test("Anthropic and OpenAI need a key and a model", () => {
        for (const provider of ["anthropic", "openai"] as const) {
            expect(aiSetupProblem({ provider, model: "m", baseUrl: "" }, "k")).toBeNull();
            expect(aiSetupProblem({ provider, model: "m", baseUrl: "" }, "  ")).toBe("no-key");
            expect(aiSetupProblem({ provider, model: " ", baseUrl: "" }, "k")).toBe("no-model");
        }
    });

    test("a compatible endpoint needs a base URL and a model, not a key", () => {
        const s = { provider: "openai-compatible" as const, model: "m", baseUrl: "http://x/v1" };
        expect(aiSetupProblem(s, "")).toBeNull();
        expect(aiSetupProblem({ ...s, baseUrl: " " }, "")).toBe("no-base-url");
        expect(aiSetupProblem({ ...s, model: "" }, "")).toBe("no-model");
    });
});
