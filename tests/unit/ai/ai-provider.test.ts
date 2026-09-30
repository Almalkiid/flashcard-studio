/* eslint-disable camelcase -- the providers' request bodies use snake_case names */
import type { RequestUrlParam } from "obsidian";

import {
    AiError,
    aiErrorFromStatus,
    aiSetupProblem,
    buildAiRequest,
    readAiReply,
    readAiText,
    requestAiReply,
} from "src/ai/ai-provider";
import en from "src/lang/locale/en";

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

describe("requestAiReply", () => {
    const settings = { provider: "anthropic" as const, model: "m", baseUrl: "" };
    const ok = (json: unknown) => ({ status: 200, text: JSON.stringify(json) });

    test("returns the reply text and sends the built request", async () => {
        const seen: RequestUrlParam[] = [];
        const { text } = await requestAiReply(settings, "secret-key", prompt, (p) => {
            seen.push(p);
            return Promise.resolve(ok({ content: [{ type: "text", text: "hi" }] }));
        });
        expect(text).toBe("hi");
        expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    });

    test("an empty key is a no-key error before anything is sent", async () => {
        const request = jest.fn();
        await expect(requestAiReply(settings, "", prompt, request)).rejects.toMatchObject({
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
        const { text } = await requestAiReply(compat, "", prompt, (p) => {
            seen.push(p);
            return Promise.resolve(ok({ choices: [{ message: { content: "hi" } }] }));
        });
        expect(text).toBe("hi");
        expect(seen[0].headers).not.toHaveProperty("Authorization");
    });

    test("a failing status maps to its error kind", async () => {
        await expect(
            requestAiReply(settings, "k", prompt, () => Promise.resolve({ status: 429, text: "" })),
        ).rejects.toMatchObject({ kind: "rate-limit" });
    });

    test("a request that throws is a network error", async () => {
        await expect(
            requestAiReply(settings, "k", prompt, () =>
                Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
            ),
        ).rejects.toMatchObject({ kind: "network" });
    });

    test("a reply that is not JSON is a format error", async () => {
        await expect(
            requestAiReply(settings, "k", prompt, () =>
                Promise.resolve({ status: 200, text: "<html>" }),
            ),
        ).rejects.toMatchObject({ kind: "format" });
    });

    test("a request that never answers times out as a network error", async () => {
        await expect(
            requestAiReply(settings, "k", prompt, () => new Promise(() => undefined), 20),
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
            const error = await requestAiReply(settings, key, prompt, fail).catch(
                (e: unknown) => e,
            );
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

describe("the key is trimmed", () => {
    test("a key pasted with a newline or spaces is sent without them", () => {
        const r = buildAiRequest(
            { provider: "openai", model: "m", baseUrl: "" },
            "  sk-k\n",
            prompt,
        );
        expect(r.headers).toMatchObject({ Authorization: "Bearer sk-k" });
        const a = buildAiRequest(
            { provider: "anthropic", model: "m", baseUrl: "" },
            "k \n",
            prompt,
        );
        expect(a.headers).toMatchObject({ "x-api-key": "k" });
    });

    test("a whitespace-only key for a compatible server sends no auth header", () => {
        const r = buildAiRequest(
            { provider: "openai-compatible", model: "m", baseUrl: "http://x/v1" },
            "   \n",
            prompt,
        );
        expect(r.headers).not.toHaveProperty("Authorization");
    });

    test("requestAiReply trims it too", async () => {
        const seen: RequestUrlParam[] = [];
        await requestAiReply(
            { provider: "anthropic", model: "m", baseUrl: "" },
            " k\n",
            prompt,
            (p) => {
                seen.push(p);
                return Promise.resolve({
                    status: 200,
                    text: JSON.stringify({ content: [{ type: "text", text: "x" }] }),
                });
            },
        );
        expect(seen[0].headers).toMatchObject({ "x-api-key": "k" });
    });

    test("and a key of only whitespace is no key", async () => {
        await expect(
            requestAiReply(
                { provider: "openai", model: "m", baseUrl: "" },
                " \n",
                prompt,
                jest.fn(),
            ),
        ).rejects.toMatchObject({ kind: "no-key" });
    });
});

describe("the base URL is checked", () => {
    const compat = (baseUrl: string) => ({
        provider: "openai-compatible" as const,
        model: "m",
        baseUrl,
    });

    test("it has to start with http:// or https://", () => {
        expect(aiSetupProblem(compat("localhost:11434/v1"), "")).toBe("bad-base-url");
        expect(aiSetupProblem(compat("ftp://x/v1"), "")).toBe("bad-base-url");
        expect(aiSetupProblem(compat("//x/v1"), "")).toBe("bad-base-url");
        expect(aiSetupProblem(compat("http://localhost:11434/v1"), "")).toBeNull();
        expect(aiSetupProblem(compat(" HTTPS://example.com/v1 "), "")).toBeNull();
    });

    test("an empty one is still the missing-address case", () => {
        expect(aiSetupProblem(compat(""), "")).toBe("no-base-url");
    });

    test("the host in a network error has a translatable fallback, never a raw literal", async () => {
        const error = await requestAiReply(
            { provider: "openai-compatible", model: "m", baseUrl: "not a url" },
            "",
            prompt,
            () => Promise.reject(new Error("net::ERR_FAILED")),
        ).catch((e: unknown) => e as AiError);
        expect((error as AiError).message).toContain(en.AI_HOST_FALLBACK);
    });
});

describe("what a provider echoes of a key is masked", () => {
    test("a masked echo such as sk-abc12***xyz9 does not reach the message (reviewer's reproduction)", () => {
        for (const echo of [
            "sk-abc12***xyz9",
            "sk-ant-api03-abc***xyz",
            "key_ab*.*cdef",
            "sess-abc...",
        ]) {
            const e = aiErrorFromStatus(
                400,
                JSON.stringify({ error: { message: `Bad key ${echo} sent` } }),
            );
            expect(e.message).not.toContain(echo.slice(0, 6));
        }
    });

    test("ordinary words with a dash are left alone", () => {
        const e = aiErrorFromStatus(
            400,
            JSON.stringify({ error: { message: "The model gpt-5-mini was not found" } }),
        );
        expect(e.message).toContain("gpt-5-mini");
    });
});

describe("readAiReply", () => {
    test("says when the reply was cut off by the length limit", () => {
        expect(
            readAiReply("anthropic", {
                content: [{ type: "text", text: "a" }],
                stop_reason: "max_tokens",
            }),
        ).toEqual({ text: "a", truncated: true });
        expect(
            readAiReply("anthropic", {
                content: [{ type: "text", text: "a" }],
                stop_reason: "end_turn",
            }),
        ).toEqual({ text: "a", truncated: false });
        expect(
            readAiReply("openai", {
                choices: [{ message: { content: "x" }, finish_reason: "length" }],
            }),
        ).toEqual({ text: "x", truncated: true });
        expect(
            readAiReply("openai-compatible", {
                choices: [{ message: { content: "x" }, finish_reason: "stop" }],
            }),
        ).toEqual({ text: "x", truncated: false });
        expect(readAiReply("openai", { choices: [{ message: { content: "x" } }] }).truncated).toBe(
            false,
        );
    });

    test("requestAiReply passes it on", async () => {
        const reply = await requestAiReply(
            { provider: "openai", model: "m", baseUrl: "" },
            "k",
            prompt,
            () =>
                Promise.resolve({
                    status: 200,
                    text: JSON.stringify({
                        choices: [{ message: { content: "x" }, finish_reason: "length" }],
                    }),
                }),
        );
        expect(reply).toEqual({ text: "x", truncated: true });
    });
});
