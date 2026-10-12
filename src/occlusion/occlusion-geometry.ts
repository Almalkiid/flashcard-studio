/**
 * The geometry of drawing, moving and resizing masks. Everything is in fractions of the image (0 to 1), which is what
 * the block stores, except the hit radius of a handle, which is in pixels because a finger is as big on any image.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** A mask smaller than this, in either direction, is not a mask. */
export const MIN_MASK = 0.01;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The box between two corners, whichever way the drag went, kept inside the image. */
export function rectFromPoints(a: Point, b: Point): Rect {
    const left = clamp01(Math.min(a.x, b.x));
    const right = clamp01(Math.max(a.x, b.x));
    const top = clamp01(Math.min(a.y, b.y));
    const bottom = clamp01(Math.max(a.y, b.y));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isBigEnough(rect: Rect): boolean {
    return rect.w >= MIN_MASK - 1e-9 && rect.h >= MIN_MASK - 1e-9;
}

/** The same size, moved by (dx, dy), and stopped at the edges of the image. */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
    return {
        ...rect,
        x: Math.min(1 - rect.w, Math.max(0, rect.x + dx)),
        y: Math.min(1 - rect.h, Math.max(0, rect.y + dy)),
    };
}

/**
 * One axis of a resize: the edges start..end, of which the moving ones are moved by d. The result is inside 0..1, at
 * least MIN_MASK long, and the right way round when an edge was dragged past the other one.
 */
function resizeAxis(
    start: number,
    end: number,
    movesStart: boolean,
    movesEnd: boolean,
    d: number,
): [number, number] {
    let a = clamp01(start + (movesStart ? d : 0));
    let b = clamp01(end + (movesEnd ? d : 0));
    if (a > b) [a, b] = [b, a];
    if (b - a < MIN_MASK) {
        // The edge that is being dragged gives way, so the mask stays where the other edge holds it
        if (movesStart && !movesEnd) {
            b = end;
            a = Math.max(0, b - MIN_MASK);
            b = a + MIN_MASK;
        } else {
            a = start;
            b = Math.min(1, a + MIN_MASK);
            a = b - MIN_MASK;
        }
    }
    return [a, b];
}

/**
 * The mask after one of its handles was dragged by (dx, dy) from where the drag started. Computed from the mask as it
 * was at the start, so the drag is not cumulative.
 */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number): Rect {
    const [left, right] = resizeAxis(
        rect.x,
        rect.x + rect.w,
        handle.includes("w"),
        handle.includes("e"),
        dx,
    );
    const [top, bottom] = resizeAxis(
        rect.y,
        rect.y + rect.h,
        handle.includes("n"),
        handle.includes("s"),
        dy,
    );
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Whether a point is in a mask. An ellipse does not reach the corners of its box. */
function contains(mask: Rect & { shape: "rect" | "ellipse" }, p: Point): boolean {
    if (p.x < mask.x || p.x > mask.x + mask.w || p.y < mask.y || p.y > mask.y + mask.h)
        return false;
    if (mask.shape === "rect") return true;
    const nx = (p.x - (mask.x + mask.w / 2)) / (mask.w / 2);
    const ny = (p.y - (mask.y + mask.h / 2)) / (mask.h / 2);
    return nx * nx + ny * ny <= 1;
}

/** The index of the mask under a point, the one drawn last when several are, or -1. */
export function hitMask(masks: (Rect & { shape: "rect" | "ellipse" })[], p: Point): number {
    for (let i = masks.length - 1; i >= 0; i--) {
        if (contains(masks[i], p)) return i;
    }
    return -1;
}

export function handlePoint(rect: Rect, handle: Handle): Point {
    const x = handle.includes("w")
        ? rect.x
        : handle.includes("e")
          ? rect.x + rect.w
          : rect.x + rect.w / 2;
    const y = handle.includes("n")
        ? rect.y
        : handle.includes("s")
          ? rect.y + rect.h
          : rect.y + rect.h / 2;
    return { x, y };
}

/**
 * The handle of a mask that a point is on, within `radius` pixels (the stage is `stage` pixels big), the nearest when
 * more than one is. Null when the point is on none.
 */
export function hitHandle(
    rect: Rect,
    p: Point,
    stage: { w: number; h: number },
    radius: number,
): Handle | null {
    let best: Handle | null = null;
    let bestDistance = radius;
    for (const handle of HANDLES) {
        const at = handlePoint(rect, handle);
        const distance = Math.hypot((p.x - at.x) * stage.w, (p.y - at.y) * stage.h);
        if (distance <= bestDistance) {
            best = handle;
            bestDistance = distance;
        }
    }
    return best;
}

export interface CardScrollInput {
    /** The height of the card's scrolling area that can be seen. */
    view: number;
    /** The height of everything in it. */
    content: number;
    /** Where the top of the block (its question) is. */
    lead: number;
    /** Where the bottom of the answer under the picture is, or null when the card has none (the front). */
    label: { bottom: number } | null;
    /** Where the mask that the card asks about is. */
    mask: { top: number; bottom: number };
    /** Where the picture is. */
    stage: { top: number; bottom: number };
}

/** The room kept around what is scrolled to. */
const SCROLL_PAD = 8;

/** The room above a picture that the card keeps for its own buttons in the corner (the star), when it starts there. */
const CORNER_CLEARANCE = 44;

/**
 * How far to scroll a review card, whose picture is as wide as the card and so may be taller than it, so that the mask
 * that the card asks about is seen without scrolling by hand. All values are in pixels from the top of the card's
 * scrolling content. As much as fits is shown, in this order: the question, the picture and the answer under it; the
 * picture and the answer; the mask and the answer; the question down to the mask; the picture down to the mask; and,
 * when the mask is deep in a picture that is too tall for any of that, the mask in the middle of the card.
 */
export function cardScrollTop(input: CardScrollInput): number {
    const room = input.view - 2 * SCROLL_PAD;
    // A picture that starts at the top of the card would be under the star, so it starts a little lower
    const pictureRoom = input.view - CORNER_CLEARANCE - SCROLL_PAD;
    const pictureTop = input.stage.top - CORNER_CLEARANCE;
    const max = Math.max(0, input.content - input.view);
    const end = input.label?.bottom ?? input.stage.bottom;

    let target: number;
    if (end - input.lead <= room) target = input.lead - SCROLL_PAD;
    else if (end - input.stage.top <= pictureRoom) target = pictureTop;
    else if (input.label !== null && input.label.bottom - input.mask.top <= room) {
        target = input.label.bottom + SCROLL_PAD - input.view;
    } else if (input.mask.bottom - input.lead <= room) target = input.lead - SCROLL_PAD;
    else if (input.mask.bottom - input.stage.top <= pictureRoom) target = pictureTop;
    else target = (input.mask.top + input.mask.bottom) / 2 - input.view / 2;
    return Math.min(max, Math.max(0, target));
}
