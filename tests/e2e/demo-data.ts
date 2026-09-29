/**
 * Demo content for the documentation screenshots: a few decks of cards in every state, and half a year of review
 * history. Everything is derived from `now` and a fixed random seed, so every run draws the same picture.
 */

const DAY = 24 * 3600 * 1000;

/** A small deterministic random number generator (mulberry32). */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface DeckSpec {
    tag: string;
    path: string;
    /** The note that holds the cards. */
    note: string;
    cards: [string, string][];
    weight: number;
    /** How often a review in this deck is answered Again, so the decks differ in the Weak areas card. */
    missRate: number;
}

const DECKS: DeckSpec[] = [
    {
        tag: "flashcards/spanish",
        path: "flashcards/spanish",
        note: "Demo/Spanish.md",
        weight: 0.42,
        missRate: 0.05,
        cards: [
            ["la casa", "the house"],
            ["el perro", "the dog"],
            ["la ventana", "the window"],
            ["el trabajo", "the job"],
            ["la ciudad", "the city"],
            ["el desayuno", "breakfast"],
            ["la playa", "the beach"],
            ["el libro", "the book"],
            ["la mesa", "the table"],
            ["el amigo", "the friend"],
            ["la lluvia", "the rain"],
            ["el viaje", "the trip"],
            ["la cocina", "the kitchen"],
            ["el coche", "the car"],
            ["la calle", "the street"],
            ["el tiempo", "the time, the weather"],
            ["la noche", "the night"],
            ["el pueblo", "the village"],
            ["la escuela", "the school"],
            ["el mercado", "the market"],
            ["la abuela", "the grandmother"],
            ["el cielo", "the sky"],
            ["la tienda", "the shop"],
            ["el puente", "the bridge"],
            ["la montana", "the mountain"],
            ["el sueno", "the dream"],
            ["la sorpresa", "the surprise"],
            ["el regalo", "the gift"],
            ["la verdad", "the truth"],
            ["el silencio", "the silence"],
        ],
    },
    {
        tag: "flashcards/cia/part2",
        path: "flashcards/cia/part2",
        note: "Demo/CIA Part 2.md",
        weight: 0.33,
        missRate: 0.21,
        cards: [
            ["What is inherent risk?", "Risk before any controls are applied"],
            ["What is residual risk?", "Risk that remains after controls"],
            ["What is a control objective?", "The result management wants a control to achieve"],
            [
                "Define risk appetite",
                "The level of risk an organization accepts to pursue its goals",
            ],
            ["What is a detective control?", "A control that finds problems after they occur"],
            ["What is a preventive control?", "A control that stops problems before they occur"],
            ["What does COSO stand for?", "Committee of Sponsoring Organizations"],
            ["What is the audit universe?", "All the auditable entities of an organization"],
            ["What is a walkthrough?", "Following one transaction through a process"],
            ["Define materiality", "Size or nature of a misstatement that could change a decision"],
            ["What is sampling risk?", "The chance the sample is not representative"],
            ["What is a finding?", "A condition, criteria, cause and effect"],
            [
                "What is root cause analysis?",
                "Finding why a problem happened, not only what happened",
            ],
            ["What is a KRI?", "Key risk indicator"],
            [
                "What is segregation of duties?",
                "Splitting tasks so one person cannot commit and hide fraud",
            ],
            [
                "What is an audit charter?",
                "The document that sets the purpose and authority of internal audit",
            ],
            ["What is the third line?", "Independent assurance by internal audit"],
            ["What is continuous auditing?", "Ongoing automated testing of controls"],
            ["What is a control self assessment?", "Management assesses its own controls"],
            ["Define fraud risk", "The chance intentional deception causes a loss"],
        ],
    },
    {
        tag: "flashcards/anatomy",
        path: "flashcards/anatomy",
        note: "Demo/Anatomy.md",
        weight: 0.25,
        missRate: 0.12,
        cards: [
            ["Largest bone in the body", "Femur"],
            ["Which nerve controls the diaphragm?", "Phrenic nerve"],
            ["What does the pancreas produce?", "Insulin, glucagon and digestive enzymes"],
            ["How many chambers does the heart have?", "Four"],
            ["Which valve is between the left atrium and ventricle?", "Mitral valve"],
            ["What is the smallest bone?", "Stapes"],
            ["Where is the cerebellum?", "Below the occipital lobes, behind the brainstem"],
            ["What does the liver store?", "Glycogen, vitamins and iron"],
            ["Which artery supplies the heart?", "The coronary arteries"],
            ["What connects muscle to bone?", "Tendons"],
            ["What connects bone to bone?", "Ligaments"],
            ["Which lobe processes vision?", "Occipital lobe"],
            ["What is the function of the spleen?", "Filters blood and recycles old red cells"],
            ["Name the three auditory ossicles", "Malleus, incus, stapes"],
            ["What is the longest nerve?", "Sciatic nerve"],
        ],
    },
];

