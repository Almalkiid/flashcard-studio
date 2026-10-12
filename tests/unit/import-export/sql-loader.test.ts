/**
 * @jest-environment node
 */
import { decodeBase64, loadSql } from "src/import-export/sql-loader";

describe("sql-loader", () => {
    test("decodes base64 to the original bytes", () => {
        expect(Array.from(decodeBase64("AAECAwT/"))).toEqual([0, 1, 2, 3, 4, 255]);
        expect(decodeBase64("")).toEqual(new Uint8Array());
    });

    test("loads sql.js from the embedded, deflated binary and runs a query", async () => {
        const SQL = await loadSql();
        const db = new SQL.Database();
        db.run("CREATE TABLE t (a INTEGER, b TEXT)");
        db.run("INSERT INTO t VALUES (7, 'x')");
        expect(db.exec("SELECT a, b FROM t")[0].values).toEqual([[7, "x"]]);
        db.close();
    });

    test("loads sql.js only once", async () => {
        expect(await loadSql()).toBe(await loadSql());
    });
});
