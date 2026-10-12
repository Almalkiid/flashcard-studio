/** How a review session treats an answer. The numbers are part of the contract (Cram 0, Review 1). */
export enum FlashcardReviewMode {
    /** Practice: nothing is rescheduled; Easy takes the card out of the session, any other answer sends it to the back. */
    Cram,
    /** Every answer reschedules the card and is written to its note. */
    Review,
}
