import { moment as obsidianMoment } from "obsidian";

// Obsidian types its moment export as a namespace import, which TypeScript does not treat as
// callable under esModuleInterop. It is the same moment instance Obsidian provides to plugins.
const obsidianMomentFn = obsidianMoment as unknown as typeof import("moment");

/**
 * Obsidian's shared moment follows the app language, and some locales (e.g. Arabic) format with non-Latin digits.
 * Dates this plugin formats are written into notes and compared against stored text, so every instance it creates
 * uses English, whatever language Obsidian runs in. Static helpers pass through unchanged.
 */
export const moment = new Proxy(obsidianMomentFn, {
    apply(target, _thisArg, args: Parameters<typeof obsidianMomentFn>) {
        return target(...args).locale("en");
    },
});
