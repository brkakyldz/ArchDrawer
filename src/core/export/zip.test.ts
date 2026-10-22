import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, storedZip } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (s: string) => Uint8Array.from(s.replace(/\s+|\|/g, "").match(/../g)!.map((b) => parseInt(b, 16)));

/** The central directory as a reader sees it: from the end record, independent of how the writer counts. */
function centralDirectory(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  expect(v.getUint16(end + 8, true)).toBe(count);
  expect(start + size).toBe(end);
  const out: { name: string; method: number; flags: number; crc: number; compressed: number; size: number; offset: number }[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
      flags: v.getUint16(at + 8, true), method: v.getUint16(at + 10, true), crc: v.getUint32(at + 16, true),
      compressed: v.getUint32(at + 20, true), size: v.getUint32(at + 24, true), offset: v.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extra + comment;
  }
  expect(at).toBe(end);
  return out;
}

describe("crc32", () => {
  it("gives the standard check value and agrees with zlib", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) & 0xff);
    expect(crc32(data)).toBe(zlibCrc32(data));
  });
});

describe("storedZip", () => {
  it("writes a known small zip byte for byte", () => {
    // Written from APPNOTE §4.3, not from the writer: "a.txt" = "abc" (CRC 352441C2) and an empty "ç.txt".
    const expected = hex(`
      504b0304 1400 0008 0000 0000 2100 c2412435 03000000 03000000 0500 0000 612e747874 616263
      504b0304 1400 0008 0000 0000 2100 00000000 00000000 00000000 0600 0000 c3a72e747874
      504b0102 1400 1400 0008 0000 0000 2100 c2412435 03000000 03000000 0500 0000 0000 0000 0000 00000000 00000000 612e747874
      504b0102 1400 1400 0008 0000 0000 2100 00000000 00000000 00000000 0600 0000 0000 0000 0000 00000000 26000000 c3a72e747874
      504b0506 0000 0000 0200 0200 67000000 4a000000 0000
    `);
    expect(storedZip([{ name: "a.txt", data: bytes("abc") }, { name: "ç.txt", data: new Uint8Array() }])).toEqual(expected);
  });

  it("lists every entry in the central directory, in order, stored with its CRC and size", () => {
    const png = (n: number) => Uint8Array.from({ length: 300 + n * 97 }, (_, i) => (i * 31 + n) & 0xff);
    const entries = [0, 1, 2, 3].map((n) => ({ name: `shop-slide-${String(n).padStart(2, "0")}.png`, data: png(n) }));
    const zip = storedZip(entries);
    const listed = centralDirectory(zip);
    expect(listed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    listed.forEach((e, i) => {
      const data = entries[i].data;
      expect(e).toMatchObject({ method: 0, flags: 0x0800, crc: zlibCrc32(data), compressed: data.length, size: data.length });
      // The local header agrees and is followed by the bytes as they are.
      expect(v.getUint32(e.offset, true)).toBe(0x04034b50);
      expect(v.getUint32(e.offset + 14, true)).toBe(zlibCrc32(data));
      const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
      expect(zip.subarray(start, start + data.length)).toEqual(data);
    });
  });

  it("is byte-deterministic: same entries, same bytes, dated 1980-01-01", () => {
    const entries = [{ name: "x.png", data: bytes("one") }, { name: "y.png", data: bytes("two") }];
    const a = storedZip(entries), b = storedZip(entries);
    expect(a).toEqual(b);
    const v = new DataView(a.buffer);
    expect(v.getUint16(10, true)).toBe(0); // time
    expect(v.getUint16(12, true)).toBe(0x21); // 1980-01-01
  });

  it("writes an empty archive as a lone end record", () => {
    expect(storedZip([])).toEqual(hex("504b0506 0000 0000 0000 0000 00000000 00000000 0000"));
  });

  it("refuses names a reader would misplace or merge", () => {
    const data = bytes("x");
    expect(() => storedZip([{ name: "", data }])).toThrow(RangeError);
    expect(() => storedZip([{ name: "/abs.png", data }])).toThrow(RangeError);
    expect(() => storedZip([{ name: "a\\b.png", data }])).toThrow(RangeError);
    expect(() => storedZip([{ name: "a.png", data }, { name: "a.png", data }])).toThrow(/twice/);
    expect(() => storedZip(Array.from({ length: 0x10000 }, (_, i) => ({ name: `${i}`, data })))).toThrow(/65535/);
  });
});
