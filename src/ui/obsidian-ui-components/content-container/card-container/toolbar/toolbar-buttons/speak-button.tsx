import { t } from "src/lang/helpers";
import SRButtonComponent from "src/ui/sr-button";

/**
 * Reads the side of the card that is showing. Only made where the device can speak.
 */
export default class SpeakButtonComponent extends SRButtonComponent {
    public constructor(
        container: HTMLElement,
        speakClickHandler: () => void,
        classNames?: string[],
    ) {
        super(container, {
            classNames: ["sr-speak-button", "fs-speak-button", ...(classNames ?? [])],
            icon: "volume-2",
            tooltip: t("READ_ALOUD"),
            onClick: () => {
                speakClickHandler();
            },
        });
    }
}
