import { PendingCards } from "src/scheduling/review/pending-cards";

// D3 #9 / D2 #13: the learning queue is a min-heap by due time, and cards due at the same time wake in the order they
// were answered.

function queueOf(...entries: [string, number][]): PendingCards<string> {
    const queue = new PendingCards<string>();
    for (const [card, due] of entries) queue.push(card, due);
    return queue;
}

test("an empty queue has nothing due and no next time", () => {
    const queue = new PendingCards<string>();
    expect(queue.size).toBe(0);
    expect(queue.nextDueUnix).toBeNull();
    expect(queue.takeDue(Infinity)).toEqual([]);
});

test("wakes the cards due by a time, earliest first, and keeps the rest", () => {
    const queue = queueOf(["c", 30], ["a", 10], ["d", 40], ["b", 20]);
    expect(queue.nextDueUnix).toBe(10);
    expect(queue.takeDue(25)).toEqual(["a", "b"]);
    expect(queue.size).toBe(2);
    expect(queue.nextDueUnix).toBe(30);
    expect(queue.takeDue(30)).toEqual(["c"]);
    expect(queue.takeDue(39)).toEqual([]);
});

test("equal due times wake in the order the cards were answered (D2 #13)", () => {
    const queue = queueOf(["A", 600], ["B", 600], ["C", 600], ["early", 300]);
    expect(queue.takeDue(600)).toEqual(["early", "A", "B", "C"]);
});

test("removes cards by a test and stays ordered", () => {
    const queue = queueOf(["a", 5], ["b", 1], ["c", 3], ["d", 2], ["e", 4]);
    queue.removeWhere((card) => card === "b" || card === "e");
    expect(queue.inWakeOrder()).toEqual([
        { card: "d", dueUnix: 2 },
        { card: "c", dueUnix: 3 },
        { card: "a", dueUnix: 5 },
    ]);
    expect(queue.takeDue(10)).toEqual(["d", "c", "a"]);
});

test("stays ordered over many random pushes and takes", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const queue = new PendingCards<number>();
    const expected: { card: number; dueUnix: number }[] = [];
    for (let i = 0; i < 500; i++) {
        const due = Math.floor(random() * 50);
        queue.push(i, due);
        expected.push({ card: i, dueUnix: due });
    }
    expected.sort((a, b) => a.dueUnix - b.dueUnix || a.card - b.card);
    expect(queue.inWakeOrder()).toEqual(expected);
    expect(queue.takeDue(24)).toEqual(expected.filter((e) => e.dueUnix <= 24).map((e) => e.card));
    expect(queue.takeDue(Infinity)).toEqual(
        expected.filter((e) => e.dueUnix > 24).map((e) => e.card),
    );
});

describe("cards without a due time (§10.7)", () => {
    test("wait for good, make the next due time NaN, and do not hide the dated cards", () => {
        const queue = queueOf(["undated", NaN], ["b", 20], ["a", 10]);
        expect(queue.size).toBe(3);
        expect(queue.nextDueUnix).toBeNaN();
        expect(queue.hasDueBy(15)).toBe(true);
        expect(queue.hasDueBy(5)).toBe(false);
        expect(queue.takeDue(Infinity)).toEqual(["a", "b"]);
        expect(queue.hasDueBy(Infinity)).toBe(false);
        expect(queue.size).toBe(1);
        expect(queue.inWakeOrder()).toEqual([{ card: "undated", dueUnix: NaN }]);
        queue.removeWhere((card) => card === "undated");
        expect(queue.nextDueUnix).toBeNull();
    });
});
