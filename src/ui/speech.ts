// Read aloud with the device's own voices (the browser's speech synthesis): offline, free, and not there on
// every device, so everything here checks before it speaks.

/** What is not read: pictures, code, math and drawings, and image occlusion masks. */
const NOT_SPOKEN = "img, svg, code, pre, .fs-mask";
/** Where the text is cut, so the last word of one block does not run into the first of the next. */
const BLOCKS = "p, div, li, br, h1, h2, h3, h4, h5, h6, tr, blockquote";

/**
 * Whether this device can speak: the window has speech synthesis and can list voices. Some Android builds cannot.
 */
export function speechAvailable(win: Window = activeWindow): boolean {
    return "speechSynthesis" in win && typeof win.speechSynthesis?.getVoices === "function";
}

/**
 * The text to read for what an element shows: images, code, math and masks skipped, and every cloze blank ("[...]"
 * or a field to type in) said as "blank". The element is left as it was.
 */
export function speakableText(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(NOT_SPOKEN).forEach((skipped) => skipped.remove());
    clone.querySelectorAll("input.cloze-input").forEach((field) => field.replaceWith("blank"));
    clone.querySelectorAll(BLOCKS).forEach((block) => block.after(" "));
    return (clone.textContent ?? "")
        .replace(/\[\.\.\.\]/g, "blank")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Joins parts of a card into one text to read, each ending in a full stop unless it already ends in punctuation, so
 * the voice pauses between them.
 */
export function joinSpeech(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .map((part) => (/[.!?…:;؟]$/.test(part) ? part : `${part}.`))
        .join(" ");
}

function normalizeLanguage(lang: string): string {
    return lang.toLowerCase().replace(/_/g, "-");
}

/**
 * The voice to read with: the one the person chose if the device still has it, otherwise the first voice of the
 * language, otherwise none (the device then picks one for the language itself).
 */
export function pickVoice(
    voices: SpeechSynthesisVoice[],
    preferredUri: string,
    lang: string,
): SpeechSynthesisVoice | null {
    if (preferredUri !== "") {
        const preferred = voices.find((voice) => voice.voiceURI === preferredUri);
        if (preferred !== undefined) return preferred;
    }
    const wanted = normalizeLanguage(lang);
    if (wanted === "") return null;
    return voices.find((voice) => normalizeLanguage(voice.lang).startsWith(wanted)) ?? null;
}

type SpeechWindow = Window & { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance };

export class Speaker {
    /** What this speaker is reading now. It only ever cancels its own speech, never another plugin's. */
    private current: SpeechSynthesisUtterance | null = null;

    constructor(private readonly win: Window = activeWindow) {}

    /**
     * Reads the text, after stopping what this speaker was still reading. Does nothing on a device without speech.
     */
    speak(text: string, voice: SpeechSynthesisVoice | null, rate: number): void {
        const synth: SpeechSynthesis | undefined = this.win.speechSynthesis;
        if (synth === undefined) return;
        this.stop();
        const clean = text.trim();
        if (clean === "") return;
        const utterance = new (this.win as SpeechWindow).SpeechSynthesisUtterance(clean);
        if (voice !== null) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        }
        utterance.rate = rate;
        const finished = () => {
            if (this.current === utterance) this.current = null;
        };
        utterance.onend = finished;
        utterance.onerror = finished;
        this.current = utterance;
        synth.speak(utterance);
    }

    stop(): void {
        if (this.current === null) return;
        this.current = null;
        const synth: SpeechSynthesis | undefined = this.win.speechSynthesis;
        synth?.cancel();
    }
}
