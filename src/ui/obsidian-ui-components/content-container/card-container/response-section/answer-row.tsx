import "src/ui/obsidian-ui-components/content-container/card-container/response-section/answer-row.css";
import { Platform } from "obsidian";

import { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { formatScheduleInterval } from "src/scheduling/display";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import GradeButton from "src/ui/obsidian-ui-components/content-container/card-container/response-section/rating-button";

const HIDDEN = "fs-is-hidden";

/** How each rating button looks: its colour class, its name in the class `fs-<name>-button`, and its icon. */
interface RatingLook {
    color: string;
    name: string;
    icon: string;
}

const LOOKS: Record<"again" | "hard" | "good" | "easy", RatingLook> = {
    again: { color: "fs-bg-red", name: "again", icon: "rotate-ccw" },
    hard: { color: "fs-bg-yellow", name: "hard", icon: "gauge" },
    good: { color: "fs-bg-blue", name: "good", icon: "check" },
    easy: { color: "fs-bg-green", name: "easy", icon: "chevrons-right" },
};

/**
 * The row under the card: "Show answer" before the answer is up, then the four rating buttons (in Cram mode only Again
 * and Easy). The Studio look draws them as tiles, the Classic look as flat bars.
 */
export default class ResponseSectionComponent {
    public readonly responseEl: HTMLDivElement;
    public readonly answerButton: GradeButton;
    public readonly againButton: GradeButton;
    public readonly hardButton: GradeButton;
    public readonly goodButton: GradeButton;
    public readonly easyButton: GradeButton;
    private readonly ratingButtons: GradeButton[];

    constructor(
        container: HTMLElement,
        settings: StudioSettings,
        showAnswer: () => void,
        processReview: (response: ReviewResponse) => Promise<void>,
    ) {
        const row = container.createDiv({ cls: "fs-response" });
        this.responseEl = row;

        this.answerButton = new GradeButton(row, {
            text: t("SHOW_ANSWER"),
            classNames: ["fs-bg-blue", "fs-show-answer-button"],
            onClick: showAnswer,
        });
        const build = (look: RatingLook, response: ReviewResponse, text: string) => {
            const tile = new GradeButton(row, {
                text,
                classNames: [look.color, `fs-${look.name}-button`, HIDDEN],
                onClick: () => processReview(response),
            });
            tile.setLeadingIcon(look.icon);
            return tile;
        };
        this.againButton = build(LOOKS.again, ReviewResponse.Again, settings.flashcardAgainText);
        this.hardButton = build(LOOKS.hard, ReviewResponse.Hard, settings.flashcardHardText);
        this.goodButton = build(LOOKS.good, ReviewResponse.Good, settings.flashcardGoodText);
        this.easyButton = build(LOOKS.easy, ReviewResponse.Easy, settings.flashcardEasyText);
        this.ratingButtons = [this.againButton, this.hardButton, this.goodButton, this.easyButton];
    }

    /** Before the answer: only "Show answer". */
    public resetResponseButtons(): void {
        this.setSuggested(null);
        this.responseEl.removeClass(HIDDEN);
        this.answerButton.buttonEl.removeClass(HIDDEN);
        for (const button of this.ratingButtons) button.buttonEl.addClass(HIDDEN);
    }

    /** Nothing to press: the waiting screen, and a multiple choice card whose tiles give the answer. */
    public hideAllButtons(): void {
        this.setSuggested(null);
        this.responseEl.addClass(HIDDEN);
        this.answerButton.buttonEl.addClass(HIDDEN);
        for (const button of this.ratingButtons) button.buttonEl.addClass(HIDDEN);
    }

    /**
     * After the answer. In Cram mode only Again and Easy show, by name; otherwise all four show with the interval each
     * leads to (one `scheduleFor` call per button).
     */
    public showRatingButtons(
        mode: FlashcardReviewMode,
        againText: string,
        hardText: string,
        goodText: string,
        easyText: string,
        showIntervals: boolean,
        scheduleFor: (response: ReviewResponse) => ScheduleState | null,
    ): void {
        this.responseEl.removeClass(HIDDEN);
        this.answerButton.buttonEl.addClass(HIDDEN);
        const cram = mode === FlashcardReviewMode.Cram;
        this.responseEl.toggleClass("is-cram", cram);
        this.hardButton.buttonEl.toggleClass(HIDDEN, cram);
        this.goodButton.buttonEl.toggleClass(HIDDEN, cram);
        this.againButton.buttonEl.removeClass(HIDDEN);
        this.easyButton.buttonEl.removeClass(HIDDEN);

        if (cram) {
            this.setupEaseButton(this.againButton, againText, null, false);
            this.setupEaseButton(this.easyButton, easyText, null, false);
            return;
        }
        const buttons: [GradeButton, string, ReviewResponse][] = [
            [this.againButton, againText, ReviewResponse.Again],
            [this.hardButton, hardText, ReviewResponse.Hard],
            [this.goodButton, goodText, ReviewResponse.Good],
            [this.easyButton, easyText, ReviewResponse.Easy],
        ];
        for (const [button, name, response] of buttons) {
            this.setupEaseButton(button, name, scheduleFor(response), showIntervals);
        }
    }

    /**
     * Outlines a button and tags it "Suggested", or clears the suggestion for null. The person still rates. Cram mode
     * has no Good button, so a suggested Good goes to Easy.
     */
    public setSuggested(response: ReviewResponse | null): void {
        for (const button of this.ratingButtons) {
            button.buttonEl.removeClass("fs-suggested");
            button.buttonEl.querySelector(".fs-suggested-tag")?.remove();
        }
        if (response === null) return;
        const target =
            response === ReviewResponse.Good && this.responseEl.hasClass("is-cram")
                ? ReviewResponse.Easy
                : response;
        const button = this.buttonFor(target);
        if (button === null || button.buttonEl.hasClass(HIDDEN)) return;
        button.buttonEl.addClass("fs-suggested");
        button.buttonEl.createSpan({ cls: "fs-suggested-tag", text: t("SUGGESTED") });
    }

    /** The button the Enter and Space keys press after the answer: Good, or Easy in Cram mode. */
    public get defaultButton(): GradeButton {
        return this.responseEl.hasClass("is-cram") ? this.easyButton : this.goodButton;
    }

    private buttonFor(response: ReviewResponse): GradeButton | null {
        const byResponse = new Map<ReviewResponse, GradeButton>([
            [ReviewResponse.Again, this.againButton],
            [ReviewResponse.Hard, this.hardButton],
            [ReviewResponse.Good, this.goodButton],
            [ReviewResponse.Easy, this.easyButton],
        ]);
        return byResponse.get(response) ?? null;
    }

    /**
     * Fills a button: the Studio look shows the label and the interval; the Classic look shows one of two texts, the
     * interval alone on a phone, or "Name - interval" elsewhere (narrow panes swap the large text for the small one).
     */
    private setupEaseButton(
        button: GradeButton,
        name: string,
        schedule: ScheduleState | null,
        showInterval: boolean,
    ): void {
        const compact = showInterval ? formatScheduleInterval(schedule, true) : "";
        button.setLabelAndInterval(name, compact);
        button.setSmallText(showInterval ? compact : name);
        button.setLargeText(
            showInterval ? `${name} - ${formatScheduleInterval(schedule, false)}` : name,
        );
        const small = showInterval && Platform.isMobile;
        button.buttonEl.toggleClass("fs-show-small-text", small);
        button.buttonEl.toggleClass("fs-show-large-text", !small);
    }
}
