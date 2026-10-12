/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- the golden vectors are untyped JSON */
import * as formats from "src/data/formats";

import { loadGolden } from "./golden";

const golden = loadGolden("constants.json");
const LIVE = [
    "SCHEDULE_COMMENT_AND_SPACE_FINDER",
    "SM2_SCHEDULE_INFO_EXTRACTOR",
    "MULTI_SCHEDULING_EXTRACTOR",
    "OBSIDIAN_TAG_AT_STARTOFLINE_REGEX",
    "OBSIDIAN_BLOCK_ID_ENDOFLINE_REGEX",
] as const;

describe("the stored formats (constants.json)", () => {
    test.each(LIVE)("%s has the same pattern and flags", (name) => {
        const regex = formats[name];
        expect({ source: regex.source, flags: regex.flags }).toEqual(golden.regexDefinitions[name]);
    });

    test("the plain values", () => {
        for (const name of [
            "CARD_METADATA_CALLOUT",
            "PREFERRED_DATE_FORMAT",
            "ALLOWED_DATE_FORMATS",
            "TICKS_PER_DAY",
            "SCHEDULE_COMMENT_PREFIX",
            "SCHEDULE_COMMENT_SUFFIX",
            "STUDIO_TAB_VIEW",
        ] as const) {
            expect([name, formats[name]]).toEqual([name, golden.values[name]]);
        }
    });

    test.each(golden.srCases.map((c: { name: string }) => [c.name, c]))("%s", (_name, c) => {
        for (const name of LIVE.filter((key) => key in c.results)) {
            const regex = formats[name];
            const expected = c.results[name];
            const matches = [
                ...c.text.matchAll(
                    new RegExp(
                        regex.source,
                        regex.flags.includes("g") ? regex.flags : regex.flags + "g",
                    ),
                ),
            ].map((m: RegExpMatchArray) =>
                [...m].map((part) => (part === undefined ? { $undefined: true } : part)),
            );
            expect([name, matches]).toEqual([name, expected.matches]);
            expect([
                name,
                c.text.replaceAll(
                    new RegExp(
                        regex.source,
                        regex.flags.includes("g") ? regex.flags : regex.flags + "g",
                    ),
                    "",
                ),
            ]).toEqual([name, expected.replacedWithEmpty]);
        }
    });

    test("a tag at the start of a line", () => {
        for (const row of golden.tagStart) {
            const regex = new RegExp(formats.OBSIDIAN_TAG_AT_STARTOFLINE_REGEX.source, "i");
            const plain = (match: RegExpMatchArray | null) => (match === null ? null : [...match]);
            expect(plain(row.text.match(regex))).toEqual(row.match);
            expect(plain(row.text.trimStart().match(regex))).toEqual(row.matchAfterTrimStart);
        }
    });

    test("a block id at the end of a line", () => {
        for (const row of golden.blockId) {
            const match = formats.OBSIDIAN_BLOCK_ID_ENDOFLINE_REGEX.exec(row.text);
            expect(match === null ? null : [...match]).toEqual(row.match);
        }
    });

    test("the global patterns are meant for matchAll and replaceAll", () => {
        expect(formats.OBSIDIAN_TAG_AT_STARTOFLINE_REGEX.global).toBe(true);
        expect(formats.SCHEDULE_COMMENT_AND_SPACE_FINDER.global).toBe(true);
        expect("#a\n#b".replaceAll(formats.OBSIDIAN_TAG_AT_STARTOFLINE_REGEX, "")).toBe("\n#b");
    });
});
