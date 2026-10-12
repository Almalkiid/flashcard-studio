// Builds the Anki fixtures of the end-to-end tests: `node tests/e2e/fixtures/build-fixtures.mjs`.
// The output is committed, so the tests need no build step. The notes are made up for the tests.
import { Deck, Note, Notetype, Package } from "ankipack";
import fs from "fs";
import initSqlJs from "sql.js";

// A 1x1 PNG, and a WAV file of 8 samples of silence
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
);
const WAV = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([44, 0, 0, 0]),
    Buffer.from("WAVEfmt ", "ascii"),
    Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0]),
    Buffer.from("data", "ascii"),
    Buffer.from([8, 0, 0, 0, 128, 128, 128, 128, 128, 128, 128, 128]),
]);

const SQL = await initSqlJs();
const basic = Notetype.basic();
const reversed = Notetype.basicAndReversed();
const cloze = Notetype.cloze();

const spanish = new Deck({ name: "Spanish" });
spanish.addNote(
    new Note({
        notetype: basic,
        fields: ["hola", "<b>hello</b><br>(a greeting)"],
        tags: ["greetings", "week1"],
        guid: "e2e-hola",
    }),
);
spanish.addNote(
    new Note({ notetype: reversed, fields: ["gracias", "thanks"], guid: "e2e-gracias" }),
);
spanish.addNote(
    new Note({
        notetype: basic,
        fields: ['What is this?<br><img src="pixel.png">', "A pixel [sound:beep.wav]"],
        guid: "e2e-media",
    }),
);

const verbs = new Deck({ name: "Spanish::Verbs" });
verbs.addNote(
    new Note({
        notetype: cloze,
        fields: ["Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}", "Present tense"],
        guid: "e2e-cloze",
    }),
);
verbs.addNote(
    new Note({ notetype: basic, fields: ["std::vector is a", "container"], guid: "e2e-colons" }),
);

const pack = new Package();
pack.addDeck(spanish);
pack.addDeck(verbs);
pack.addMedia("pixel.png", new Uint8Array(PNG));
pack.addMedia("beep.wav", new Uint8Array(WAV));
fs.writeFileSync(new URL("anki-synthetic.apkg", import.meta.url), await pack.toUint8Array(SQL));

// Anki's text format: a header, quoted fields, a deck column and a tags column
fs.writeFileSync(
    new URL("anki-notes.txt", import.meta.url),
    [
        "#separator:tab",
        "#deck column:3",
        "#tags column:4",
        "capital of France\tParis\tGeography::Europe\tcities",
        '"two lines\nof question"\t"answer with ""quotes"""\tGeography::Europe\t',
        "capital of Japan\tTokyo\tGeography::Asia\tcities",
        "",
    ].join("\n"),
);
console.log("fixtures written");
