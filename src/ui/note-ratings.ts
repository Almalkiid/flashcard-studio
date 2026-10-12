import { StudioSettings } from "src/data/settings-model";
import { ReviewResponse } from "src/scheduling/schedule/review-item";

/** The three ways to rate a note, in the order the menus list them, with the user's own wording for each. */
export const NOTE_RATINGS = [
    {
        id: "easy",
        response: ReviewResponse.Easy,
        label: (s: StudioSettings) => s.flashcardEasyText,
    },
    {
        id: "good",
        response: ReviewResponse.Good,
        label: (s: StudioSettings) => s.flashcardGoodText,
    },
    {
        id: "hard",
        response: ReviewResponse.Hard,
        label: (s: StudioSettings) => s.flashcardHardText,
    },
] as const;
