import {
    cardScrollTop,
    Handle,
    handlePoint,
    hitHandle,
    hitMask,
    isBigEnough,
    moveRect,
    rectFromPoints,
    resizeRect,
} from "src/occlusion/occlusion-geometry";

function expectRect(
    actual: { x: number; y: number; w: number; h: number },
    x: number,
    y: number,
    w: number,
    h: number,
) {
    expect(actual.x).toBeCloseTo(x, 6);
    expect(actual.y).toBeCloseTo(y, 6);
    expect(actual.w).toBeCloseTo(w, 6);
    expect(actual.h).toBeCloseTo(h, 6);
}

describe("rectFromPoints", () => {
    test("is the box between two corners, whichever way the drag went", () => {
        expectRect(rectFromPoints({ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.8 }), 0.2, 0.3, 0.3, 0.5);
        expectRect(rectFromPoints({ x: 0.5, y: 0.8 }, { x: 0.2, y: 0.3 }), 0.2, 0.3, 0.3, 0.5);
    });
    test("stays inside the image when the pointer left it", () => {
        expectRect(rectFromPoints({ x: 0.8, y: 0.8 }, { x: 1.4, y: -0.3 }), 0.8, 0, 0.2, 0.8);
    });
});

test("isBigEnough: a mask under 1% by 1% is not a mask", () => {
    expect(isBigEnough({ x: 0, y: 0, w: 0.01, h: 0.01 })).toBe(true);
    expect(isBigEnough({ x: 0, y: 0, w: 0.009, h: 0.5 })).toBe(false);
    expect(isBigEnough({ x: 0, y: 0, w: 0.5, h: 0.009 })).toBe(false);
});

describe("moveRect", () => {
    test("moves without changing the size", () => {
        expectRect(moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, 0.25, -0.05), 0.35, 0.05, 0.2, 0.3);
    });
    test("stops at the edges of the image", () => {
        expectRect(moveRect({ x: 0.8, y: 0.6, w: 0.2, h: 0.3 }, 0.5, 0.5), 0.8, 0.7, 0.2, 0.3);
        expectRect(moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, -0.5, -0.5), 0, 0, 0.2, 0.3);
    });
});

describe("resizeRect", () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    test("a corner moves two edges", () => {
        expectRect(resizeRect(r, "se", 0.1, 0.2), 0.2, 0.2, 0.5, 0.6);
        expectRect(resizeRect(r, "nw", 0.1, 0.1), 0.3, 0.3, 0.3, 0.3);
    });
    test("a side moves one edge", () => {
        expectRect(resizeRect(r, "e", 0.1, 0.9), 0.2, 0.2, 0.5, 0.4);
        expectRect(resizeRect(r, "n", 0.9, -0.1), 0.2, 0.1, 0.4, 0.5);
        expectRect(resizeRect(r, "w", -0.1, 0.9), 0.1, 0.2, 0.5, 0.4);
        expectRect(resizeRect(r, "s", 0.9, 0.1), 0.2, 0.2, 0.4, 0.5);
    });
    test("dragging an edge past the opposite one flips the mask", () => {
        expectRect(resizeRect(r, "e", -0.5, 0), 0.1, 0.2, 0.1, 0.4);
    });
    test("stays inside the image", () => {
        expectRect(resizeRect(r, "se", 2, 2), 0.2, 0.2, 0.8, 0.8);
        expectRect(resizeRect(r, "nw", -2, -2), 0, 0, 0.6, 0.6);
    });
    test("never gets smaller than 1%", () => {
        expectRect(resizeRect(r, "e", -0.4, 0), 0.2, 0.2, 0.01, 0.4);
        expectRect(resizeRect(r, "w", 0.4, 0), 0.59, 0.2, 0.01, 0.4);
        expectRect(
            resizeRect({ x: 0.99, y: 0.2, w: 0.01, h: 0.4 }, "w", 0.5, 0),
            0.99,
            0.2,
            0.01,
            0.4,
        );
        expectRect(resizeRect({ x: 0, y: 0.2, w: 0.01, h: 0.4 }, "e", -0.5, 0), 0, 0.2, 0.01, 0.4);
    });
});

