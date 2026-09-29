export interface CardParts {
    card: HTMLElement;
    /** Right side of the header, for a toggle. */
    actions: HTMLElement;
    body: HTMLElement;
    /** Sets the muted line under the title. */
    setSummary: (text: string) => void;
}

/**
 * A titled card of the statistics grid.
 *
 * @param wide - Spans both columns of the grid.
 * @param section - Names the card, so a metric tile can scroll to it.
 */
export function createCard(
    parent: HTMLElement,
    title: string,
    options: { wide?: boolean; summary?: string; cls?: string; section?: string } = {},
): CardParts {
    const card = parent.createDiv({ cls: "sr-stats-card fs-card" });
    if (options.wide) card.addClass("is-wide");
    if (options.cls) card.addClass(options.cls);
    if (options.section) card.setAttribute("data-section", options.section);

    const head = card.createDiv({ cls: "sr-stats-card-head" });
    const titles = head.createDiv({ cls: "sr-stats-card-titles" });
    titles.createEl("h3", { cls: "sr-stats-card-title", text: title });
    const summary = titles.createDiv({ cls: "sr-stats-card-summary", text: options.summary ?? "" });
    const actions = head.createDiv({ cls: "sr-stats-card-actions" });
    const body = card.createDiv({ cls: "sr-stats-card-body" });

    return {
        card,
        actions,
        body,
        setSummary: (text: string) => {
            summary.setText(text);
        },
    };
}

export interface SegmentItem<T extends string> {
    value: T;
    label: string;
}

/**
 * A row of buttons of which exactly one is selected, like iOS segmented controls.
 */
export function createSegmented<T extends string>(
    parent: HTMLElement,
    items: SegmentItem<T>[],
    current: T,
    ariaLabel: string,
    onChange: (value: T) => void,
): HTMLElement {
    const group = parent.createDiv({
        cls: "sr-stats-segmented",
        attr: { role: "group", "aria-label": ariaLabel },
    });
    const buttons = new Map<T, HTMLButtonElement>();

    const select = (value: T): void => {
        buttons.forEach((button, key) => {
            button.setAttribute("aria-pressed", String(key === value));
            button.toggleClass("is-active", key === value);
        });
    };

    for (const item of items) {
        const button = group.createEl("button", {
            cls: "sr-stats-segment",
            text: item.label,
            attr: { type: "button", "data-value": item.value },
        });
        buttons.set(item.value, button);
        button.addEventListener("click", () => {
            if (button.hasClass("is-active")) return;
            select(item.value);
            onChange(item.value);
        });
    }
    select(current);
    return group;
}

/**
 * A key of coloured dots and their names, shown above a chart with more than one series, each with an optional
 * total.
 */
export function createLegend(
    parent: HTMLElement,
    items: { label: string; cls: string; value?: string }[],
): void {
    const legend = parent.createDiv({ cls: "sr-stats-legend" });
    for (const item of items) {
        const entry = legend.createDiv({ cls: "sr-stats-legend-item" });
        entry.createSpan({ cls: `sr-stats-swatch ${item.cls}` });
        entry.createSpan({ cls: "sr-stats-legend-label", text: item.label });
        if (item.value !== undefined) {
            entry.createSpan({ cls: "sr-stats-legend-value", text: item.value });
        }
    }
}

/**
 * A short muted line, used for notes and empty charts.
 */
export function createNote(parent: HTMLElement, text: string): HTMLElement {
    return parent.createDiv({ cls: "sr-stats-note", text });
}
