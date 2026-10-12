import { IconName, setIcon } from "obsidian";

import StudioButton from "src/ui/studio-button";

/**
 * A button of the answer row. It carries four spans: the Classic look shows the small or the large one (a short interval
 * or "Name - interval"), the Studio look shows a leading icon, the label and the interval.
 */
export default class GradeButton extends StudioButton {
    private readonly smallText: HTMLSpanElement;
    private readonly largeText: HTMLSpanElement;
    private readonly labelText: HTMLSpanElement;
    private readonly intervalText: HTMLSpanElement;

    constructor(
        container: HTMLElement,
        props: {
            classNames?: string[];
            icon?: IconName;
            tooltip?: string;
            text?: string;
            onClick: () => void | Promise<void>;
        },
    ) {
        const { text, classNames = [], ...rest } = props;
        super(container, { ...rest, classNames: classNames.concat("fs-response-button") });
        const { buttonEl } = this;
        buttonEl.empty();
        const span = (cls: string) => buttonEl.createSpan({ cls });
        this.smallText = span("fs-small-text");
        this.largeText = span("fs-large-text");
        this.labelText = span("fs-button-label");
        this.intervalText = span("fs-button-interval");
        if (text !== undefined) {
            this.setSmallText(text);
            this.setLargeText(text);
            this.labelText.setText(text);
        }
    }

    /** An icon above the label, for the Studio look (the Classic look hides it). */
    public setLeadingIcon(icon: string): void {
        const holder = createSpan({ cls: "fs-button-icon" });
        setIcon(holder, icon);
        this.buttonEl.prepend(holder);
    }

    public setLabelAndInterval(label: string, interval: string): void {
        this.labelText.setText(label);
        this.intervalText.setText(interval);
        this.buttonEl.toggleClass("fs-has-interval", interval !== "");
    }

    public setSmallText(text: string): void {
        this.smallText.setText(text);
    }

    public setLargeText(text: string): void {
        this.largeText.setText(text);
    }
}
