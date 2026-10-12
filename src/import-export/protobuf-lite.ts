/**
 * A reader for the few protobuf messages of an Anki package that ankipack does not expose: the media index, and the
 * kind and card templates of a note type. Only the top level of a message is read, which is all these need.
 */

export interface ProtoField {
    field: number;
    /** Varint fields hold their number here, length-delimited fields (strings, bytes, messages) their bytes. */
    value: number | Uint8Array;
}

/** Reads the fields of a message. Fixed-width fields are skipped. Reading stops quietly at damaged data. */
export function readProtoFields(bytes: Uint8Array): ProtoField[] {
    const fields: ProtoField[] = [];
    let offset = 0;

    const readVarint = (): number | null => {
        let result = 0;
        let scale = 1;
        while (offset < bytes.length) {
            const byte = bytes[offset++];
            result += (byte & 0x7f) * scale;
            if ((byte & 0x80) === 0) return result;
            scale *= 128;
        }
        return null;
    };

    while (offset < bytes.length) {
        const tag = readVarint();
        if (tag === null) break;
        const field = Math.floor(tag / 8);
        const wireType = tag % 8;

        if (wireType === 0) {
            const value = readVarint();
            if (value === null) break;
            fields.push({ field, value });
        } else if (wireType === 2) {
            const length = readVarint();
            if (length === null || offset + length > bytes.length) break;
            fields.push({ field, value: bytes.subarray(offset, offset + length) });
            offset += length;
        } else if (wireType === 1) {
            offset += 8;
        } else if (wireType === 5) {
            offset += 4;
        } else {
            break;
        }
    }
    return fields;
}

const utf8 = new TextDecoder();

/** The text of the first string field with this number, or an empty string. */
export function protoString(fields: ProtoField[], field: number): string {
    const found = fields.find((item) => item.field === field && typeof item.value !== "number");
    return found === undefined ? "" : utf8.decode(found.value as Uint8Array);
}

/** The number of the first varint field with this number, or 0 (protobuf leaves out zero values). */
export function protoNumber(fields: ProtoField[], field: number): number {
    const found = fields.find((item) => item.field === field && typeof item.value === "number");
    return found === undefined ? 0 : (found.value as number);
}
