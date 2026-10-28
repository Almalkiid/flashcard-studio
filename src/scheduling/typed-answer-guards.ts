function multiset(values: string[]): string {
    return JSON.stringify(values.sort());
}

export function typedAnswerGuardVeto(expected: string, typed: string): boolean {
    // Digit numbers, including decimals and signs, must have the same multiplicities; words stay with the model.
    const numbers = (text: string) => text.match(/[+\-−]?(?:\d+(?:\.\d+)?|\.\d+)/g) ?? [];
    if (multiset(numbers(expected)) !== multiset(numbers(typed))) return true;
    // Symbolic and written inequalities must agree, including strict versus inclusive comparisons.
    const operators = (text: string) =>
        (
            text
                .toLowerCase()
                .match(
                    /<=|>=|[<>≤≥]|\b(?:less|fewer) than or equal to\b|\b(?:more|greater) than or equal to\b|\b(?:less|fewer) than\b|\b(?:more|greater) than\b/g,
                ) ?? []
        ).map((op) =>
            op.endsWith("or equal to")
                ? /^(?:less|fewer)/.test(op)
                    ? "≤"
                    : "≥"
                : /^(?:less|fewer) than$/.test(op)
                  ? "<"
                  : /^(?:more|greater) than$/.test(op)
                    ? ">"
                    : ({ "<=": "≤", ">=": "≥" }[op] ?? op),
        );
    if (multiset(operators(expected)) !== multiset(operators(typed))) return true;
    // A negation on just one side vetoes equivalence; interpreting negation stays with the model.
    const negation = /\b(?:not|no|never|none|cannot|without)\b|n['’]t\b/i;
    return negation.test(expected) !== negation.test(typed);
}
