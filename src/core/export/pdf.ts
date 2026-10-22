/**
 * The slides as a PDF (PRES-3, ADR 0012): one 960 × 540 pt page per JPEG, the image drawn over the
 * whole page. Objects are uncompressed and every byte outside the JPEG streams is ASCII, so the file
 * reads as Latin-1 text (testing contract, *slide downloads*). Pure and byte-deterministic: no date,
 * no id, no producer.
 */

export interface JpegPage {
  /** A baseline or progressive JPEG, as the browser's canvas writes it. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG; must match its frame header. */
  width: number;
  height: number;
}

/** The page box in points: 13.333 × 7.5 in, the common 16:9 slide. */
export const PAGE = { width: 960, height: 540 } as const;

/** Colour spaces by the frame header's component count. */
const COLOR_SPACES: Record<number, string> = { 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" };

/** Start-of-frame markers: C0–CF except DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** The frame header of a JPEG: its size and component count, or an error naming what is wrong. */
export function jpegFrame(jpeg: Uint8Array): { width: number; height: number; components: number } | string {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return "does not start with the JPEG marker FF D8";
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return `has no marker at byte ${at}`;
    const marker = jpeg[at + 1];
    if (marker === 0xff) { at += 1; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) break; // end of image or start of scan before any frame
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; } // no length
    const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
    if (length < 2 || at + 2 + length > jpeg.length) return `has a segment running past its end at byte ${at}`;
    if (isFrame(marker)) {
      if (length < 8) return "has a frame header too short to read";
      return { height: (jpeg[at + 5] << 8) | jpeg[at + 6], width: (jpeg[at + 7] << 8) | jpeg[at + 8], components: jpeg[at + 9] };
    }
    at += 2 + length;
  }
  return "has no frame header";
}

/** Bytes of an ASCII string. Every string written here is ASCII, so this is also its Latin-1 encoding. */
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * One PDF 1.4 page per JPEG, in order: a catalog (1), the page tree (2) and per page its page object, its
 * image XObject (`/Filter /DCTDecode`, the JPEG as it is) and a content stream that scales the image
 * over the page; then a classic cross-reference table and trailer. Throws a `RangeError` for no pages, a
 * size that is not a positive whole number, or a JPEG whose frame header is missing, unreadable, of
 * another size or of an unsupported component count.
 */
export function jpegPagesToPdf(pages: readonly JpegPage[]): Uint8Array {
  if (pages.length === 0) throw new RangeError("A PDF needs at least one page.");
  const spaces = pages.map((p, i) => {
    if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 1 || p.height < 1)
      throw new RangeError(`Page ${i + 1}: the size ${p.width} × ${p.height} is not a positive whole number of pixels.`);
    const frame = jpegFrame(p.jpeg);
    if (typeof frame === "string") throw new RangeError(`Page ${i + 1}: the image ${frame}.`);
    if (frame.width !== p.width || frame.height !== p.height)
      throw new RangeError(`Page ${i + 1}: the image is ${frame.width} × ${frame.height}, not ${p.width} × ${p.height}.`);
    const space = COLOR_SPACES[frame.components];
    if (!space) throw new RangeError(`Page ${i + 1}: an image of ${frame.components} components is not supported.`);
    return space;
  });

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const put = (b: Uint8Array) => { chunks.push(b); length += b.length; };
  const object = (n: number, dict: string, stream?: Uint8Array) => {
    offsets[n] = length;
    put(ascii(`${n} 0 obj\n${dict}\n`));
    if (stream) { put(ascii("stream\n")); put(stream); put(ascii("\nendstream\n")); }
    put(ascii("endobj\n"));
  };
  const pageObject = (i: number) => 3 + i * 3;

  // The second line's bytes above 127 mark the file as binary for tools that guess (PDF 1.4, 3.4.1).
  put(ascii("%PDF-1.4\n"));
  put(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const draw = ascii(`q ${PAGE.width} 0 0 ${PAGE.height} 0 0 cm /Im0 Do Q`);
  pages.forEach((p, i) => {
    const page = pageObject(i), image = page + 1, contents = page + 2;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
    object(image, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace ${spaces[i]} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    object(contents, `<< /Length ${draw.length} >>`, draw);
  });

  // Each cross-reference entry is exactly 20 bytes, its end of line a space and a line feed.
  const size = pageObject(pages.length), xref = length;
  put(ascii(`xref\n0 ${size}\n0000000000 65535 f \n`));
  for (let n = 1; n < size; n++) put(ascii(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`));
  put(ascii(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
