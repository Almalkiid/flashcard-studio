import type { SemanticOutcome } from "src/ai/typed-answer-grading";

/** One request per reveal; invalidation also covers actions still saving the old card. */
export class SemanticReveal {
    private token = 0;
    private started = false;

    invalidate(): void {
        this.token++;
    }

    reset(): void {
        this.invalidate();
        this.started = false;
    }

    currentToken(): number {
        return this.token;
    }

    isCurrent(token: number): boolean {
        return token === this.token;
    }

    start(
        mode: string,
        exact: boolean,
        typed: string,
        grade: () => Promise<SemanticOutcome>,
        render: (outcome: SemanticOutcome) => void,
    ): boolean {
        if (mode !== "ai-assisted" || exact || typed.trim() === "" || this.started) return false;
        this.started = true;
        const token = this.token;
        void grade().then((outcome) => {
            if (this.isCurrent(token)) render(outcome);
        });
        return true;
    }
}
