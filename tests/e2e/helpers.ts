import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagramDocument } from "../../src/core/model";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function token(request: APIRequestContext): Promise<string> {
  const html = await (await request.get("/")).text();
  const t = /name="archdraw-token" content="([^"]+)"/.exec(html)?.[1];
  expect(t).toBeTruthy();
  return t!;
}

/** The minimal example file (examples/shop.archdraw.json), optionally changed. */
export function shop(change: (f: Record<string, any>) => void = () => {}): Record<string, any> {
  const f = JSON.parse(readFileSync(join(root, "examples", "shop.archdraw.json"), "utf8"));
  change(f);
  return f;
}

/** A repository folder holding the drawing file; returns the file's path. */
export function repoWith(file: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "archdraw-e2e-src-"));
  for (const [rel, body] of Object.entries({ ".git/HEAD": "ref: refs/heads/main\n", "web/index.html": "<main></main>\n", "src/api.ts": "//\n" })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const path = join(dir, "architecture.archdraw.json");
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}

/** Register a drawing file with the server (as `archdrawer open` does) and go to its editor. */
export async function open(page: Page, file: Record<string, unknown> = shop()): Promise<{ id: string; path: string }> {
  const path = repoWith(file);
  const res = await page.request.post("/api/files", { headers: { "X-Archdraw-Token": await token(page.request) }, data: { path } });
  expect(res.status()).toBe(200);
  const { id } = await res.json();
  await page.goto(`/d/${id}`);
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  return { id, path };
}

export const onDisk = (path: string): DiagramDocument => JSON.parse(readFileSync(path, "utf8"));

/** Wait until the file satisfies `ok` and the editor says Saved. */
export async function savedWhen(page: Page, path: string, ok: (d: DiagramDocument) => boolean): Promise<DiagramDocument> {
  await expect.poll(() => ok(onDisk(path)), { intervals: [100, 200, 300], timeout: 8000 }).toBe(true);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  return onDisk(path);
}

export async function zoom(page: Page): Promise<number> {
  return Number((await page.getByTestId("zoom-level").textContent())!.replace("%", "")) / 100;
}

/** Wait until the last change is painted (Playwright reads boxes from the painted frame). */
export const painted = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Centre of an element in page coordinates. */
export async function centre(l: Locator): Promise<{ x: number; y: number }> {
  await painted(l.page());
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}
