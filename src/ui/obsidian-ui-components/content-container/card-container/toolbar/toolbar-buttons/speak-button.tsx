import { t } from "src/lang/translate";
import StudioButton from "src/ui/studio-button";

/**
 * Reads the side of the card that is showing. Only made where the device can speak.
 */
export default class SpeakButtonComponent extends StudioButton {
    public constructor(container: HTMLElement, onSpeak: () => void, extraClasses: string[] = []) {
        super(container, {
            tooltip: t("READ_ALOUD"),
            icon: "volume-2",
            classNames: ["fs-speak-button", ...extraClasses],
            onClick: () => onSpeak(),
        });
    }
}
