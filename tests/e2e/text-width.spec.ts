import { expect, test, type Locator, type Page } from "@playwright/test";
import { T } from "../../src/core/geometry";
import { widthOf, type TextStyle } from "../../src/core/text";
import { open, painted, shop } from "./helpers";

// Part sizes, and the editor and the image agreeing on them, are held-out H17 and H87; they compare
// boxes, not the glyphs painted inside them. What stays here is a stricter check: every label,
// sub-line and row is painted no wider than the width its part was measured for, in the editor and
// in the exported image. Linux is where it bites: unless told to draw text at its geometric size,
// Chromium there rounds each glyph's advance to a whole pixel, so a label sized to fit exactly can
// overrun its part (docs/contracts/diagram.md, Geometry).

// Parts as wide as their text needs (compact, panel), with labels whose rounding errors add up:
// narrow letters, a realistic name, and Geist Mono in the compact sub-lines.
const nodes = [
  { id: "thin", label: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiii", kind: "service", form: "compact", sub: "src/lib/io.ts", place: { row: 0, col: 0 } },
  { id: "auth", label: "Authentication Service", kind: "api", form: "compact", sub: "auth/jwt.ts", place: { row: 0, col: 1 } },
  { id: "queue", label: "Message queue worker", kind: "worker", form: "panel", sub: "Reads the repository with the CLI",
    items: ["fill in little lists till it fits", "Archdrawer API gateway"], place: { row: 1, col: 0 } },
  { id: "db", label: "PostgreSQL database", kind: "data", form: "card", sub: "illicit lilt filling", items: [], place: { row: 1, col: 1 } },
].map((n) => ({ icon: null, items: [], description: "A part.", files: [], parent: null, detail: null, ...n }));
const formOf = new Map(nodes.map((n) => [n.id, n.form]));

/** The style measureNode sizes a text with (overview views, not the post style). */
function styleOf(id: string, role: string): TextStyle {
  const form = formOf.get(id);
  if (role === "label") return form === "compact" ? T.compactTitle : T.title;
  if (role === "sub") return form === "compact" ? T.subMono : T.sub;
  return T.item;
}

interface Painted { id: string; role: string; text: string; painted: number; left: number; right: number; boxLeft: number; boxRight: number }

/** Every text line inside a part: its painted advance width and its ink box against the part's box, in drawing units. */
async function paintedTexts(surface: Locator): Promise<Painted[]> {
  return surface.evaluate((root) => Array.from(root.querySelectorAll("g[data-node-id]")).flatMap((g) => {
    const id = g.getAttribute("data-node-id")!;
    const box = (g.querySelector("rect.box") as SVGRectElement).getBBox();
    return Array.from(g.querySelectorAll("text")).filter((t) => t.closest("g[data-node-id]") === g).flatMap((t) => {
      const role = t.classList.contains("label") ? "label" : t.classList.contains("sub") ? "sub" : t.closest(".item, .limit") ? "item" : "other";
      const spans = Array.from(t.querySelectorAll("tspan"));
      const b = t.getBBox();
      return (spans.length ? spans : [t]).map((el) => {
        // A wrapped label's lines end in a space that is not part of the measured line.
        const text = (el.textContent ?? "").trimEnd();
        return { id, role, text, painted: text ? el.getSubStringLength(0, text.length) : 0, left: b.x, right: b.x + b.width, boxLeft: box.x, boxRight: box.x + box.width };
      });
    });
  }));
}

function expectWithinMeasure(texts: Painted[], where: string) {
  const checked = texts.filter((t) => t.role !== "other" && t.text);
  // Every label, sub-line and row of the four parts: 4 labels, 4 sub-lines, 2 rows.
  expect(checked.length, `${where}: texts found`).toBe(10);
  for (const t of checked) {
    const measured = widthOf(t.text, styleOf(t.id, t.role));
    // 0.25 px: positions are kept in 1/64 px and letter-spacing is written to 0.01 px.
    expect.soft(t.painted, `${where}: ${t.id} ${t.role} "${t.text}" painted ${t.painted.toFixed(2)} px, measured ${measured.toFixed(2)} px`)
      .toBeLessThanOrEqual(measured + 0.25);
    expect.soft(t.left, `${where}: ${t.id} ${t.role} "${t.text}" starts inside its part`).toBeGreaterThanOrEqual(t.boxLeft);
    expect.soft(t.right, `${where}: ${t.id} ${t.role} "${t.text}" ends inside its part`).toBeLessThanOrEqual(t.boxRight);
  }
}

async function fullDetail(page: Page) {
  for (let i = 0; i < 30 && (await page.getByTestId("canvas").getAttribute("data-detail")) !== "full"; i++) await page.getByTestId("zoom-in").click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-detail", "full");
  await painted(page);
}

test("every label is painted no wider than its part was measured for, in the editor and in the image", async ({ page }) => {
  const { id } = await open(page, shop((f) => { f.views[0].nodes = nodes; f.views[0].edges = []; }));
  await fullDetail(page);
  expectWithinMeasure(await paintedTexts(page.locator(".canvas svg.world")), "editor");

  const res = await page.request.get(`/api/diagrams/${id}/export.svg?view=overview&format=readme`);
  expect(res.status()).toBe(200);
  // The image in this page, which has Geist loaded; the SVG brings its own text rendering.
  await page.evaluate((svg) => {
    const host = document.createElement("div");
    host.id = "image-under-test";
    host.style.cssText = "position:fixed;left:-10000px;top:0";
    host.innerHTML = svg;
    document.body.append(host);
  }, await res.text());
  await page.evaluate(() => document.fonts.ready);
  expectWithinMeasure(await paintedTexts(page.locator("#image-under-test > svg")), "image");
});

// A compact part's sub-line is drawn in Geist Mono on the canvas, as in the image and as measureNode
// sizes it: a page style must not replace the font the drawing names (editor/export drift).
test("a compact part's sub-line is painted in Geist Mono on the canvas, at the image's width", async ({ page }) => {
  const wide = { id: "wide", label: "Gateway", kind: "api", form: "compact", sub: "WWWWWWWWWWWW", place: { row: 0, col: 0 } };
  const { id } = await open(page, shop((f) => { f.views[0].nodes = [{ icon: null, items: [], description: "A part.", files: [], parent: null, detail: null, ...wide }]; f.views[0].edges = []; }));
  await fullDetail(page);
  const sub = (root: string) => page.evaluate((root) => {
    const t = document.querySelector(`${root} [data-node-id="wide"] text.sub`) as SVGTextElement;
    return { font: getComputedStyle(t).fontFamily, width: t.getComputedTextLength() };
  }, root);
  const canvas = await sub(".canvas svg.world");
  const res = await page.request.get(`/api/diagrams/${id}/export.svg?view=overview&format=readme`);
  await page.evaluate((svg) => {
    const host = document.createElement("div");
    host.id = "image-under-test";
    host.style.cssText = "position:fixed;left:-10000px;top:0";
    host.innerHTML = svg;
    document.body.append(host);
  }, await res.text());
  await page.evaluate(() => document.fonts.ready);
  const image = await sub("#image-under-test > svg");
  expect(canvas.font).toMatch(/^"?Geist Mono"?/);
  expect(image.font).toMatch(/^"?Geist Mono"?/);
  expect(Math.abs(canvas.width - image.width)).toBeLessThan(0.5);
  expect(canvas.width).toBeLessThanOrEqual(widthOf("WWWWWWWWWWWW", T.subMono) + 0.25);
});
