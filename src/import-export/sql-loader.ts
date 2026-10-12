import type { SqlJsStatic } from "sql.js";

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Decodes standard base64 text to bytes. */
export function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Loads sql.js and its WebAssembly binary, once, the first time an Anki import or export needs a database.
 *
 * The binary is part of main.js (see the embed-wasm plugin in esbuild.config.mjs), so this makes no network request
 * and needs no extra file. Everything is loaded with dynamic imports, so plugin start-up neither evaluates sql.js,
 * ankipack or fflate nor instantiates any WebAssembly. sql.js is single-threaded and uses no shared memory, so it
 * works on iOS.
 */
export function loadSql(): Promise<SqlJsStatic> {
    if (sqlPromise === null) {
        sqlPromise = (async () => {
            const [{ default: initSqlJs }, { default: deflatedWasm }, { inflateSync }] =
                await Promise.all([
                    import("sql.js"),
                    import("sql.js/dist/sql-wasm-browser.wasm"),
                    import("fflate"),
                ]);
            const wasm = inflateSync(decodeBase64(deflatedWasm));
            // Copy into a plain ArrayBuffer of exactly the binary's size, which is what sql.js expects
            return initSqlJs({ wasmBinary: wasm.slice().buffer });
        })();
        // A failed load must not be remembered, so that the next attempt can try again
        sqlPromise.catch(() => {
            sqlPromise = null;
        });
    }
    return sqlPromise;
}
