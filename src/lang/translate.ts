import en, { IBaseLocale } from "src/lang/en-strings";

/** The message tables by language code. Only English ships, so every other language reads it. */
const tables: Record<string, IBaseLocale> = { en };

let active = "en";
let warnedAbout: string | null = null;

/**
 * The table to use for a language code such as "sv" or "zh-TW": the code itself, else its base language, else
 * English. A language without a table is reported once in the console.
 */
export function pickLocale(code: string): string {
    const lower = code.toLowerCase();
    for (const candidate of [lower, lower.split("-")[0]]) {
        if (Object.prototype.hasOwnProperty.call(tables, candidate)) return candidate;
    }
    if (warnedAbout !== code) {
        console.warn(`Flashcard Studio: no translation for "${code}", using English.`);
        warnedAbout = code;
    }
    return "en";
}

/** Makes `code` the language of every later `t()` call. */
export function setLocale(code: string): void {
    active = pickLocale(code);
}

export function currentLocale(): string {
    return active;
}

/**
 * Puts each parameter where its `${name}` appears in `text`, in a single pass. The values are inserted as they
 * are, so a deck name such as "A$&B" survives, and a value that itself looks like `${name}` is never filled in
 * again. A `${name}` with no parameter stays as written.
 */
export function fillParameters(text: string, params: Record<string, string | number>): string {
    return text.replace(/\$\{(\w+)\}/g, (token: string, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
    );
}

/** The message for `key` in the current language, with `params` filled in. */
export function t(key: keyof IBaseLocale, params?: Record<string, string | number>): string {
    const text = tables[active][key] ?? en[key];
    return params === undefined ? text : fillParameters(text, params);
}
