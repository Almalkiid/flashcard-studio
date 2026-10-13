/**
 * Puts `is-focus-visible` on `label` while its `input` shows the keyboard focus ring, which is when the input matches
 * `:focus-visible`. A label that holds a hidden input draws the ring itself, and a style sheet cannot ask the label
 * about its input without `:has`.
 */
export function markFocusVisible(label: HTMLElement, input: HTMLInputElement): void {
    const update = () => label.toggleClass("is-focus-visible", input.matches(":focus-visible"));
    // A key pressed while the input has the focus also starts the ring, whatever gave it the focus
    for (const type of ["focus", "keydown", "keyup"]) input.addEventListener(type, update);
    input.addEventListener("blur", () => label.removeClass("is-focus-visible"));
}
