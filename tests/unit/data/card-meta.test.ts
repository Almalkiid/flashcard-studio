import {
    emptyCardMeta,
    formatMetaTokens,
    generateCardId,
    hasPersistentMeta,
    isBuried,
    parseCommentMeta,
    parseSegmentMeta,
    unsuspendCardsInText,
} from "src/data/card-meta";

describe("card meta", () => {
    test("fsrs segment without tokens has empty meta", () => {
        expect(
            parseSegmentMeta(
                "fsrs,2026-10-06T08:00:00.000Z,7,7.2,5.1,2,3,0,0,2026-09-29T08:00:00.000Z",
            ),
        ).toEqual(emptyCardMeta());
    });

    test("fsrs segment tokens are parsed", () => {
        const meta = parseSegmentMeta(
            "fsrs,2026-10-06T08:00:00.000Z,7,7.2,5.1,2,3,0,0,-,id=k3f9a2,susp,flag=3,leech,bury=2026-10-01,zz=1",
        );
        expect(meta).toEqual({
            id: "k3f9a2",
            suspended: true,
            flag: 3,
            leech: true,
            buryUntil: "2026-10-01",
            extras: ["zz=1"],
        });
    });

    test("sm2 segment tokens start after the third field", () => {
        expect(parseSegmentMeta("2026-10-06,7,250,id=abc123").id).toBe("abc123");
        expect(parseSegmentMeta("2026-10-06,7,250")).toEqual(emptyCardMeta());
    });

    test("format round-trips in canonical order", () => {
        const meta = {
            id: "abc123",
            suspended: true,
            buryUntil: "2026-10-01",
            flag: 2,
            leech: true,
            extras: ["zz=1"],
        };
        expect(formatMetaTokens(meta)).toBe(",id=abc123,susp,bury=2026-10-01,flag=2,leech,zz=1");
        expect(parseSegmentMeta("2000-01-01,1,250" + formatMetaTokens(meta))).toEqual(meta);
    });

    test("empty meta formats to an empty string", () => {
        expect(formatMetaTokens(emptyCardMeta())).toBe("");
    });

    test("invalid flag, bury and id values are kept as extras, not applied", () => {
        const meta = parseSegmentMeta("2026-10-06,7,250,flag=9,bury=soon,id=NOT-VALID");
        expect(meta.flag).toBe(0);
        expect(meta.buryUntil).toBeNull();
        expect(meta.id).toBeNull();
        expect(meta.extras).toEqual(["flag=9", "bury=soon", "id=NOT-VALID"]);
    });

    test("blank tokens are ignored", () => {
        expect(parseSegmentMeta("2026-10-06,7,250,, ,susp").suspended).toBe(true);
        expect(parseSegmentMeta("2026-10-06,7,250,, ,susp").extras).toEqual([]);
    });

    test("a comment with two segments yields two metas aligned by index", () => {
        const text =
            "Q ==a== ==b== <!--SR:!fsrs,-,0,0,0,0,0,0,0,-,id=aaaaaa,susp!fsrs,2026-10-06T08:00:00.000Z,7,7.2,5.1,2,3,0,0,-,id=bbbbbb-->";
        const metas = parseCommentMeta(text);
        expect(metas.map((m) => m.id)).toEqual(["aaaaaa", "bbbbbb"]);
        expect(metas[0].suspended).toBe(true);
        expect(metas[1].suspended).toBe(false);
    });

    test("text without a comment gives an empty list", () => {
        expect(parseCommentMeta("Q::A")).toEqual([]);
    });

    test("ids are 6 base36 chars and vary", () => {
        const ids = new Set(Array.from({ length: 200 }, () => generateCardId()));
        ids.forEach((id) => expect(id).toMatch(/^[0-9a-z]{6}$/));
        expect(ids.size).toBeGreaterThan(195);
    });

    test("isBuried compares YYYY-MM-DD dates", () => {
        const meta = { ...emptyCardMeta(), buryUntil: "2026-10-01" };
        expect(isBuried(meta, "2026-09-30")).toBe(true);
        expect(isBuried(meta, "2026-10-01")).toBe(false);
        expect(isBuried(emptyCardMeta(), "2026-09-30")).toBe(false);
    });

    test("hasPersistentMeta ignores a bare id", () => {
        expect(hasPersistentMeta({ ...emptyCardMeta(), id: "abc123" })).toBe(false);
        expect(hasPersistentMeta({ ...emptyCardMeta(), suspended: true })).toBe(true);
        expect(hasPersistentMeta({ ...emptyCardMeta(), buryUntil: "2026-10-01" })).toBe(true);
        expect(hasPersistentMeta({ ...emptyCardMeta(), flag: 4 })).toBe(true);
        expect(hasPersistentMeta({ ...emptyCardMeta(), leech: true })).toBe(true);
        expect(hasPersistentMeta({ ...emptyCardMeta(), extras: ["x=1"] })).toBe(true);
    });
});

describe("unsuspendCardsInText", () => {
    test("removes the flag of the chosen cards only, leaving every other byte as it was", () => {
        const text =
            "Q {{c1::a}} {{c2::b}}\n<!--SR:!2026-12-01,3,250,id=aaaaaa,susp!2026-12-02,4,250,id=bbbbbb,susp-->";
        expect(unsuspendCardsInText(text, new Set([1]))).toBe(
            "Q {{c1::a}} {{c2::b}}\n<!--SR:!2026-12-01,3,250,id=aaaaaa,susp!2026-12-02,4,250,id=bbbbbb-->",
        );
        expect(unsuspendCardsInText(text, new Set([0, 1]))).toBe(
            "Q {{c1::a}} {{c2::b}}\n<!--SR:!2026-12-01,3,250,id=aaaaaa!2026-12-02,4,250,id=bbbbbb-->",
        );
    });

    test("keeps the comment of a card never reviewed, and never touches a later comment", () => {
        const text =
            "Q1\n?\nA1\n<!--SR:!2000-01-01,1,250,id=aaaaaa,susp-->\n\nmore\n<!--SR:!2026-12-01,3,250,id=bbbbbb,susp-->";
        expect(unsuspendCardsInText(text, new Set([0]))).toBe(
            "Q1\n?\nA1\n<!--SR:!2000-01-01,1,250,id=aaaaaa-->\n\nmore\n<!--SR:!2026-12-01,3,250,id=bbbbbb,susp-->",
        );
    });

    test("reads an FSRS segment's fields as fixed, so only the flag after them goes", () => {
        const text =
            "Q::A <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z,id=aaaaaa,susp,flag=2-->";
        expect(unsuspendCardsInText(text, new Set([0]))).toBe(
            "Q::A <!--SR:!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z,id=aaaaaa,flag=2-->",
        );
    });
});
