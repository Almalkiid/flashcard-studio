import SRButtonComponent from "src/ui/sr-button";

export default class SRResponseButtonComponent extends SRButtonComponent {
    private smallText: HTMLSpanElement;
    private largeText: HTMLSpanElement;
    // Used by the Studio look: the button's name on one line and the next interval below it
    private labelText: HTMLSpanElement;
    private intervalText: HTMLSpanElement;

    constructor(
        container: HTMLElement,
        props: {
            classNames?: string[];
            icon?: string;
            tooltip?: string;
            text?: string;
            onClick: () => void | Promise<void>;
        },
    ) {
        super(container, {
            classNames: ["sr-response-button", ...(props.classNames ?? [])],
            icon: props.icon,
            tooltip: props.tooltip,
            text: props.text,
            onClick: props.onClick,
        });

        this.buttonEl.setText("");

        this.smallText = this.buttonEl.createSpan();
        this.smallText.addClass("sr-small-text");

        this.largeText = this.buttonEl.createSpan();
        this.largeText.addClass("sr-large-text");

        this.labelText = this.buttonEl.createSpan({ cls: "sr-button-label" });
        this.intervalText = this.buttonEl.createSpan({ cls: "sr-button-interval" });

        if (props.text) {
            this.smallText.setText(props.text);
            this.largeText.setText(props.text);
            this.labelText.setText(props.text);
        }
    }

    public setLabelAndInterval(label: string, interval: string) {
        this.labelText.setText(label);
        this.intervalText.setText(interval);
        this.buttonEl.toggleClass("sr-has-interval", interval.length > 0);
    }

    public setSmallText(text: string) {
        this.smallText.setText(text);
    }

    public setLargeText(text: string) {
        this.largeText.setText(text);
    }
}
