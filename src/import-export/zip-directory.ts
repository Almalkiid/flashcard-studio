/**
 * A reader for the central directory of a zip archive, so that files can be taken out of it one at a time. fflate's
 * `unzipSync` goes through every file of the archive on each call, so taking out the files of a package one by one
 * with it takes time in the square of their number.
 */
import { inflateSync, strFromU8 } from "fflate";

/** Where a file is in the archive and how it is stored. */
export interface ZipEntry {
    /** 0 for stored, 8 for deflated. */
    compression: number;
    compressedSize: number;
    size: number;
    /** Where the file's local header starts. */
    headerOffset: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
/** A 32 bit size or offset with this value is in the zip64 extra field instead. */
const IN_ZIP64_FIELD = 0xffffffff;

const u16 = (data: Uint8Array, at: number): number => data[at] | (data[at + 1] << 8);
const u32 = (data: Uint8Array, at: number): number =>
    (u16(data, at) | (u16(data, at + 2) << 16)) >>> 0;
const u64 = (data: Uint8Array, at: number): number => u32(data, at) + u32(data, at + 4) * 2 ** 32;

/** The archive's files by name, read in one pass over the central directory. Throws when the data is not a zip. */
export function readZipDirectory(data: Uint8Array): Map<string, ZipEntry> {
    // The 22 byte end record is last, followed only by a comment of up to 65535 bytes
    const earliest = Math.max(0, data.length - 22 - 65535);
    let end = data.length - 22;
    while (end >= earliest && u32(data, end) !== END_OF_DIRECTORY) end--;
    if (end < earliest) throw new Error("Not a zip archive");

    let count = u16(data, end + 10);
    let offset = u32(data, end + 16);
    if (end >= 20 && u32(data, end - 20) === ZIP64_LOCATOR) {
        const record = u64(data, end - 12);
        if (u32(data, record) === ZIP64_END_OF_DIRECTORY) {
            count = u64(data, record + 32);
            offset = u64(data, record + 48);
        }
    }

    const entries = new Map<string, ZipEntry>();
    for (let index = 0; index < count; index++) {
        if (offset + 46 > data.length) throw new Error("Damaged zip central directory");
        const nameLength = u16(data, offset + 28);
        const extraLength = u16(data, offset + 30);
        const commentLength = u16(data, offset + 32);
        const nameStart = offset + 46;
        const extraStart = nameStart + nameLength;
        // Bit 11 marks a UTF-8 name, other names are CP437, read as Latin-1 like fflate does
        const utf8 = (u16(data, offset + 8) & 0x800) !== 0;
        const entry: ZipEntry = {
            compression: u16(data, offset + 10),
            compressedSize: u32(data, offset + 20),
            size: u32(data, offset + 24),
            headerOffset: u32(data, offset + 42),
        };
        for (let at = extraStart; at + 4 <= extraStart + extraLength; at += 4 + u16(data, at + 2)) {
            if (u16(data, at) !== 1) continue;
            // The zip64 field has the values that do not fit in 32 bits, in this order
            let field = at + 4;
            for (const key of ["size", "compressedSize", "headerOffset"] as const) {
                if (entry[key] !== IN_ZIP64_FIELD) continue;
                entry[key] = u64(data, field);
                field += 8;
            }
            break;
        }
        entries.set(strFromU8(data.subarray(nameStart, extraStart), !utf8), entry);
        offset = extraStart + extraLength + commentLength;
    }
    return entries;
}

/** Takes one file out of the archive. */
export function readZipEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
    const header = entry.headerOffset;
    const start = header + 30 + u16(data, header + 26) + u16(data, header + 28);
    const stored = data.subarray(start, start + entry.compressedSize);
    if (entry.compression === 0) return stored.slice();
    if (entry.compression === 8) return inflateSync(stored, { out: new Uint8Array(entry.size) });
    throw new Error(`Unknown zip compression ${entry.compression}`);
}
