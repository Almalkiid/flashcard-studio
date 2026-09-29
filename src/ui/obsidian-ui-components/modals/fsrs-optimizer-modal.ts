import { App, Modal, Setting } from "obsidian";
import { default_w as defaultWeights } from "ts-fsrs";

import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { parseFsrsSteps, parseFsrsWeights } from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { FitMetrics } from "src/scheduling/optimizer/evaluate";
import {
    MIN_REVIEWS_TO_OPTIMIZE,
    optimizeParameters,
    OptimizeResult,
} from "src/scheduling/optimizer/optimize";
import { buildCardHistories, countTrainingReviews } from "src/scheduling/optimizer/training-set";
import { DateUtil } from "src/utils/dates";

/**
 * The optimizer is one synchronous call, so a message is shown and given a moment to be painted before it starts.
 */
function letScreenPaint(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 60));
}

function percentChange(current: number, optimized: number): string {
    if (current === 0) return "";
    const change = ((optimized - current) / current) * 100;
    return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

/**
 * Fits the FSRS parameters to the review log, shows how much better they predict than the current ones, and applies
 * them when asked.
 */
export class FsrsOptimizerModal extends Modal {
    private plugin: SRPlugin;
    private apply: (weights: number[]) => Promise<void>;
    private deck = "";
    private running = false;

    /**
     * @param apply - Stores the new weights; called when the user presses Apply.
     */
    constructor(app: App, plugin: SRPlugin, apply: (weights: number[]) => Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.apply = apply;
    }

    onOpen(): void {
        this.modalEl.addClass("sr-optimizer-modal");
        this.setTitle(t("OPTIMIZER_TITLE"));
        this.renderForm();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderForm(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl)
            .setName(t("OPTIMIZER_DECK_FILTER"))
            .setDesc(t("OPTIMIZER_DECK_FILTER_DESC"))
            .addText((text) =>
                text.setValue(this.deck).onChange((value) => {
                    this.deck = value.trim();
                }),
            );
        new Setting(contentEl).addButton((button) =>
            button
                .setButtonText(t("FSRS_OPTIMIZE"))
                .setCta()
                .setClass("sr-optimizer-run")
                .onClick(() => void this.run()),
        );
    }

    private showMessage(text: string, cls = "sr-optimizer-message"): void {
        this.contentEl.empty();
        this.contentEl.createEl("p", { cls, text });
    }

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const settings = this.plugin.dataManager.data.settings;
            this.showMessage(t("OPTIMIZER_LOADING"));
            const entries = await this.plugin.dataManager.reviewLog.readAll();
            const boundary = DateUtil.strToDayBoundary(settings.startOfDay);
            const histories = buildCardHistories(entries, {
                dayStartOffsetMs: boundary
                    ? (boundary.hour * 60 + boundary.minute) * 60000 + boundary.second * 1000
                    : 0,
                deck: this.deck,
            });

            const reviews = countTrainingReviews(histories);
            if (reviews < MIN_REVIEWS_TO_OPTIMIZE) {
                this.showMessage(
                    t("OPTIMIZER_TOO_FEW", { min: MIN_REVIEWS_TO_OPTIMIZE, count: reviews }),
                    "sr-optimizer-too-few",
                );
                this.addCloseButton();
                return;
            }

            const relearningSteps = parseFsrsSteps(settings.fsrsRelearningSteps) ?? ["10m"];
            const current = parseFsrsWeights(settings.fsrsWeights, relearningSteps.length).weights;

            this.showMessage(t("OPTIMIZER_RUNNING"), "sr-optimizer-running");
            await letScreenPaint();
            const result = optimizeParameters(
                histories,
                current ?? defaultWeights,
                relearningSteps.length,
            );
            this.renderResult(result);
        } catch (error) {
            console.error("Cardwright: optimizing the FSRS parameters failed", error);
            this.showMessage(
                t("OPTIMIZER_ERROR", {
                    reason: error instanceof Error ? error.message : String(error),
                }),
                "sr-optimizer-error",
            );
            this.addCloseButton();
        } finally {
            this.running = false;
        }
    }

    private addCloseButton(): void {
        new Setting(this.contentEl).addButton((button) =>
            button.setButtonText(t("CANCEL")).onClick(() => this.close()),
        );
    }

    private renderResult(result: OptimizeResult): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("p", {
            cls: "sr-optimizer-summary",
            text: t("OPTIMIZER_SUMMARY", {
                reviews: result.reviewsUsed,
                cards: result.cardCount,
                seconds: (result.elapsedMs / 1000).toFixed(1),
            }),
        });

        const table = contentEl.createEl("table", { cls: "sr-optimizer-result" });
        const head = table.createEl("thead").createEl("tr");
        head.createEl("th");
        head.createEl("th", { text: t("OPTIMIZER_CURRENT") });
        head.createEl("th", { text: t("OPTIMIZER_OPTIMIZED") });
        const body = table.createEl("tbody");
        const addRow = (label: string, current: number, optimized: number, decimals: number) => {
            const row = body.createEl("tr");
            row.createEl("td", { text: label });
            row.createEl("td", { text: current.toFixed(decimals) });
            row.createEl("td", {
                text: `${optimized.toFixed(decimals)} (${percentChange(current, optimized)})`,
            });
        };
        const asPercent = (metrics: FitMetrics) => metrics.rmse * 100;
        addRow(t("OPTIMIZER_LOG_LOSS"), result.current.logLoss, result.optimized.logLoss, 4);
        addRow(
            t("OPTIMIZER_RMSE") + " %",
            asPercent(result.current),
            asPercent(result.optimized),
            2,
        );
        contentEl.createEl("p", { cls: "sr-optimizer-note", text: t("OPTIMIZER_LOWER_IS_BETTER") });

        const better = result.optimized.logLoss < result.current.logLoss;
        contentEl.createEl("p", {
            cls: better ? "sr-optimizer-better" : "sr-optimizer-not-better",
            text: better ? t("OPTIMIZER_BETTER") : t("OPTIMIZER_NOT_BETTER"),
        });

        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t("OPTIMIZER_APPLY"))
                    .setCta()
                    .setClass("sr-optimizer-apply")
                    .setDisabled(!better)
                    .onClick(async () => {
                        button.setDisabled(true);
                        await this.apply(result.weights);
                        this.close();
                    }),
            )
            .addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));
    }
}
