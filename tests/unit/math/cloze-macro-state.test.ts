/** The on/off state machine of setClozeMathMacro, against a fake MathJax and a mocked obsidian module. */
import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

import type { setClozeMathMacro as SetClozeMathMacro } from "src/math/cloze-macro";

jest.mock("obsidian", () => ({
    loadMathJax: jest.fn(() => Promise.resolve()),
    renderMath: jest.fn(),
    finishRenderMath: jest.fn(() => Promise.resolve()),
}));

interface Fake {
    added: unknown[][];
    removedFromConfiguration: unknown[];
    removedMacros: string[];
    macros: Set<string>;
}

function install(withCommandMap: boolean, others: string[] = []): Fake {
    const fake: Fake = {
        added: [],
        removedFromConfiguration: [],
        removedMacros: [],
        macros: new Set(others),
    };
    class CommandMap {}
    const handlers = {
        add: (...args: unknown[]) => fake.added.push(args),
        get: () => ({
            _configuration: { remove: (m: unknown) => fake.removedFromConfiguration.push(m) },
        }),
        retrieve: () => ({
            contains: (name: string) => fake.macros.has(name),
            remove: (name: string) => {
                fake.removedMacros.push(name);
                fake.macros.delete(name);
            },
        }),
    };
    const tex = {
        ParseUtil: { default: { addArgs: (_p: unknown, a: string, b: string) => a + b } },
    };
    (window as unknown as { MathJax: unknown }).MathJax = {
        _: { input: { tex: withCommandMap ? { ...tex, SymbolMap: { CommandMap } } : tex } },
        startup: { document: { inputJax: [{ name: "TeX", parseOptions: { handlers } }] } },
    };
    return fake;
}

async function freshModule(): Promise<typeof SetClozeMathMacro> {
    let loaded: typeof SetClozeMathMacro | undefined;
    await jest.isolateModulesAsync(async () => {
        loaded = (await import("src/math/cloze-macro")).setClozeMathMacro;
    });
    return loaded;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

test("on registers the command once; off takes out exactly what was put in, once", async () => {
    const set = await freshModule();
    const fake = install(true);
    await set(true);
    await set(true);
    expect(fake.added).toHaveLength(1);
    await set(false);
    await set(false);
    expect(fake.removedFromConfiguration).toHaveLength(1);
});

test("a \\cloze defined by someone else is left alone, on and off", async () => {
    const set = await freshModule();
    const fake = install(true, ["cloze"]);
    await set(true);
    await set(false);
    expect(fake.added).toHaveLength(0);
    expect(fake.removedFromConfiguration).toHaveLength(0);
    expect(fake.removedMacros).toHaveLength(0);
});

test("when the command map is unreachable, a \\newcommand stands in and off removes it", async () => {
    const set = await freshModule();
    const fake = install(false);
    (renderMath as jest.Mock).mockImplementation(() => {
        fake.macros.add("cloze");
    });
    await set(true);
    expect(renderMath).toHaveBeenCalledWith("\\newcommand{\\cloze}[3][]{#2}", false);
    expect(finishRenderMath).toHaveBeenCalled();
    await set(false);
    expect(fake.removedMacros).toEqual(["cloze"]);
});

test("when the stand-in does not take, nothing is owned and off removes nothing", async () => {
    const set = await freshModule();
    const fake = install(false);
    await set(true);
    await set(false);
    expect(fake.removedMacros).toHaveLength(0);
});

test("a failure is logged, not thrown", async () => {
    const set = await freshModule();
    install(true);
    (loadMathJax as jest.Mock).mockRejectedValueOnce(new Error("no mathjax"));
    await expect(set(true)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("\\cloze"),
        expect.any(Error),
    );
});
