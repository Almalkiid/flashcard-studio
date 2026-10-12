/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- the golden vectors are untyped JSON */
import { TopicPath, TopicPathList, TopicPathWithWs } from "src/data/decks/topic-path";
import { cloneDefaultSettings } from "src/data/settings-model";

import { loadGolden, outcome } from "./golden";

const golden = loadGolden("topic-path.json");

const pathOf = (path: TopicPath | null): string[] | null => (path === null ? null : path.path);

describe("TopicPath against the golden vectors", () => {
    test.each(Object.keys(golden.fromTag))("getTopicPathFromTag(%s)", (key) => {
        const tag = key === "null" ? null : key;
        const result = outcome(() => pathOf(TopicPath.getTopicPathFromTag(tag)));
        expect(result).toEqual(golden.fromTag[key]);
    });

    test.each(Object.keys(golden.isValid))("isValidTag(%s)", (key) => {
        expect({ ok: TopicPath.isValidTag(key === "null" ? null : key) }).toEqual(
            golden.isValid[key],
        );
    });

    test.each(Object.keys(golden.cardText))("getTopicPathFromCardText(%s)", (key) => {
        const text = JSON.parse(key) as string;
        expect({ ok: pathOf(TopicPath.getTopicPathFromCardText(text)) }).toEqual(
            golden.cardText[key],
        );
    });

    test.each(Object.keys(golden.ctor).filter((key) => key !== "undefined"))(
        "new TopicPath(%s)",
        (key) => {
            const input = JSON.parse(key.replace(/'/g, '"')) as string[] | null;
            expect(outcome(() => new TopicPath(input).path)).toEqual(golden.ctor[key]);
        },
    );

    test("a missing path is reported as null, not as a TypeError", () => {
        expect(() => new TopicPath(undefined)).toThrow("path is null");
    });

    test("the constructor keeps the caller's array", () => {
        const names = ["a"];
        expect(new TopicPath(names).path).toBe(names);
    });

    test.each(Object.keys(golden.formatAsTag))("formatAsTag(%s)", (key) => {
        const input = JSON.parse(key.replace(/'/g, '"')) as string[] | null;
        expect(outcome(() => new TopicPath(input).formatAsTag())).toEqual(golden.formatAsTag[key]);
    });

    test("isSameOrAncestorOf matrix", () => {
        for (const [key, expected] of Object.entries(golden.isSameOrAncestorOf)) {
            const [left, right] = key.split(" ancestorOrSame-of ");
            const a = new TopicPath(JSON.parse(left.replace(/'/g, '"')));
            const b = new TopicPath(JSON.parse(right.replace(/'/g, '"')));
            expect([key, a.isSameOrAncestorOf(b)]).toEqual([key, expected]);
        }
    });

    test("shift and clone", () => {
        const multi = new TopicPath(["a", "b"]);
        expect(multi.shift()).toBe("a");
        expect(multi.path).toEqual(["b"]);
        expect(() => new TopicPath([]).shift()).toThrow("can't shift an empty path");
        const original = new TopicPath(["a", "b"]);
        const copy = original.clone();
        copy.shift();
        expect(original.path).toEqual(["a", "b"]);
    });

    test("emptyPath is a new object each time", () => {
        expect(TopicPath.emptyPath).not.toBe(TopicPath.emptyPath);
    });

    test.each(golden.fileCases.map((c: { name: string }) => [c.name, c]))(
        "getTopicPathOfFile: %s",
        (_name, c) => {
            const settings = cloneDefaultSettings();
            settings.convertFoldersToDecks = c.convertFoldersToDecks;
            settings.flashcardTags = c.flashcardTags;
            const file = { path: c.path, getAllTagsFromCache: () => c.fileTags };
            expect({ ok: pathOf(TopicPath.getTopicPathOfFile(file as never, settings)) }).toEqual(
                c.result,
            );
        },
    );

    test.each(golden.folderPath.map((c: { path: string }) => [c.path, c]))(
        "getFolderPathFromFilename(%s)",
        (_path, c) => {
            const settings = cloneDefaultSettings();
            settings.convertFoldersToDecks = c.convertFoldersToDecks;
            expect({
                ok: TopicPath.getFolderPathFromFilename({ path: c.path }, settings).path,
            }).toEqual(c.result);
        },
    );
});

describe("TopicPathList and TopicPathWithWs", () => {
    const list = new TopicPathList([new TopicPath(["a", "b"]), new TopicPath(["c"])], 5);

    test("format, length and line number", () => {
        expect(list.format("|")).toBe(golden.tpl.format_pipe);
        expect(list.format(", ")).toBe(golden.tpl.format_comma);
        expect(list.length).toBe(2);
        expect(list.lineNum).toBe(5);
        expect(TopicPathList.empty().lineNum).toBeNull();
        expect(TopicPathList.empty().format("|")).toBe("");
    });

    test("errors", () => {
        expect(() => new TopicPathList(null)).toThrow("TopicPathList null");
        expect(() => new TopicPathList([new TopicPath([])]).format("|")).toThrow("Empty path");
    });

    test("TopicPathWithWs keeps the spacing", () => {
        const withWs = new TopicPathWithWs(new TopicPath(["a", "b"]), "  ", " ");
        expect(withWs.formatWithWs()).toBe(golden.withWs.ok);
        expect(() => new TopicPathWithWs(new TopicPath([]), "", "")).toThrow("topicPath null");
        expect(() => new TopicPathWithWs(null, "", "")).toThrow("topicPath null");
    });
});
