/**
 * @jest-environment node
 */
import { unzipSync, zipSync } from "fflate";

import { readZipDirectory, readZipEntry } from "src/import-export/zip-directory";

const text = (value: string) => new TextEncoder().encode(value);

/** Every file of an archive, read through its directory. */
function readAll(archive: Uint8Array): Record<string, Uint8Array> {
    const files: Record<string, Uint8Array> = {};
    for (const [name, entry] of readZipDirectory(archive))
        files[name] = readZipEntry(archive, entry);
    return files;
}

/** Little-endian bytes for a zip record. */
class Bytes {
    data: number[] = [];

    int(size: number, value: number): this {
        for (let index = 0; index < size; index++) {
            this.data.push(Math.floor(value / 256 ** index) % 256);
        }
        return this;
    }

    raw(bytes: Uint8Array | number[]): this {
        this.data.push(...bytes);
        return this;
    }
}

/**
 * A stored archive in the zip64 form, which archives with more than 65535 files or of more than 4 GB need: zip64 end
 * records, and every size and offset in the zip64 extra field of the directory.
 */
function zip64Archive(files: Record<string, Uint8Array>): Uint8Array {
    const out = new Bytes();
    const directory = new Bytes();
    for (const [name, data] of Object.entries(files)) {
        const offset = out.data.length;
        const nameBytes = text(name);
        // Local header: signature, version, flags (UTF-8 name), stored, time and date, crc, sizes, name, extra
        out.int(4, 0x04034b50).int(2, 45).int(2, 0x800).int(2, 0).int(4, 0).int(4, 0);
        out.int(4, data.length).int(4, data.length).int(2, nameBytes.length).int(2, 0);
        out.raw(nameBytes).raw(data);
        // Directory entry: as the local header, then comment length, disk, attributes and offset; then the zip64 field
        directory.int(4, 0x02014b50).int(2, 45).int(2, 45).int(2, 0x800).int(2, 0).int(4, 0);
        directory.int(4, 0).int(4, 0xffffffff).int(4, 0xffffffff).int(2, nameBytes.length);
        directory.int(2, 28).int(2, 0).int(2, 0).int(2, 0).int(4, 0).int(4, 0xffffffff);
        directory.raw(nameBytes);
        directory.int(2, 1).int(2, 24).int(8, data.length).int(8, data.length).int(8, offset);
    }
    const count = Object.keys(files).length;
    const directoryOffset = out.data.length;
    out.raw(directory.data);
    const zip64End = out.data.length;
    out.int(4, 0x06064b50).int(8, 44).int(2, 45).int(2, 45).int(4, 0).int(4, 0);
    out.int(8, count).int(8, count).int(8, directory.data.length).int(8, directoryOffset);
    out.int(4, 0x07064b50).int(4, 0).int(8, zip64End).int(4, 1);
    out.int(4, 0x06054b50).int(2, 0).int(2, 0).int(2, 0xffff).int(2, 0xffff);
    out.int(4, 0xffffffff).int(4, 0xffffffff).int(2, 0);
    return new Uint8Array(out.data);
}

describe("readZipDirectory and readZipEntry", () => {
    const files = {
        "collection.anki21b": text("x".repeat(1000)),
        media: new Uint8Array([1, 2, 3]),
        "0": new Uint8Array(0),
        "café ✓.png": new Uint8Array([137, 80, 78, 71]),
    };

    test("read stored and deflated files, with any name, as fflate writes them", () => {
        const archive = zipSync({
            "collection.anki21b": [files["collection.anki21b"], { level: 9 }],
            media: [files.media, { level: 0, comment: "the index" }],
            "0": files["0"],
            "café ✓.png": files["café ✓.png"],
        });
        const directory = readZipDirectory(archive);
        expect([...directory.keys()]).toEqual(Object.keys(files));
        expect(directory.get("collection.anki21b")?.compression).toBe(8);
        expect(directory.get("media")?.compression).toBe(0);
        expect(readAll(archive)).toEqual(files);
    });

    test("read an archive in the zip64 form", () => {
        const archive = zip64Archive(files);
        // fflate reads it the same way
        expect(unzipSync(archive)).toEqual(files);
        expect(readZipDirectory(archive).get("media")).toMatchObject({
            compression: 0,
            size: 3,
            compressedSize: 3,
        });
        expect(readAll(archive)).toEqual(files);
    });

    test("give a copy of a stored file, not a view into the archive", () => {
        const archive = zipSync({ media: [files.media, { level: 0 }] });
        const read = readZipEntry(archive, readZipDirectory(archive).get("media"));
        expect(read.buffer).not.toBe(archive.buffer);
    });

    test("reject what is not a zip archive", () => {
        expect(() => readZipDirectory(text("hello"))).toThrow();
        expect(() => readZipDirectory(new Uint8Array(70000))).toThrow();
        expect(readZipDirectory(zipSync({})).size).toBe(0);
    });
});
