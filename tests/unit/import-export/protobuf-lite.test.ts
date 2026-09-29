/**
 * @jest-environment node
 */
import { protoNumber, protoString, readProtoFields } from "src/import-export/protobuf-lite";

describe("readProtoFields", () => {
    test("reads varints, strings and nested messages", () => {
        // field 1 = varint 1, field 2 = "hi", field 3 = message { field 1 = "x" }, field 4 = varint 300
        const bytes = new Uint8Array([
            0x08, 0x01, 0x12, 0x02, 0x68, 0x69, 0x1a, 0x03, 0x0a, 0x01, 0x78, 0x20, 0xac, 0x02,
        ]);
        const fields = readProtoFields(bytes);
        expect(protoNumber(fields, 1)).toBe(1);
        expect(protoString(fields, 2)).toBe("hi");
        expect(protoNumber(fields, 4)).toBe(300);
        const nested = fields.find((field) => field.field === 3)?.value as Uint8Array;
        expect(protoString(readProtoFields(nested), 1)).toBe("x");
    });

    test("returns zero and an empty string for missing fields", () => {
        expect(protoNumber([], 1)).toBe(0);
        expect(protoString([], 1)).toBe("");
        expect(readProtoFields(new Uint8Array())).toEqual([]);
    });

    test("skips fixed width fields", () => {
        // field 1 = fixed32, field 2 = fixed64, field 3 = varint 7
        const bytes = new Uint8Array([0x0d, 1, 2, 3, 4, 0x11, 1, 2, 3, 4, 5, 6, 7, 8, 0x18, 0x07]);
        expect(readProtoFields(bytes)).toEqual([{ field: 3, value: 7 }]);
    });

    test("stops at damaged data instead of throwing", () => {
        expect(readProtoFields(new Uint8Array([0x0a, 0x05, 0x41]))).toEqual([]);
        expect(readProtoFields(new Uint8Array([0x08]))).toEqual([]);
        expect(readProtoFields(new Uint8Array([0x0b]))).toEqual([]);
        expect(readProtoFields(new Uint8Array([0x80]))).toEqual([]);
    });
});
