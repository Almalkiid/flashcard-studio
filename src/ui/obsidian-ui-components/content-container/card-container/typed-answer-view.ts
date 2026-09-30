import { setIcon } from "obsidian";

import { t } from "src/lang/helpers";
import { DiffPart, TypedComparison } from "src/scheduling/typed-answer";
import { TextDirection } from "src/utils/strings";

/**
 * The text field under the question. Enter (not while composing text with an input method) calls `onSubmit`.
 */
export function renderTypedInput(
    parent: HTMLElement,
    opts: { autofocus: boolean; onSubmit: () => void; textDirection?: TextDirection },
): HTMLInputElement {
    const wrap = parent.createDiv({ cls: "fs-typed" });
    if (opts.textDirection === TextDirection.Rtl) wrap.setAttribute("dir", "rtl");
    const input = wrap.createEl("input", {
        cls: "fs-typed-input",
        type: "text",
        attr: {
            placeholder: t("TYPED_ANSWER_PLACEHOLDER"),
            "aria-label": t("TYPED_ANSWER_PLACEHOLDER"),
            autocomplete: "off",
            autocapitalize: "off",
            autocorrect: "off",
            spellcheck: "false",
            enterkeyhint: "go",
        },
    });
    input.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        input.blur();
        opts.onSubmit();
    });
    if (opts.autofocus) input.focus();
    return input;
}

function addParts(line: HTMLElement, parts: DiffPart[]): void {
    for (const part of parts) line.createSpan({ cls: `fs-typed-${part.kind}`, text: part.text });
}

/**
 * What was typed with each letter marked right or wrong, an arrow, and the expected answer with the letters that
 * were left out marked. An exact answer shows just the one line.
 */
export function renderTypedResult(
    parent: HTMLElement,
    comparison: TypedComparison,
    textDirection?: TextDirection,
): HTMLElement {
    const box = parent.createDiv({ cls: "fs-typed-result" });
    if (textDirection === TextDirection.Rtl) box.setAttribute("dir", "rtl");
    box.toggleClass("is-exact", comparison.exact);
    const typedLine = box.createDiv({ cls: "fs-typed-line fs-typed-typed" });
    addParts(typedLine, comparison.typed);
    if (comparison.exact) {
        setIcon(typedLine.createSpan({ cls: "fs-typed-check" }), "check");
        return box;
    }
    setIcon(box.createDiv({ cls: "fs-typed-arrow" }), "arrow-down");
    addParts(box.createDiv({ cls: "fs-typed-line fs-typed-expected" }), comparison.expected);
    return box;
}
