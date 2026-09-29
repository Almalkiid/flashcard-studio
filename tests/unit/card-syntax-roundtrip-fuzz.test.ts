/**
 * Seeded, structured round trip fuzz for the card syntaxes: random notes built from blocks (inline cards,
 * multiline cards, cloze paragraphs, callout cards, math blocks), written in the style of each parser mode.
 * Every card is reviewed, the note is written, parsed again and reviewed again on a later day. The note text
 * must not change apart from the scheduling comments, and no card may lose its schedule.
 *
 * The second half switches a mode on for a note that was reviewed with the default settings, without editing
 * the note (upstream issue #1402): the schedules must survive. Without the guards in the parser (a card ends at
 * its scheduling comment; a paragraph with one shared schedule is not split) these tests fail.
 */
import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteParser } from "src/note/note-parser";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import {
    setupStaticDateProvider20230906,
    setupStaticDateProviderOriginDatePlusDays,
} from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const order: IIteratorOrder = {
    repItemOrder: RepItemOrder.NewFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

async function load(file: UnitTestSRFile, settings: SRSettings) {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const note: Note = await new NoteParser(settings).parse(
        file,
        TextDirection.Ltr,
        new TopicPath(["Root"]),
    );
    const deck = new Deck("Root", null);
    note.appendCardsToDeck(deck);
    const postponementList = new QuestionPostponementList(null, settings, []);
    const sequencer = new FlashcardReviewSequencer(
        FlashcardReviewMode.Review,
        new DeckTreeIterator(order, null),
        settings,
        SRAlgorithm.getInstance(),
        postponementList,
        new CardDueDateHistogram(),
    );
    sequencer.setDeckTree(
        deck,
        DeckTreeFilter.filterForRemainingRepItems(
            postponementList,
            deck,
            FlashcardReviewMode.Review,
        ),
    );
    return { note, sequencer };
}

function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

type BlockKind = "inline" | "multi" | "multiBlank" | "cloze" | "cloze2" | "callout" | "math";

interface Mode {
    name: string;
    settings: SRSettings;
    kinds: BlockKind[];
    wrap: (kind: BlockKind, text: string) => string;
}

const plain = (_k: BlockKind, t: string) => t;
const needsMarker = (k: BlockKind) =>
    k === "multi" || k === "multiBlank" || k === "cloze" || k === "cloze2";

const MODES: Mode[] = [
    {
        name: "default",
        settings: DEFAULT_SETTINGS,
        kinds: ["inline", "multi", "cloze", "cloze2", "callout"],
        wrap: plain,
    },
    {
        name: "endMarker",
        settings: { ...DEFAULT_SETTINGS, multilineCardEndMarker: "+++" },
        kinds: ["inline", "multi", "multiBlank", "cloze", "cloze2", "callout"],
        wrap: (k, t) => (needsMarker(k) ? t + "\n+++" : t),
    },
    {
        name: "regions",
        settings: {
            ...DEFAULT_SETTINGS,
            multilineCardStartMarker: "+++",
            multilineCardEndMarker: "+++",
        },
        kinds: ["inline", "multi", "multiBlank", "cloze", "cloze2", "callout"],
        wrap: (k, t) => (needsMarker(k) ? "+++\n" + t + "\n+++" : t),
    },
    {
        name: "atomic+latex",
        settings: { ...DEFAULT_SETTINGS, atomicClozes: true, latexClozes: true },
        kinds: ["inline", "multi", "cloze", "cloze2", "callout", "math"],
        wrap: plain,
    },
];

function block(kind: BlockKind, i: number, rand: () => number): string {
    switch (kind) {
        case "inline":
            return `QI${i}::AI${i}`;
        case "multi":
            return `MQ${i}\n?\nMA${i}` + (rand() < 0.5 ? `\nMB${i}` : "");
        case "multiBlank":
            return `PQ${i} one\n\nPQ${i} two\n?\nPA${i} one\n\nPA${i} two`;
        case "cloze":
            return `CL${i} ==c${i}== and ==d${i}==`;
        case "cloze2":
            return `intro${i}\nCL${i} ==e${i}==\nmid${i}\nCM${i} ==f${i}==`;
        case "callout":
            return `> [!question] CT${i}\n> CB${i}` + (rand() < 0.5 ? `\n> CC${i}` : "");
        case "math":
            return `$$\n\\cloze{a${i}}{} = b${i}\n$$`;
    }
}

const SR = /<!--SR:.+?-->/g;
const strip = (text: string) =>
    text
        .replace(SR, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n");
const cardsOf = (note: Note) => note.questionList.reduce((a, q) => a + q.cards.length, 0);
const allScheduled = (note: Note) =>
    note.questionList.every((q) => q.cards.every((c) => c.hasSchedule));

async function reviewAll(loaded: { sequencer: FlashcardReviewSequencer }) {
    let reviewed = 0;
    while (loaded.sequencer.currentCard && reviewed < 60) {
        await loaded.sequencer.processReview(ReviewResponse.Good);
        reviewed++;
    }
}

describe("structured round trip fuzz", () => {
    afterEach(() => setupStaticDateProvider20230906());

    for (const mode of MODES) {
        test(`${mode.name}: review, write, re-parse, review again`, async () => {
            const rand = rng(mode.name.length * 104729 + 7);
            const failures: string[] = [];
            for (let n = 0; n < 400 && failures.length < 4; n++) {
                const count = 1 + Math.floor(rand() * 7);
                const parts: string[] = [];
                for (let i = 0; i < count; i++) {
                    const kind = mode.kinds[Math.floor(rand() * mode.kinds.length)];
                    parts.push(mode.wrap(kind, block(kind, i, rand)));
                }
                const text0 = "#flashcards\n\n" + parts.join("\n\n") + "\n";
                const file = new UnitTestSRFile(text0);
                setupStaticDateProvider20230906();
                const first = await load(file, mode.settings);
                const cards0 = cardsOf(first.note);
                await reviewAll(first);
                const text1 = file.content;
                const problems: string[] = [];
                if (strip(text1) !== strip(text0)) problems.push("content changed");
                const second = await load(file, mode.settings);
                if (cardsOf(second.note) !== cards0)
                    problems.push(`cards ${cards0} -> ${cardsOf(second.note)}`);
                if (cards0 > 0 && !allScheduled(second.note))
                    problems.push("unscheduled after review");
                if (second.note.hasChanged) problems.push("hasChanged on load");
                const comments1 = (text1.match(SR) ?? []).length;
                if (comments1 !== second.note.questionList.length)
                    problems.push(
                        `comments ${comments1} vs questions ${second.note.questionList.length}`,
                    );
                // Second review, when the cards are due again
                setupStaticDateProviderOriginDatePlusDays(400);
                await reviewAll(second);
                const text2 = file.content;
                if (strip(text2) !== strip(text0)) problems.push("content changed on 2nd review");
                if ((text2.match(SR) ?? []).length !== comments1)
                    problems.push("comment count changed on 2nd review");
                if (problems.length)
                    failures.push(
                        JSON.stringify(text0) +
                            " => " +
                            JSON.stringify(text1) +
                            " :: " +
                            problems.join("; "),
                    );
            }
            expect(failures).toEqual([]);
        });
    }

    // Switching a mode on for a note that was reviewed in the default mode, without touching the note
    for (const target of MODES.slice(1)) {
        test(`legacy note (reviewed by default settings), then ${target.name} turned on: no schedule is lost`, async () => {
            const rand = rng(target.name.length * 7907 + 3);
            const failures: string[] = [];
            const kinds: BlockKind[] = ["inline", "multi", "cloze", "cloze2", "callout"];
            for (let n = 0; n < 400 && failures.length < 4; n++) {
                const count = 1 + Math.floor(rand() * 7);
                const parts: string[] = [];
                for (let i = 0; i < count; i++) {
                    const kind = kinds[Math.floor(rand() * kinds.length)];
                    parts.push(block(kind, i, rand));
                }
                const text0 = "#flashcards\n\n" + parts.join("\n\n") + "\n";
                const file = new UnitTestSRFile(text0);
                setupStaticDateProvider20230906();
                const legacy = await load(file, DEFAULT_SETTINGS);
                await reviewAll(legacy);
                const text1 = file.content;
                const commentsBefore = (text1.match(SR) ?? []).length;

                const switched = await load(file, target.settings);
                const problems: string[] = [];
                if (switched.note.hasChanged)
                    problems.push("hasChanged on load: would rewrite the note");
                setupStaticDateProviderOriginDatePlusDays(400);
                await reviewAll(switched);
                const text2 = file.content;
                if (strip(text2) !== strip(text0)) problems.push("content changed");
                if ((text2.match(SR) ?? []).length < commentsBefore)
                    problems.push(
                        `comments ${commentsBefore} -> ${(text2.match(SR) ?? []).length}`,
                    );
                if (problems.length)
                    failures.push(
                        JSON.stringify(text0) +
                            " => " +
                            JSON.stringify(text1) +
                            " => " +
                            JSON.stringify(text2) +
                            " :: " +
                            problems.join("; "),
                    );
            }
            expect(failures).toEqual([]);
        });
    }
});
