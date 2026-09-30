export interface ChoiceOption {
    text: string;
    correct: boolean;
}

export interface MultipleChoice {
    /** Answer text before the list (usually empty). */
    lead: string;
    options: ChoiceOption[];
    /** Answer text after the list, trimmed. */
    explanation: string;
    /** More than one option is correct. */
    multiSelect: boolean;
}

// `- [ ] text`, `* [x] text`, `+ [X] text`; the text may be empty (that makes the card an ordinary one)
const TASK_LINE = /^(\s*)([-*+])\s+\[([ xX])\](?:\s+(.*))?$/;
const BULLET_LINE = /^\s*[-*+](\s|$)/;

/**
 * Reads an answer as a multiple choice question: one top-level task list of at least two items, at least one
 * checked. Anything that is only almost a checklist (a single item, nothing checked, nested tasks, a plain bullet
 * among the items, an empty item, a second task list) is not, and stays an ordinary card.
 */
export function parseMultipleChoice(back: string): MultipleChoice | null {
    const lines = back.split(/\r?\n/);
    const lead: string[] = [];
    const explanation: string[] = [];
    const options: ChoiceOption[] = [];
    let baseIndent = 0;
    let marker = "";
    let phase: "lead" | "list" | "after" = "lead";
    let blankLines = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const task = TASK_LINE.exec(line);

        if (phase === "after") {
            if (task) return null; // a second task list
            explanation.push(line);
            continue;
        }

        if (phase === "lead") {
            if (!task) {
                lead.push(line);
                continue;
            }
            // A plain bullet right above the first task is one list with the tasks: a mixed list
            if (i > 0 && BULLET_LINE.test(lines[i - 1])) return null;
            phase = "list";
            baseIndent = task[1].length;
            marker = task[2];
        } else if (task) {
            // Nested tasks, or a list that changes its bullet, are not one plain list
            if (task[1].length !== baseIndent || task[2] !== marker) return null;
        } else if (line.trim() === "") {
            blankLines++;
            continue;
        } else if (line.length - line.trimStart().length > baseIndent) {
            // Under an item: the item's own text goes on
            const last = options[options.length - 1];
            last.text += `${blankLines > 0 ? "\n\n" : "\n"}${line.trim()}`;
            blankLines = 0;
            continue;
        } else if (BULLET_LINE.test(line)) {
            return null; // a plain bullet among the items
        } else {
            phase = "after";
            explanation.push(line);
            continue;
        }

        options.push({ text: (task[4] ?? "").trim(), correct: task[3] !== " " });
        blankLines = 0;
    }

    for (const option of options) option.text = option.text.trim();
    if (options.length < 2 || options.some((option) => option.text === "")) return null;
    const correctCount = options.filter((option) => option.correct).length;
    if (correctCount === 0) return null;

    return {
        lead: lead.join("\n").trim(),
        options,
        explanation: explanation.join("\n").trim(),
        multiSelect: correctCount > 1,
    };
}

/**
 * A random order of 0..count-1 (Fisher-Yates), so the same options can be shown in another order each time.
 */
export function shuffledOrder(count: number, random: () => number): number[] {
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/**
 * Whether the chosen options (indices into `mc.options`) are exactly the right ones. Choosing nothing is never right.
 */
export function isChoiceCorrect(mc: MultipleChoice, chosen: number[]): boolean {
    const picked = new Set(chosen);
    if (picked.size === 0) return false;
    return mc.options.every((option, index) => option.correct === picked.has(index));
}
