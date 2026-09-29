import { CURLY_CLOZE_PATTERN } from "src/import-export/anki-cloze";
import { convertClozesToAnki } from "src/import-export/export-cloze";

const HIGHLIGHT = "==[123;;]answer[;;hint]==";
const BOLD = "**[123;;]answer[;;hint]**";
const ANKI = "{{[c123::]answer[::hint]}}";

describe("convertClozesToAnki", () => {
    test("numbers highlight clozes in the order of the cards", () => {
        expect(convertClozesToAnki("The ==Canberra== is in ==Australia==", [HIGHLIGHT])).toBe(
            "The {{c1::Canberra}} is in {{c2::Australia}}",
        );
    });

    test("keeps numbers and hints of numbered clozes", () => {
        expect(
            convertClozesToAnki("==1;;Canberra;;city== and ==2;;1913== and ==1;;Sydney==", [
                HIGHLIGHT,
            ]),
        ).toBe("{{c1::Canberra::city}} and {{c2::1913}} and {{c1::Sydney}}");
        expect(convertClozesToAnki("{{2;;b}} {{1;;a;;h}}", [CURLY_CLOZE_PATTERN])).toBe(
            "{{c2::b}} {{c1::a::h}}",
        );
    });

    test("reads every pattern of the settings", () => {
        expect(convertClozesToAnki("==a== and **b**", [HIGHLIGHT, BOLD])).toBe(
            "{{c1::a}} and {{c2::b}}",
        );
    });

    test("leaves Anki clozes as they are", () => {
        expect(convertClozesToAnki("{{c1::x::y}} and {{c2::z}}", [ANKI])).toBe(
            "{{c1::x::y}} and {{c2::z}}",
        );
    });

    test("writes an overlapping cloze on every card it is asked on", () => {
        expect(
            convertClozesToAnki("{{as;;A}} {{sa;;B}} {{aa;;C;;hint}}", [CURLY_CLOZE_PATTERN]),
        ).toBe("{{c1::A}} {{c2::B}} {{c1,2::C::hint}}");
        // A cloze that is never asked is plain text
        expect(convertClozesToAnki("{{aa;;A}} {{ss;;B}}", [CURLY_CLOZE_PATTERN])).toBe(
            "{{c1,2::A}} B",
        );
    });

    test("does not read $ in the text as a replacement pattern", () => {
        expect(convertClozesToAnki("Costs ==$&== and $$", [HIGHLIGHT])).toBe(
            "Costs {{c1::$&}} and $$",
        );
    });

    test("returns null for text that is not a cloze or has bad patterns", () => {
        expect(convertClozesToAnki("no clozes", [HIGHLIGHT])).toBeNull();
        expect(convertClozesToAnki("==a==", [])).toBeNull();
        expect(convertClozesToAnki("==a==", ["not a pattern"])).toBeNull();
    });
});
