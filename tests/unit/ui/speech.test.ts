import { joinSpeech, pickVoice, speakableText, Speaker, speechAvailable } from "src/ui/speech";

function voice(voiceURI: string, lang: string): SpeechSynthesisVoice {
    return { voiceURI, lang, name: voiceURI, default: false, localService: true };
}

function element(html: string): HTMLElement {
    return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body
        .firstElementChild as HTMLElement;
}

describe("speechAvailable", () => {
    test("is false for a window without speech synthesis", () => {
        expect(speechAvailable({} as unknown as Window)).toBe(false);
    });
    test("is false when the voices cannot be listed", () => {
        expect(speechAvailable({ speechSynthesis: {} } as unknown as Window)).toBe(false);
    });
    test("is true when the window can list voices", () => {
        const win = {
            speechSynthesis: { getVoices: (): SpeechSynthesisVoice[] => [] },
        } as unknown as Window;
        expect(speechAvailable(win)).toBe(true);
    });
});

describe("speakableText", () => {
    test("skips images, code, math masks and drawings, and says blank for a cloze blank", () => {
        const el = element(
            '<p>The board <img alt="a chart"> sets the <span style="color:#2196f3">[...]</span> ' +
                '<code>x = 1</code> <span class="fs-mask">hidden</span> charter.</p><pre>code block</pre>' +
                "<svg><text>drawn</text></svg>",
        );
        expect(speakableText(el)).toBe("The board sets the blank charter.");
    });
    test("a typed cloze field is a blank too", () => {
        const el = element('<p>The <input class="cloze-input" type="text"> approves it.</p>');
        expect(speakableText(el)).toBe("The blank approves it.");
    });
    test("blocks and lines are kept apart, spaces are collapsed", () => {
        const el = element(
            "<p>One</p><p>Two   words</p><ul><li>Three</li><li>Four</li></ul>a<br>b",
        );
        expect(speakableText(el)).toBe("One Two words Three Four a b");
    });
    test("leaves the element itself as it was", () => {
        const el = element("<p>Keep <code>this</code></p>");
        speakableText(el);
        expect(el.innerHTML).toBe("<p>Keep <code>this</code></p>");
    });
    test("an element with nothing to say gives an empty string", () => {
        expect(speakableText(element('<img alt="x"><pre>y</pre>'))).toBe("");
    });
});

describe("joinSpeech", () => {
    test("ends each part with a full stop unless it has punctuation, and drops empty parts", () => {
        expect(joinSpeech(["Which body?", "  The board ", "", "Done."])).toBe(
            "Which body? The board. Done.",
        );
    });
});

describe("pickVoice", () => {
    const voices = [voice("a", "fr-FR"), voice("b", "en-GB"), voice("c", "en-US")];
    test("the preferred voice wins", () => {
        expect(pickVoice(voices, "c", "fr")?.voiceURI).toBe("c");
    });
    test("otherwise the first voice of the language", () => {
        expect(pickVoice(voices, "", "en")?.voiceURI).toBe("b");
        expect(pickVoice(voices, "gone", "en-us")?.voiceURI).toBe("c");
    });
    test("Android style languages (en_US) match too", () => {
        expect(pickVoice([voice("x", "en_US")], "", "en-us")?.voiceURI).toBe("x");
    });
    test("otherwise none, so the device picks", () => {
        expect(pickVoice(voices, "", "ar")).toBeNull();
        expect(pickVoice([], "", "en")).toBeNull();
    });
});

describe("Speaker", () => {
    class FakeUtterance {
        voice: SpeechSynthesisVoice | null = null;
        lang = "";
        rate = 1;
        constructor(public text: string) {}
    }
    function setup() {
        const spoken: FakeUtterance[] = [];
        const synth = {
            cancel: jest.fn(),
            speak: jest.fn((u: FakeUtterance) => spoken.push(u)),
            getVoices: (): SpeechSynthesisVoice[] => [],
        };
        const win = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance };
        return { speaker: new Speaker(win as unknown as Window), synth, spoken };
    }

    test("speaks with the voice, its language and the rate", () => {
        const { speaker, synth, spoken } = setup();
        const v = voice("c", "en-US");
        speaker.speak("Hello", v, 1.5);
        expect(spoken).toHaveLength(1);
        expect(spoken[0]).toMatchObject({ text: "Hello", voice: v, lang: "en-US", rate: 1.5 });
        // Nothing was being read, so nothing is cancelled (it could be another plugin's speech)
        expect(synth.cancel).not.toHaveBeenCalled();
    });
    test("a new text stops the one still being read", () => {
        const { speaker, synth, spoken } = setup();
        speaker.speak("One", null, 1);
        speaker.speak("Two", null, 1);
        expect(synth.cancel).toHaveBeenCalledTimes(1);
        expect(spoken.map((u) => u.text)).toEqual(["One", "Two"]);
    });
    test("a text that has been read to the end is not cancelled by the next", () => {
        const { speaker, synth, spoken } = setup();
        speaker.speak("One", null, 1);
        (spoken[0] as unknown as { onend: () => void }).onend();
        speaker.speak("Two", null, 1);
        expect(synth.cancel).not.toHaveBeenCalled();
    });
    test("without a voice the device chooses", () => {
        const { speaker, spoken } = setup();
        speaker.speak("Hello", null, 1);
        expect(spoken[0].voice).toBeNull();
    });
    test("says nothing for empty text", () => {
        const { speaker, spoken } = setup();
        speaker.speak("   ", null, 1);
        expect(spoken).toHaveLength(0);
    });
    test("stop cancels what is being read, and only that", () => {
        const { speaker, synth } = setup();
        speaker.stop();
        expect(synth.cancel).not.toHaveBeenCalled();
        speaker.speak("One", null, 1);
        speaker.stop();
        expect(synth.cancel).toHaveBeenCalledTimes(1);
        speaker.stop();
        expect(synth.cancel).toHaveBeenCalledTimes(1);
    });
    test("a device without speech does nothing", () => {
        const none = new Speaker({} as unknown as Window);
        expect(() => none.speak("x", null, 1)).not.toThrow();
        expect(() => none.stop()).not.toThrow();
    });
});
