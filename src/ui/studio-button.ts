import { ButtonComponent, IconName } from "obsidian";

export interface StudioButtonProps {
    /** Classes added after `fs-button`. */
    classNames?: string[];
    icon?: IconName;
    /** The hover text, also the accessible name when the button shows only an icon. */
    tooltip?: string;
    text?: string;
    onClick?: (evt: MouseEvent) => void | Promise<void>;
}

/** The plugin's button: Obsidian's button with the `fs-button` class and its settings given at once. */
export default class StudioButton extends ButtonComponent {
    constructor(container: HTMLElement, props: StudioButtonProps = {}) {
        super(container);
        const { classNames = [], icon, text, tooltip, onClick } = props;
        this.buttonEl.addClass("fs-button", ...classNames);
        if (icon !== undefined) this.setIcon(icon);
        if (text !== undefined) this.setButtonText(text);
        if (tooltip !== undefined) {
            this.setTooltip(tooltip);
            this.buttonEl.setAttribute("aria-label", tooltip);
        }
        if (onClick !== undefined) this.onClick(onClick);
    }
}
