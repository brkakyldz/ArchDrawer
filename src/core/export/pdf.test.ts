import { describe, expect, it } from "vitest";
import { jpegFrame, jpegPagesToPdf, type JpegPage } from "./pdf";

/**
 * A JPEG as far as the writer reads it: SOI, an APP0 segment, a frame header of the given size and
 * components, a body and EOI. Its pixels are never decoded here.
 */
function jpeg(width: number, height: number, { components = 3, sof = 0xc0, tag = 0 } = {}): Uint8Array {
  const frame = [0xff, sof, 0, 8 + components * 3, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 1; c <= components; c++) frame.push(c, 0x11, 0);
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46, ...frame, 0xff, 0xda, tag, 1, 2, 3, 0xff, 0xd9);
}
const slide = (tag: number): JpegPage => ({ jpeg: jpeg(3840, 2160, { tag }), width: 3840, height: 2160 });
const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

/** The objects of an uncompressed PDF by number, each with its dictionary and its stream bytes. */
function objects(pdf: Uint8Array) {
  const text = latin1(pdf);
  const out = new Map<number, { at: number; dict: string; stream?: Uint8Array }>();
  for (const m of text.matchAll(/(\d+) 0 obj\n(<<.*>>)\n(stream\n)?/g)) {
    const at = m.index!, dict = m[2];
    let stream: Uint8Array | undefined;
    if (m[3]) {
      const start = at + m[0].length, length = Number(/\/Length (\d+)/.exec(dict)![1]);
      stream = pdf.subarray(start, start + length);
      expect(text.slice(start + length, start + length + 10)).toBe("\nendstream");
    }
    out.set(Number(m[1]), { at, dict, stream });
  }
  return out;
}

describe("jpegPagesToPdf", () => {
  const three = [slide(1), slide(2), slide(3)];

  it("is a PDF 1.4 file from %PDF-1.4 to %%EOF", () => {
    const text = latin1(jpegPagesToPdf(three));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF")).toBe(true);
    // The binary comment's bytes are each above 127, not UTF-8 pairs.
    expect([...jpegPagesToPdf(three).subarray(9, 15)]).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  });

  it("has one page tree whose /Count is the number of page objects, each 960 × 540 pt", () => {
    const text = latin1(jpegPagesToPdf(three));
    expect(text.match(/\/Type \/Pages\b/g)).toHaveLength(1);
    expect(/\/Type \/Pages [^>]*\/Count (\d+)/.exec(text)![1]).toBe("3");
    const pages = [...text.matchAll(/\/Type \/Page(?!s)[^\n]*/g)].map((m) => m[0]);
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(p).toContain("/MediaBox [0 0 960 540]");
  });

  it("draws one DCTDecode image per page over the whole page, the JPEGs as given and in order", () => {
    const pdf = jpegPagesToPdf(three);
    const objs = objects(pdf);
    const kids = /\/Kids \[([^\]]*)\]/.exec(objs.get(2)!.dict)![1].match(/\d+(?= 0 R)/g)!.map(Number);
    expect(kids).toHaveLength(3);
    kids.forEach((k, i) => {
      const page = objs.get(k)!.dict;
      expect(page).toMatch(/\/Type \/Page(?!s)/);
      const images = [...page.matchAll(/\/Im\d+ (\d+) 0 R/g)].map((m) => Number(m[1]));
      expect(images).toHaveLength(1);
      const image = objs.get(images[0])!;
      expect(image.dict).toContain("/Subtype /Image");
      expect(image.dict).toContain("/Width 3840 /Height 2160");
      expect(image.dict).toContain("/Filter /DCTDecode");
      expect(image.dict).toContain("/ColorSpace /DeviceRGB");
      expect([...image.stream!.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(image.stream).toEqual(three[i].jpeg);
      const contents = objs.get(Number(/\/Contents (\d+) 0 R/.exec(page)![1]))!;
      expect(latin1(contents.stream!)).toBe("q 960 0 0 540 0 0 cm /Im0 Do Q");
    });
  });

  it("has a cross-reference table whose offsets point at their objects", () => {
    const pdf = jpegPagesToPdf(three);
    const text = latin1(pdf);
    const startxref = Number(/startxref\n(\d+)\n%%EOF$/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
    const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref))!.map(Number);
    expect(first).toBe(0);
    expect(count).toBe(1 + 2 + 3 * 3); // the free entry 0, catalog, page tree, three objects per page
    expect(/\/Size (\d+)/.exec(text.slice(startxref))![1]).toBe(String(count));
    const table = text.slice(startxref + `xref\n0 ${count}\n`.length, startxref + `xref\n0 ${count}\n`.length + 20 * count);
    const rows = table.match(/.{20}/gs)!;
    expect(rows[0]).toBe("0000000000 65535 f \n");
    rows.slice(1).forEach((row, i) => {
      expect(row).toMatch(/^\d{10} 00000 n \n$/);
      const at = Number(row.slice(0, 10));
      expect(text.slice(at, at + `${i + 1} 0 obj\n`.length)).toBe(`${i + 1} 0 obj\n`);
    });
    expect(objects(pdf).size).toBe(count - 1);
  });

  it("is byte-deterministic", () => {
    expect(jpegPagesToPdf(three)).toEqual(jpegPagesToPdf([slide(1), slide(2), slide(3)]));
  });

  it("takes the colour space from the JPEG's components and reads a progressive frame", () => {
    const gray = { jpeg: jpeg(40, 20, { components: 1, sof: 0xc2 }), width: 40, height: 20 };
    const cmyk = { jpeg: jpeg(40, 20, { components: 4 }), width: 40, height: 20 };
    const text = latin1(jpegPagesToPdf([gray, cmyk]));
    expect(text).toContain("/Width 40 /Height 20 /ColorSpace /DeviceGray");
    expect(text).toContain("/Width 40 /Height 20 /ColorSpace /DeviceCMYK");
  });

  it("refuses no pages, a size that is not whole, and a JPEG that is not the size it claims", () => {
    expect(() => jpegPagesToPdf([])).toThrow(RangeError);
    expect(() => jpegPagesToPdf([{ ...slide(1), width: 3840.5 }])).toThrow(/whole number/);
    expect(() => jpegPagesToPdf([{ ...slide(1), height: 1080 }])).toThrow(/3840 × 2160, not 3840 × 1080/);
    expect(() => jpegPagesToPdf([{ jpeg: Uint8Array.of(0x89, 0x50, 0x4e, 0x47), width: 1, height: 1 }])).toThrow(/FF D8/);
    expect(() => jpegPagesToPdf([{ jpeg: jpeg(10, 10, { components: 2 }), width: 10, height: 10 }])).toThrow(/2 components/);
  });
});

describe("jpegFrame", () => {
  it("skips fill bytes and segments before the frame", () => {
    const j = jpeg(1920, 1080);
    expect(jpegFrame(Uint8Array.of(...j.subarray(0, 2), 0xff, ...j.subarray(2)))).toEqual({ width: 1920, height: 1080, components: 3 });
  });

  it("names what is wrong with a file it cannot read", () => {
    expect(jpegFrame(Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9))).toBe("has no frame header");
    expect(jpegFrame(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 50, 0, 0))).toMatch(/past its end/);
    expect(jpegFrame(Uint8Array.of(0xff, 0xd8, 0x00, 0x00, 0, 0))).toMatch(/no marker at byte 2/);
  });
});