describe("hitMask", () => {
    const masks = [
        { shape: "rect" as const, x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
        { shape: "ellipse" as const, x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
    ];
    test("finds the mask under a point, the one drawn last when they overlap", () => {
        expect(hitMask(masks, { x: 0.15, y: 0.15 })).toBe(0);
        expect(hitMask(masks, { x: 0.5, y: 0.5 })).toBe(1);
        expect(hitMask(masks, { x: 0.45, y: 0.45 })).toBe(1);
    });
    test("an ellipse does not reach the corners of its box", () => {
        expect(hitMask(masks, { x: 0.68, y: 0.68 })).toBe(-1);
        expect(hitMask(masks, { x: 0.32, y: 0.68 })).toBe(-1);
    });
    test("empty space is no mask", () => {
        expect(hitMask(masks, { x: 0.9, y: 0.9 })).toBe(-1);
        expect(hitMask([], { x: 0.5, y: 0.5 })).toBe(-1);
    });
});

describe("handles", () => {
    const r = { x: 0.2, y: 0.4, w: 0.4, h: 0.2 };
    test("are on the corners and the middles of the sides", () => {
        const at = (handle: Handle): [number, number] => {
            const point = handlePoint(r, handle);
            return [point.x, point.y];
        };
        expect(at("nw")).toEqual([0.2, 0.4]);
        expect(at("e")[0]).toBeCloseTo(0.6, 9);
        expect(at("e")[1]).toBeCloseTo(0.5, 9);
        expect(at("s")[0]).toBeCloseTo(0.4, 9);
        expect(at("s")[1]).toBeCloseTo(0.6, 9);
    });
    test("are hit within a radius in pixels, not in image fractions", () => {
        const stage = { w: 1000, h: 500 };
        // 10 px right of the east handle is 0.01 of the width, 5 px below is 0.01 of the height
        expect(hitHandle(r, { x: 0.61, y: 0.5 }, stage, 14)).toBe("e");
        expect(hitHandle(r, { x: 0.6, y: 0.51 }, stage, 14)).toBe("e");
        expect(hitHandle(r, { x: 0.65, y: 0.5 }, stage, 14)).toBeNull();
    });
    test("the nearest handle wins when the mask is small", () => {
        const small = { x: 0.5, y: 0.5, w: 0.02, h: 0.02 };
        const stage = { w: 1000, h: 1000 };
        expect(hitHandle(small, { x: 0.5, y: 0.5 }, stage, 14)).toBe("nw");
        expect(hitHandle(small, { x: 0.52, y: 0.52 }, stage, 14)).toBe("se");
    });
});

describe("cardScrollTop", () => {
    // Everything is in pixels from the top of the card's scrolling content
    const base = { view: 260, content: 700, lead: 40, label: null as { bottom: number } | null };

    test("a card that fits is not scrolled", () => {
        expect(
            cardScrollTop({
                ...base,
                content: 250,
                mask: { top: 100, bottom: 130 },
                stage: { top: 60, bottom: 200 },
            }),
        ).toBe(0);
    });

    test("a picture that fits is shown whole, with its question above it when that fits too", () => {
        expect(
            cardScrollTop({
                ...base,
                lead: 300,
                mask: { top: 380, bottom: 410 },
                stage: { top: 320, bottom: 460 },
            }),
        ).toBe(292);
        // Question and picture together are taller than the card: the picture wins, a little below the top, so that the
        // star in the card's corner is not on it
        expect(
            cardScrollTop({
                ...base,
                lead: 200,
                mask: { top: 380, bottom: 410 },
                stage: { top: 320, bottom: 500 },
            }),
        ).toBe(276);
    });

    test("a picture that is too tall is shown from the question, or from the top of the picture, down to the mask", () => {
        expect(
            cardScrollTop({
                ...base,
                lead: 300,
                mask: { top: 350, bottom: 380 },
                stage: { top: 320, bottom: 820 },
            }),
        ).toBe(292);
        expect(
            cardScrollTop({
                ...base,
                lead: 200,
                mask: { top: 420, bottom: 460 },
                stage: { top: 320, bottom: 900 },
            }),
        ).toBe(276);
    });

    test("a mask deep in a picture taller than the card is scrolled to the middle", () => {
        expect(
            cardScrollTop({
                ...base,
                mask: { top: 400, bottom: 440 },
                stage: { top: 100, bottom: 600 },
            }),
        ).toBe(290);
    });

    describe("on the back, where the answer is under the picture", () => {
        test("the answer is in view with the picture when they fit", () => {
            // The question, the picture and the answer (which ends at 517) are 217 tall
            expect(
                cardScrollTop({
                    ...base,
                    lead: 300,
                    label: { bottom: 517 },
                    mask: { top: 380, bottom: 410 },
                    stage: { top: 320, bottom: 460 },
                }),
            ).toBe(292);
            // Without the question they do, with it they do not
            expect(
                cardScrollTop({
                    ...base,
                    lead: 200,
                    label: { bottom: 517 },
                    mask: { top: 380, bottom: 410 },
                    stage: { top: 320, bottom: 460 },
                }),
            ).toBe(276);
        });

        test("a picture that is too tall is scrolled to the answer, when the mask is in view with it", () => {
            expect(
                cardScrollTop({
                    ...base,
                    content: 720,
                    label: { bottom: 707 },
                    mask: { top: 560, bottom: 600 },
                    stage: { top: 300, bottom: 650 },
                }),
            ).toBe(455);
        });

        test("when the mask and the answer do not fit together the mask is put in the middle, and the answer is below", () => {
            expect(
                cardScrollTop({
                    ...base,
                    content: 720,
                    label: { bottom: 707 },
                    mask: { top: 400, bottom: 440 },
                    stage: { top: 100, bottom: 650 },
                }),
            ).toBe(290);
        });
    });

    test("never scrolls past either end of the content", () => {
        expect(
            cardScrollTop({
                ...base,
                lead: 0,
                mask: { top: 10, bottom: 40 },
                stage: { top: 0, bottom: 600 },
            }),
        ).toBe(0);
        expect(
            cardScrollTop({
                ...base,
                mask: { top: 660, bottom: 690 },
                stage: { top: 100, bottom: 700 },
            }),
        ).toBe(440);
    });
});
