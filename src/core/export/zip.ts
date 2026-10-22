/**
 * The PNG slides as one zip (PRES-3, ADR 0012). Every entry is stored (method 0), so each local
 * header is followed by the file's bytes as they are; names are UTF-8 (flag bit 11) and every entry
 * carries the date 1980-01-01 00:00, so the same entries always give the same bytes. No Zip64: at most
 * 65 535 entries and 4 GiB in all, far beyond 21 slides. Layout per APPNOTE 6.3.x §4.3.
 */

export interface ZipEntry {
  /** The path inside the archive, `/`-separated. */
  name: string;
  data: Uint8Array;
}

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
/** Version 2.0: the version most writers state, enough for a stored entry. */
const VERSION = 20;
/** Bit 11: the name is UTF-8. */
const UTF8 = 0x0800;
/** MS-DOS date of 1980-01-01 (year − 1980 << 9 | month << 5 | day); the time is 00:00:00, 0. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

let table: Uint32Array | undefined;
/** CRC-32 (ISO 3309, reflected polynomial EDB88320), as zip and PNG use it. */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip of the entries in order: per entry a local header, its name and its bytes; then the central
 * directory and the end record. Throws a `RangeError` for an empty, absolute, backslashed or repeated
 * name, a name over 65 535 bytes, more than 65 535 entries, or an archive past 4 GiB.
 */
export function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new RangeError(`A zip without Zip64 holds at most 65535 entries, not ${entries.length}.`);
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const named = entries.map(({ name, data }) => {
    if (!name || name.startsWith("/") || name.includes("\\")) throw new RangeError(`"${name}" is not a relative, /-separated entry name.`);
    if (seen.has(name)) throw new RangeError(`The entry "${name}" is listed twice.`);
    seen.add(name);
    const bytes = encoder.encode(name);
    if (bytes.length > 0xffff) throw new RangeError(`The entry name "${name.slice(0, 40)}…" is longer than 65535 bytes.`);
    return { name: bytes, data, crc: crc32(data) };
  });

  const localSize = named.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = named.reduce((s, e) => s + 46 + e.name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new RangeError("A zip without Zip64 is at most 4 GiB.");

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const u16 = (at: number, v: number) => view.setUint16(at, v, true);
  const u32 = (at: number, v: number) => view.setUint32(at, v, true);

  // Fields both headers share, from "version needed" to the name length (local offset 4, central 6).
  const common = (at: number, e: (typeof named)[number]) => {
    u16(at, VERSION);
    u16(at + 2, UTF8);
    u16(at + 4, 0); // stored
    u16(at + 6, 0); // time 00:00:00
    u16(at + 8, DOS_DATE);
    u32(at + 10, e.crc);
    u32(at + 14, e.data.length); // compressed size
    u32(at + 18, e.data.length); // uncompressed size
    u16(at + 22, e.name.length);
  };

  const offsets: number[] = [];
  let at = 0;
  for (const e of named) {
    offsets.push(at);
    u32(at, LOCAL);
    common(at + 4, e);
    u16(at + 28, 0); // extra field length
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }

  named.forEach((e, i) => {
    u32(at, CENTRAL);
    u16(at + 4, VERSION); // made by: MS-DOS (high byte 0), 2.0
    common(at + 6, e);
    // Extra and comment lengths, disk number, internal and external attributes stay 0.
    u32(at + 42, offsets[i]);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  });

  u32(at, END);
  // Disk numbers stay 0.
  u16(at + 8, named.length);
  u16(at + 10, named.length);
  u32(at + 12, centralSize);
  u32(at + 16, localSize);
  // Comment length stays 0.
  return out;
}
