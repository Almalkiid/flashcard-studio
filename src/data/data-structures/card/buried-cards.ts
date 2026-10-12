import type { Question } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import type { PluginData } from "src/data/stored-data";
import type { PluginDataManager } from "src/data/stored-data";
import { formatDate, globalDateProvider } from "src/utils/clock";

/** The questions whose other cards are put off to another day. */
export interface IBuriedCards {
    clear(): void;
    add(question: Question): void;
    includes(question: Question): boolean;
    remove(question: Question): void;
    write(): Promise<void>;
}

/** The buried siblings, as the hashes of their question texts; `list` is the array that is kept in the plugin data. */
export class BuriedCards implements IBuriedCards {
    constructor(
        private readonly pluginDataManager: PluginDataManager | null,
        _settings: StudioSettings,
        readonly list: string[],
    ) {}

    clear(): void {
        this.list.length = 0;
    }

    add(question: Question): void {
        const { textHash } = question.questionText;
        if (!this.list.includes(textHash)) this.list.push(textHash);
    }

    includes(question: Question): boolean {
        const { textHash } = question.questionText;
        return this.list.includes(textHash);
    }

    remove(question: Question): void {
        const at = this.list.indexOf(question.questionText.textHash);
        if (at !== -1) this.list.splice(at, 1);
    }

    /** Saves the plugin data; there is nothing to save when the list is not tied to a plugin (in tests). */
    async write(): Promise<void> {
        if (this.pluginDataManager) await this.pluginDataManager.savePluginData();
    }

    /**
     * Clears the list when the study day has changed since it was last cleared, so a question is put off for one day
     * only. Call it after the day boundary is set.
     */
    async clearIfNewDay(data: PluginData): Promise<void> {
        // The study day, so a day that starts at 04:00 keeps its buried siblings until 04:00
        const studyDay = formatDate(globalDateProvider.today.valueOf());
        if (studyDay !== data.buryDate) {
            data.buryDate = studyDay;
            this.clear();
            await this.write();
        }
    }
}
