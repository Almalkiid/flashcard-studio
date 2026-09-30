import "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css";
import { Platform } from "obsidian";

import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { formatScheduleInterval } from "src/scheduling/algorithms/schedule-display";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import SRResponseButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/sr-response-button";
import EmulatedPlatform from "src/utils/platform-detector";

export default class ResponseSectionComponent {
    public responseEl: HTMLDivElement;
    public againButton: SRResponseButtonComponent;
    public hardButton: SRResponseButtonComponent;
    public goodButton: SRResponseButtonComponent;
    public easyButton: SRResponseButtonComponent;
    public answerButton: SRResponseButtonComponent;

    constructor(
        container: HTMLElement,
        settings: SRSettings,
        showAnswer: () => void,
        processReview: (response: ReviewResponse) => Promise<void>,
    ) {
        this.responseEl = container.createDiv();
        this.responseEl.addClass("sr-response");

        this.answerButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-blue", "sr-show-answer-button"],
            text: t("SHOW_ANSWER"),
            onClick: () => {
                showAnswer();
            },
        });

        this.againButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-red", "sr-again-button", "sr-is-hidden"],
            text: settings.flashcardAgainText,
            onClick: async () => {
                await processReview(ReviewResponse.Again);
            },
        });

        this.hardButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-yellow", "sr-hard-button", "sr-is-hidden"],
            text: settings.flashcardHardText,
            onClick: async () => {
                await processReview(ReviewResponse.Hard);
            },
        });

        this.goodButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-blue", "sr-good-button", "sr-is-hidden"],
            text: settings.flashcardGoodText,
            onClick: async () => {
                await processReview(ReviewResponse.Good);
            },
        });

        this.easyButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-green", "sr-easy-button", "sr-is-hidden"],
            text: settings.flashcardEasyText,
            onClick: async () => {
                await processReview(ReviewResponse.Easy);
            },
        });

        // Icons for the Studio look (hidden by CSS in the Classic look)
        this.againButton.setLeadingIcon("rotate-ccw");
        this.hardButton.setLeadingIcon("gauge");
        this.goodButton.setLeadingIcon("check");
        this.easyButton.setLeadingIcon("chevrons-right");
    }

    /**
     * Outlines a button and tags it "Suggested", or clears the suggestion for null. The person still rates. In cram
     * mode, which has no Good button, a suggested Good goes to Easy.
     */
    public setSuggested(response: ReviewResponse | null) {
        for (const button of [
            this.againButton,
            this.hardButton,
            this.goodButton,
            this.easyButton,
        ]) {
            button.buttonEl.removeClass("fs-suggested");
            button.buttonEl.querySelector(".fs-suggested-tag")?.remove();
        }
        if (response === null) return;
        const target =
            response === ReviewResponse.Good && this.responseEl.hasClass("is-cram")
                ? ReviewResponse.Easy
                : response;
        const button = this.buttonFor(target);
        if (button === null || button.buttonEl.hasClass("sr-is-hidden")) return;
        button.buttonEl.addClass("fs-suggested");
        button.buttonEl.createSpan({ cls: "fs-suggested-tag", text: t("SUGGESTED") });
    }

    private buttonFor(response: ReviewResponse): SRResponseButtonComponent | null {
        switch (response) {
            case ReviewResponse.Again:
                return this.againButton;
            case ReviewResponse.Hard:
                return this.hardButton;
            case ReviewResponse.Good:
                return this.goodButton;
            case ReviewResponse.Easy:
                return this.easyButton;
            default:
                return null;
        }
    }

    public resetResponseButtons() {
        this.setSuggested(null);
        // Sets all buttons in to their default state
        if (this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.removeClass("sr-is-hidden");
        }
        this.answerButton.buttonEl.removeClass("sr-is-hidden");
        this.againButton.buttonEl.addClass("sr-is-hidden");
        this.hardButton.buttonEl.addClass("sr-is-hidden");
        this.goodButton.buttonEl.addClass("sr-is-hidden");
        this.easyButton.buttonEl.addClass("sr-is-hidden");
    }

    public hideAllButtons() {
        this.setSuggested(null);
        if (!this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.addClass("sr-is-hidden");
        }
        this.answerButton.buttonEl.addClass("sr-is-hidden");
        this.againButton.buttonEl.addClass("sr-is-hidden");
        this.hardButton.buttonEl.addClass("sr-is-hidden");
        this.goodButton.buttonEl.addClass("sr-is-hidden");
        this.easyButton.buttonEl.addClass("sr-is-hidden");
    }

    public showRatingButtons(
        reviewMode: FlashcardReviewMode,
        againButtonText: string,
        hardButtonText: string,
        goodButtonText: string,
        easyButtonText: string,
        showIntervalInReviewButtons: boolean,
        determineButtonSchedule: (response: ReviewResponse) => RepItemScheduleInfo | null,
    ) {
        if (this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.removeClass("sr-is-hidden");
        }
        // Shows the rating buttons and hides the show answer button
        this.answerButton.buttonEl.addClass("sr-is-hidden");

        if (reviewMode === FlashcardReviewMode.Cram) {
            this.responseEl.addClass("is-cram");
            // setButtonText would replace the button's inner spans, so set the texts through them
            this._setupEaseButton(this.againButton, againButtonText, null, false);
            this._setupEaseButton(this.easyButton, easyButtonText, null, false);

            if (this.againButton.buttonEl.hasClass("sr-is-hidden")) {
                this.againButton.buttonEl.removeClass("sr-is-hidden");
            }
            if (this.easyButton.buttonEl.hasClass("sr-is-hidden")) {
                this.easyButton.buttonEl.removeClass("sr-is-hidden");
            }

            if (!this.goodButton.buttonEl.hasClass("sr-is-hidden")) {
                this.goodButton.buttonEl.addClass("sr-is-hidden");
            }
            if (!this.hardButton.buttonEl.hasClass("sr-is-hidden")) {
                this.hardButton.buttonEl.addClass("sr-is-hidden");
            }
        } else {
            if (this.responseEl.hasClass("is-cram")) this.responseEl.removeClass("is-cram");
            this.againButton.buttonEl.removeClass("sr-is-hidden");
            this.hardButton.buttonEl.removeClass("sr-is-hidden");
            this.goodButton.buttonEl.removeClass("sr-is-hidden");
            this.easyButton.buttonEl.removeClass("sr-is-hidden");
            this._setupEaseButton(
                this.againButton,
                againButtonText,
                determineButtonSchedule(ReviewResponse.Again),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.hardButton,
                hardButtonText,
                determineButtonSchedule(ReviewResponse.Hard),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.goodButton,
                goodButtonText,
                determineButtonSchedule(ReviewResponse.Good),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.easyButton,
                easyButtonText,
                determineButtonSchedule(ReviewResponse.Easy),
                showIntervalInReviewButtons,
            );
        }
    }

    private _setupEaseButton(
        button: SRResponseButtonComponent,
        buttonName: string,
        schedule: RepItemScheduleInfo | null,
        showInterval: boolean,
    ) {
        button.setLabelAndInterval(
            buttonName,
            showInterval ? formatScheduleInterval(schedule, true) : "",
        );
        if (showInterval) {
            button.setSmallText(formatScheduleInterval(schedule, true));
            button.setLargeText(`${buttonName} - ${formatScheduleInterval(schedule, false)}`);

            if (EmulatedPlatform().isMobile || Platform.isMobile) {
                if (button.buttonEl.hasClass("sr-show-large-text")) {
                    button.buttonEl.removeClass("sr-show-large-text");
                }
                if (!button.buttonEl.hasClass("sr-show-small-text")) {
                    button.buttonEl.addClass("sr-show-small-text");
                }
            } else {
                if (button.buttonEl.hasClass("sr-show-small-text")) {
                    button.buttonEl.removeClass("sr-show-small-text");
                }
                if (!button.buttonEl.hasClass("sr-show-large-text")) {
                    button.buttonEl.addClass("sr-show-large-text");
                }
            }
        } else {
            if (button.buttonEl.hasClass("sr-show-small-text")) {
                button.buttonEl.removeClass("sr-show-small-text");
            }
            if (!button.buttonEl.hasClass("sr-show-large-text")) {
                button.buttonEl.addClass("sr-show-large-text");
            }
            button.setLargeText(buttonName);
        }
    }
}