export interface DemoNote {
    path: string;
    content: string;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function localDay(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The notes with the demo cards. Each card carries a schedule comment, so the decks have new, learning, young,
 * mature, overdue, suspended and buried cards, with stabilities and difficulties that look like real study.
 */
export function buildDemoNotes(now: number): DemoNote[] {
    const random = seeded(20260929);
    const tomorrow = localDay(now + DAY);

    return DECKS.map((deck, deckIndex) => {
        const lines: string[] = [`#${deck.tag}`, ""];
        deck.cards.forEach(([front, back], index) => {
            const id = `d${deckIndex}${index.toString(36).padStart(3, "0")}`;
            const roll = random();
            let comment: string;
            if (roll < 0.14) {
                comment = ""; // a new card has no schedule yet
            } else if (roll < 0.19) {
                const due = new Date(now + Math.round(random() * 4 * 3600 * 1000)).toISOString();
                const last = new Date(now - 20 * 60 * 1000).toISOString();
                comment = `<!--SR:!fsrs,${due},0,${(0.4 + random() * 1.5).toFixed(2)},${(4 + random() * 4).toFixed(2)},1,1,0,1,${last},id=${id}-->`;
            } else if (roll < 0.22) {
                const due = new Date(now + Math.round(random() * 3 * 3600 * 1000)).toISOString();
                const last = new Date(now - 30 * 60 * 1000).toISOString();
                comment = `<!--SR:!fsrs,${due},0,${(0.8 + random()).toFixed(2)},${(6 + random() * 3).toFixed(2)},3,9,2,1,${last},id=${id}-->`;
            } else {
                // A review card: an interval from a day to over a year, last seen part way through it
                const interval = Math.max(1, Math.round(Math.exp(random() * Math.log(420))));
                const seenAgo = random() * interval * 1.25;
                const last = now - seenAgo * DAY;
                const due = new Date(last + interval * DAY).toISOString();
                const stability = (interval * (0.9 + random() * 0.5)).toFixed(2);
                const difficulty = (2 + random() * 6.5).toFixed(2);
                const reps = 2 + Math.round(Math.log2(interval + 1) * (0.8 + random()));
                const lapses = random() < 0.25 ? 1 + Math.round(random() * 3) : 0;
                const extra =
                    random() < 0.04 ? ",susp" : random() < 0.03 ? `,bury=${tomorrow}` : "";
                comment = `<!--SR:!fsrs,${due},${interval},${stability},${difficulty},2,${reps},${lapses},0,${new Date(last).toISOString()},id=${id}${extra}-->`;
            }
            lines.push(`${front}:: ${back}${comment}`);
        });
        return { path: deck.note, content: lines.join("\n") + "\n" };
    });
}

interface DemoEntry {
    t: number;
    c: string;
    r: number;
    k: number;
    n?: 1;
    ivl: number;
    li: number;
    s?: number;
    d?: number;
    ms: number;
    dk: string;
    f: string;
}

/**
 * Half a year of review history: busier on weekdays, a habit that builds up over time, a streak that runs to today,
 * and mostly evening sessions.
 */
export function buildDemoLog(now: number): DemoEntry[] {
    const random = seeded(4242);
    const entries: DemoEntry[] = [];
    const hours = [7, 8, 8, 9, 12, 13, 18, 19, 20, 20, 21, 21, 22, 22, 23];

    const pickDeck = (): DeckSpec => {
        let roll = random();
        for (const deck of DECKS) {
            if (roll < deck.weight) return deck;
            roll -= deck.weight;
        }
        return DECKS[0];
    };

    for (let ago = 182; ago >= 0; ago--) {
        const dayStart = new Date(now - ago * DAY);
        dayStart.setHours(0, 0, 0, 0);
        const weekday = dayStart.getDay();
        const weekend = weekday === 0 || weekday === 6;
        // The habit builds up: the last 24 days never miss, earlier days are increasingly patchy
        const streakDay = ago <= 23;
        const chance = streakDay ? 1 : 0.35 + 0.55 * (1 - ago / 182) - (weekend ? 0.15 : 0);
        if (random() > chance) continue;

        const size = Math.round((weekend ? 9 : 16) + random() * 26 * (0.4 + 0.6 * (1 - ago / 182)));
        for (let i = 0; i < size; i++) {
            const hour = hours[Math.floor(random() * hours.length)];
            const t = dayStart.getTime() + (hour * 60 + Math.floor(random() * 60)) * 60000;
            // Today only has the reviews that already happened
            if (t >= now - 60000) continue;

            const deck = pickDeck();
            const kindRoll = random();
            const k = kindRoll < 0.1 ? 0 : kindRoll < 0.18 ? 2 : 1;
            const ratingRoll = random();
            const miss = deck.missRate;
            const r =
                ratingRoll < miss
                    ? 1
                    : ratingRoll < miss + 0.11
                      ? 2
                      : ratingRoll < miss + 0.73
                        ? 3
                        : 4;
            const li = k === 1 ? Math.round(Math.exp(random() * Math.log(160))) : 0;
            const ivl = r === 1 ? 0.007 : Math.max(1, Math.round(li * (1.4 + random() * 1.8)));
            const entry: DemoEntry = {
                t,
                c: `d${Math.floor(random() * 4000)
                    .toString(36)
                    .padStart(4, "0")}`,
                r,
                k,
                ivl,
                li,
                s: Math.round(ivl * 100) / 100,
                d: Math.round((3 + random() * 5) * 100) / 100,
                ms: Math.round(2500 + random() * random() * 20000),
                dk: deck.path,
                f: deck.note,
            };
            if (k === 0) entry.n = 1;
            entries.push(entry);
        }
    }
    return entries.sort((a, b) => a.t - b.t);
}

/**
 * The review log files for the entries, one per month like the plugin writes them, ready to create in the vault.
 */
export function buildDemoLogFiles(
    folder: string,
    entries: DemoEntry[],
): { path: string; content: string }[] {
    const device = "demo-7c1a";
    const months = new Map<string, DemoEntry[]>();
    for (const entry of entries) {
        const date = new Date(entry.t);
        const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
        months.set(key, [...(months.get(key) ?? []), entry]);
    }
    return Array.from(months.entries()).map(([month, list]) => ({
        path: `${folder}/${month} ${device}.md`,
        content:
            `---\nflashcard-studio: review-log\ndevice: ${device}\n---\n` +
            "Review history written by Flashcard Studio. One JSON object per line. Do not edit.\n\n" +
            "```srlog\n" +
            list.map((entry) => JSON.stringify(entry)).join("\n") +
            "\n",
    }));
}
