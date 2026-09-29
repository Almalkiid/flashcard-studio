// Jest counterpart of the embed-wasm esbuild plugin (esbuild.config.mjs): what importing sql.js's .wasm file returns
// in the bundle, which is the file's bytes deflate-compressed and base64 encoded. Jest itself would treat a .wasm
// import as an ES module, so jest.config.js maps the import here instead.
const fs = require("fs");
const path = require("path");
const { deflateRawSync } = require("zlib");

const wasmPath = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm-browser.wasm");
const base64 = deflateRawSync(fs.readFileSync(wasmPath), { level: 9 }).toString("base64");

module.exports = { __esModule: true, default: base64 };
