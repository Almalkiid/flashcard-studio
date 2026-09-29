/**
 * Backward-compatibility guard for the card parser.
 *
 * Every note under tests/vaults, plus a corpus of legacy syntax written for this test, is parsed
 * with the DEFAULT settings (and with an end marker set, the other mode that existing users have)
 * and compared with tests/unit/fixtures/parse-baseline.json, which was generated from the parser
 * BEFORE the M3b card-syntax work. Card count, card type, text, line range and every front/back
 * must not change. A difference here means an existing note would now produce different cards,
 * and therefore different schedule slots.
 *
 * To regenerate on purpose (only for a deliberate, documented behaviour change):
 *   UPDATE_PARSE_BASELINE=1 pnpm jest tests/unit/parser-compat-baseline.test.ts
 */
import * as fs from "fs";
import * as path from "path";

import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { parse, parserOptionsFromSettings } from "src/parser";
import { splitNoteIntoFrontmatterAndContent } from "src/utils/strings";

import { COMPAT_CORPUS } from "./fixtures/parse-compat-corpus";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const BASELINE_PATH = path.join(__dirname, "fixtures", "parse-baseline.json");
const VAULTS_DIR = path.join(__dirname, "..", "vaults");

interface ParsedSnapshot {
    cardType: number;
    text: string;
    firstLine: number;
    lastLine: number;
    cards: { front: string; back: string }[];
}

type Baseline = Record<string, Record<string, ParsedSnapshot[]>>;

const SETTINGS_VARIANTS: Record<string, SRSettings> = {
    default: DEFAULT_SETTINGS,
    endMarkerDashes: { ...DEFAULT_SETTINGS, multilineCardEndMarker: "---" },
    endMarkerPlus: { ...DEFAULT_SETTINGS, multilineCardEndMarker: "+++" },
    allClozePatterns: {
        ...DEFAULT_SETTINGS,
        clozePatterns: [
            "==[123;;]answer[;;hint]==",
            "**[123;;]answer[;;hint]**",
            "{{[123;;]answer[;;hint]}}",
        ],
    },
};

function snapshotNote(text: string, settings: SRSettings): ParsedSnapshot[] {
    const [, content] = splitNoteIntoFrontmatterAndContent(text);
    return parse(content, parserOptionsFromSettings(settings)).map((info) => ({
        cardType: info.cardType,
        text: info.text,
        firstLine: info.firstLineNum,
        lastLine: info.lastLineNum,
        cards: CardFrontBackUtil.expand(info.cardType, info.text, settings).map((c) => ({
            front: c.front,
            back: c.back,
        })),
    }));
}

function readVaultNotes(): Record<string, string> {
    const notes: Record<string, string> = {};
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".md")) {
                notes["vault/" + path.relative(VAULTS_DIR, full)] = fs.readFileSync(full, "utf8");
            }
        }
    };
    walk(VAULTS_DIR);
    return notes;
}

function buildAll(): Baseline {
    const inputs: Record<string, string> = { ...readVaultNotes(), ...COMPAT_CORPUS };
    const result: Baseline = {};
    for (const name of Object.keys(inputs).sort()) {
        result[name] = {};
        for (const [variant, settings] of Object.entries(SETTINGS_VARIANTS)) {
            result[name][variant] = snapshotNote(inputs[name], settings);
        }
    }
    return result;
}

beforeAll(() => {
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

describe("parser backward compatibility (pre-M3b baseline)", () => {
    const current = buildAll();

    if (process.env.UPDATE_PARSE_BASELINE) {
        test("regenerate baseline", () => {
            fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
            fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
        });
        return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;

    test("the corpus and the vault notes are all present in the baseline", () => {
        expect(Object.keys(current).sort()).toEqual(Object.keys(baseline).sort());
        // A vault or corpus that silently shrank would make every other comparison vacuous.
        expect(Object.keys(baseline).length).toBeGreaterThan(40);
    });

    for (const name of Object.keys(baseline)) {
        for (const variant of Object.keys(SETTINGS_VARIANTS)) {
            test(`${name} [${variant}] parses exactly as before`, () => {
                expect(current[name]?.[variant]).toEqual(baseline[name][variant]);
            });
        }
    }

    test("card counts per input are unchanged", () => {
        const counts = (b: Baseline) =>
            Object.fromEntries(
                Object.entries(b).map(([n, v]) => [
                    n,
                    Object.fromEntries(Object.entries(v).map(([k, cards]) => [k, cards.length])),
                ]),
            );
        expect(counts(current)).toEqual(counts(baseline));
    });
});
