import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

// `\cloze` is not a real LaTeX command, so MathJax reports an error for `$\cloze{g(x)}{h}$` unless it is
// taught the macro. This defines it as "show the first argument (the answer)", so a note reads as the plain
// formula. The review renders the hidden and revealed forms itself (see math-cloze.ts).
//
// The idea comes from upstream PR #1584 by ievlevpn (MIT). The differences: the macro is defined only while the
// setting is on, a `\cloze` that another plugin or the user already defined is left alone, and the macro is
// removed again when the setting is turned off or the plugin unloads, so it never outlives the plugin.
//
// Obsidian's MathJax keeps `\def` macros for the whole session, in the "new-Command" map of the TeX input
// jax. There is no public API to remove one, so removal reaches into that map. It is feature detected and
// wrapped in try/catch: if a future Obsidian changes MathJax, the worst case is a macro that stays defined.
//
// A note that is already open keeps its earlier render until it is rebuilt (switch notes and back).

const MACRO_NAME = "cloze";
const MACRO_DEFINITION = "\\def\\cloze#1#2{#1}";

interface MacroMap {
    contains(name: string): boolean;
    remove(name: string): void;
}

interface MathJaxDocument {
    inputJax?: {
        parseOptions?: {
            handlers?: { retrieve(name: string): MacroMap | undefined };
        };
    }[];
}

// MathJax's `startup.document` is written with a string key: the lint rule against `document` is about the DOM one
interface MathJaxGlobal {
    startup?: { ["document"]?: MathJaxDocument };
}

// True when this plugin, and not somebody else, defined the macro
let ownsMacro = false;

function findMacroMap(): MacroMap | null {
    const mathJax = (window as unknown as { MathJax?: MathJaxGlobal }).MathJax;
    const handlers = mathJax?.startup?.["document"]?.inputJax?.[0]?.parseOptions?.handlers;
    const map = handlers?.retrieve("new-Command");
    return map && typeof map.contains === "function" && typeof map.remove === "function"
        ? map
        : null;
}

/**
 * Defines the `\cloze` macro (`enabled`) or removes it again, if this plugin defined it.
 */
export async function setClozeMathMacro(enabled: boolean): Promise<void> {
    try {
        if (enabled) {
            if (ownsMacro) return;

            await loadMathJax();
            // Someone else's `\cloze` is not ours to replace, or to remove later
            if (findMacroMap()?.contains(MACRO_NAME)) return;

            renderMath(MACRO_DEFINITION, false);
            await finishRenderMath();
            ownsMacro = findMacroMap()?.contains(MACRO_NAME) === true;
        } else if (ownsMacro) {
            findMacroMap()?.remove(MACRO_NAME);
            ownsMacro = false;
        }
    } catch (error) {
        console.warn("Flashcard Studio: could not update the \\cloze MathJax macro", error);
    }
}
