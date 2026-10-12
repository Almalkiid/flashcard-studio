/**
 * Teaches MathJax the `\cloze[seq]{answer}{hint}` command, so a note shows just the answer in normal
 * preview. Only while the "Clozes in math" setting is on, and never over a `\cloze` someone else defined.
 */
import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

interface MacroMapLike {
    contains?: (name: string) => boolean;
    remove?: (name: string) => void;
}

interface HandlersLike {
    add?: (config: unknown, fallback: unknown, priority: number) => void;
    get?: (name: string) => { _configuration?: { remove?: (map: unknown) => void } } | undefined;
    retrieve?: (name: string) => MacroMapLike | undefined;
}

interface TexInputJaxLike {
    name?: string;
    parseOptions?: { handlers?: HandlersLike };
}

interface ParserLike {
    string: string;
    i: number;
    GetBrackets: (name: string, fallback: string) => string;
    GetArgument: (name: string) => string;
    GetNext: () => string;
}

type CommandMapClass = new (
    name: string,
    commands: Record<string, string>,
    methods: Record<string, (parser: ParserLike, name: string) => void>,
) => unknown;

interface ParseUtilLike {
    addArgs: (parser: ParserLike, first: string, second: string) => string;
}

export interface MathJaxLike {
    _?: {
        input?: {
            tex?: {
                SymbolMap?: { CommandMap?: CommandMapClass };
                TokenMap?: { CommandMap?: CommandMapClass };
                ParseUtil?: { default?: ParseUtilLike; ParseUtil?: ParseUtilLike };
            };
        };
    };
    /** MathJax's own page document, not the DOM one. */
    startup?: { ["document"]?: { inputJax?: TexInputJaxLike[] } };
}

const MAP_NAME = "fs-cloze";
const MAP_PRIORITY = -100;

const handlersOf = (mathJax: MathJaxLike | undefined): HandlersLike | undefined =>
    mathJax?.startup?.["document"]?.inputJax?.find((jax) => jax.name === "TeX")?.parseOptions
        ?.handlers;

/** Adds the command map to MathJax's TeX parser. Returns the map, or null when MathJax is not shaped as expected. */
export function registerClozeCommand(mathJax: MathJaxLike | undefined): unknown {
    const tex = mathJax?._?.input?.tex;
    const CommandMap = tex?.SymbolMap?.CommandMap ?? tex?.TokenMap?.CommandMap;
    const parseUtil = tex?.ParseUtil?.default ?? tex?.ParseUtil?.ParseUtil;
    const handlers = handlersOf(mathJax);
    if (!CommandMap || !parseUtil || !handlers?.add) return null;

    // The macro expands to its answer followed by the rest of the input; the bracket and the hint are dropped.
    const Cloze = (parser: ParserLike, name: string): void => {
        parser.GetBrackets(name, "");
        const answer = parser.GetArgument(name);
        if (parser.GetNext() === "{") parser.GetArgument(name);
        parser.string = parseUtil.addArgs(parser, answer, parser.string.slice(parser.i));
        parser.i = 0;
    };
    const map = new CommandMap(MAP_NAME, { cloze: "Cloze" }, { Cloze });
    handlers.add({ macro: [MAP_NAME] }, {}, MAP_PRIORITY);
    return map;
}

/** Takes `map` back out of the macro handler. False when MathJax cannot be reached that way. */
export function unregisterClozeCommand(mathJax: MathJaxLike | undefined, map: unknown): boolean {
    const configuration = handlersOf(mathJax)?.get?.("macro")?._configuration;
    if (typeof configuration?.remove !== "function") return false;
    configuration.remove(map);
    return true;
}

/** What this plugin put into MathJax, so only that is ever taken out again. */
let owned: { command: unknown } | { macro: true } | null = null;

const newCommandMap = (mathJax: MathJaxLike | undefined): MacroMapLike | null => {
    const map = handlersOf(mathJax)?.retrieve?.("new-Command");
    return typeof map?.contains === "function" && typeof map.remove === "function" ? map : null;
};

const currentMathJax = (): MathJaxLike | undefined =>
    (window as unknown as { MathJax?: MathJaxLike }).MathJax;

async function enable(): Promise<void> {
    if (owned) return;
    await loadMathJax();
    const mathJax = currentMathJax();
    if (newCommandMap(mathJax)?.contains?.("cloze")) return;

    const command = registerClozeCommand(mathJax);
    if (command) {
        owned = { command };
        return;
    }
    // Fallback: a plain \newcommand, which needs the hint argument to be there.
    renderMath("\\newcommand{\\cloze}[3][]{#2}", false);
    await finishRenderMath();
    if (newCommandMap(currentMathJax())?.contains?.("cloze")) owned = { macro: true };
}

function disable(): void {
    if (!owned) return;
    if ("command" in owned) unregisterClozeCommand(currentMathJax(), owned.command);
    else newCommandMap(currentMathJax())?.remove?.("cloze");
    owned = null;
}

/** Turns the `\cloze` MathJax command on or off. Never throws. */
export async function setClozeMathMacro(enabled: boolean): Promise<void> {
    try {
        if (enabled) await enable();
        else disable();
    } catch (error) {
        console.warn("Flashcard Studio: could not change the \\cloze MathJax command", error);
    }
}
