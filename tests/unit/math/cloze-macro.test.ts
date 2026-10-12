import { readFileSync } from "fs";

import { MathJaxLike, registerClozeCommand, unregisterClozeCommand } from "src/math/cloze-macro";

const golden = JSON.parse(readFileSync("tests/unit/math/golden/cloze-math-macro.json", "utf8")) as {
    input: { kind: string; variant?: string; rest?: string };
    output: unknown;
}[];
const rows = (kind: string) => golden.filter((row) => row.input.kind === kind);

type Method = (parser: FakeParser, name: string) => void;

/** A parser that reads TeX the way MathJax's does for the calls the command makes. */
class FakeParser {
    i = 0;
    constructor(public string: string) {}

    GetNext(): string {
        while (/\s/.test(this.string[this.i] ?? "")) this.i++;
        return this.string[this.i] ?? "";
    }

    private group(open: string, close: string): string {
        let depth = 0;
        for (let at = this.i; at < this.string.length; at++) {
            const char = this.string[at];
            if (char === "\\") at++;
            else if (char === open) depth++;
            else if (char === close && --depth === 0) {
                const inside = this.string.slice(this.i + 1, at);
                this.i = at + 1;
                return inside;
            }
        }
        throw new Error("Missing close");
    }

    GetBrackets(_name: string, fallback: string): string {
        return this.GetNext() === "[" ? this.group("[", "]") : fallback;
    }

    GetArgument(_name: string): string {
        if (this.GetNext() !== "{") throw new Error("Missing argument");
        return this.group("{", "}");
    }
}

const addArgs = (_parser: FakeParser, first: string, second: string): string =>
    /^[a-z]/i.test(second) && /\\[a-z]+$/i.test(first) ? `${first} ${second}` : first + second;

interface Recorded {
    added: unknown[][];
    constructed: { ctor: string; json: unknown }[];
    methods: Record<string, Method>[];
}

function fakeMathJax(
    shape: "symbolmap" | "tokenmap" | "parseutil-alt" | "no-commandmap" | "no-handlers",
) {
    const record: Recorded = { added: [], constructed: [], methods: [] };
    class CommandMap {
        constructor(name: string, json: unknown, methods: Record<string, Method>) {
            record.constructed.push({ ctor: name, json });
            record.methods.push(methods);
        }
    }
    const handlers = { add: (...args: unknown[]) => record.added.push(args) };
    const tex: NonNullable<NonNullable<MathJaxLike["_"]>["input"]>["tex"] = {
        ParseUtil:
            shape === "parseutil-alt" ? { ParseUtil: { addArgs } } : { default: { addArgs } },
    };
    if (shape === "symbolmap") tex.SymbolMap = { CommandMap };
    if (shape === "tokenmap" || shape === "parseutil-alt") tex.TokenMap = { CommandMap };
    const jax = {
        _: { input: { tex } },
        startup: {
            document: {
                inputJax: [
                    { name: "SVG" },
                    { name: "TeX", parseOptions: shape === "no-handlers" ? {} : { handlers } },
                ],
            },
        },
    } as unknown as MathJaxLike;
    return { jax, record };
}

describe("registerClozeCommand: golden rows", () => {
    test.each(rows("register").filter((row) => row.input.variant !== "undefined / {} / partial"))(
        "$input.variant",
        ({ input, output }) => {
            const { jax, record } = fakeMathJax(input.variant as never);
            const map = registerClozeCommand(jax);
            expect({
                returnedNull: map === null,
                added: record.added,
                constructed: record.constructed,
            }).toEqual(output);
        },
    );

    test("undefined, an empty object and a partial object register nothing", () => {
        expect(
            [undefined, {}, { startup: {} }].map((jax) => registerClozeCommand(jax) === null),
        ).toEqual(
            rows("register").find((row) => row.input.variant === "undefined / {} / partial").output,
        );
    });
});

describe("the \\cloze command", () => {
    test.each(rows("expand"))("$input.rest", ({ input, output }) => {
        const { jax, record } = fakeMathJax("symbolmap");
        registerClozeCommand(jax);
        const parser = new FakeParser(input.rest);
        parser.i = "\\cloze".length;
        const run = () => {
            record.methods[0].Cloze(parser, "\\cloze");
            return parser.string;
        };
        if ("throws" in (output as object)) expect(run).toThrow();
        else expect({ ok: run() }).toEqual(output);
    });
});

describe("unregisterClozeCommand: golden rows", () => {
    const mine = {};
    const jaxWith = (configuration: unknown): MathJaxLike => ({
        startup: {
            document: {
                inputJax: [
                    {
                        name: "TeX",
                        parseOptions: {
                            handlers: { get: () => ({ _configuration: configuration }) },
                        },
                    },
                ],
            },
        },
    });

    const listOf = () => {
        const items: unknown[] = [mine, "another", "third"];
        return {
            items,
            configuration: {
                remove: (item: unknown) => {
                    const at = items.indexOf(item);
                    if (at >= 0) items.splice(at, 1);
                },
            },
        };
    };

    test.each(rows("unregister").filter((row) => row.input.variant === "present among others"))(
        "$input.variant",
        ({ output }) => {
            const { items, configuration } = listOf();
            const returned = unregisterClozeCommand(jaxWith(configuration), mine);
            expect({ returned, remaining: items }).toEqual(output);
        },
    );

    test("a second call still returns true and removes nothing more", () => {
        const { items, configuration } = listOf();
        unregisterClozeCommand(jaxWith(configuration), mine);
        const expected = rows("unregister").find(
            (row) => row.input.variant === "second time",
        ).output;
        expect({
            returned: unregisterClozeCommand(jaxWith(configuration), mine),
            remaining: items,
        }).toEqual(expected);
    });

    test("a list with no remove function gives false", () => {
        expect(unregisterClozeCommand(jaxWith({}), mine)).toBe(
            rows("unregister").find((row) => row.input.variant === "no remove fn").output,
        );
    });

    test("unreachable MathJax gives false", () => {
        expect(
            [undefined, {}, { startup: {} }].map((jax) =>
                unregisterClozeCommand(jax as never, mine),
            ),
        ).toEqual(rows("unregister").find((row) => row.input.variant === "unreachable").output);
    });
});
