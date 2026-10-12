import { t } from "src/lang/translate";
import StudioButton from "src/ui/studio-button";

/** The plain icon buttons of the card toolbar and the deck header. Each takes the extra classes its host asks for. */

type Press = () => void;

/** The look of one icon button: its classes, icon and the name it is given. */
interface IconSpec {
    classes: string[];
    icon: string;
    label: () => string;
}

const iconButton = (
    spec: IconSpec,
    container: HTMLElement,
    onClick: Press,
    extraClasses: string[],
): StudioButton =>
    new StudioButton(container, {
        tooltip: spec.label(),
        icon: spec.icon,
        classNames: spec.classes.concat(extraClasses),
        onClick,
    });

const BACK: IconSpec = { classes: ["fs-back-button"], icon: "arrow-left", label: () => t("BACK") };
const EDIT: IconSpec = { classes: ["fs-edit-button"], icon: "edit", label: () => t("EDIT_CARD") };
const RESET: IconSpec = {
    classes: ["fs-reset-button", "mod-warning"],
    icon: "history",
    label: () => t("RESET_CARD_PROGRESS"),
};
const SKIP: IconSpec = {
    classes: ["fs-skip-button"],
    icon: "chevrons-right",
    label: () => t("SKIP"),
};
const CLOSE: IconSpec = {
    classes: ["fs-modal-close-button"],
    icon: "x",
    label: () => t("CLOSE"),
};

export function createBackButton(
    container: HTMLElement,
    onClick: () => Promise<void>,
    classNames: string[] = [],
): StudioButton {
    return iconButton(BACK, container, () => void onClick(), classNames);
}

export function createEditButton(
    container: HTMLElement,
    onClick: () => void,
    classNames: string[] = [],
): StudioButton {
    return iconButton(EDIT, container, onClick, classNames);
}

/** Resets the card's progress. It stays disabled until the answer is up. */
export function createResetButton(
    container: HTMLElement,
    onClick: () => void,
    classNames: string[] = [],
): StudioButton {
    return iconButton(RESET, container, onClick, classNames);
}

export function createSkipButton(
    container: HTMLElement,
    onClick: () => void,
    classNames: string[] = [],
): StudioButton {
    return iconButton(SKIP, container, onClick, classNames);
}

/** Closes the modal the review is in. */
export function createCloseButton(
    container: HTMLElement,
    onClick: () => void,
    classNames: string[] = [],
): StudioButton {
    return iconButton(CLOSE, container, onClick, classNames);
}
