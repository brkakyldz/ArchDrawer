/**
 * The scan's pure parts (docs/contracts/api.md, *Scans*; ADR 0007): choosing its inputs from a
 * listing, fitting them in the budget, the answer's schema and its checks. Reading files, running
 * `git` and the engine call are the server's. Pure (invariant 4).
 */

/** Folders a walk skips when the folder is not in git. */
export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", "coverage", ".next", ".venv", "venv", "__pycache__"]);
export const SCAN_BUDGET = { total: 120_000, listing: 2000, readme: 12_000, dep: 8000, deps: 10, entry: 4000, entries: 12 } as const;
export const SCAN_TYPES = ["agent", "backend", "fullstack", "other"] as const;
export const FOCUS_KINDS = ["flow", "mechanism", "overview"] as const;
export type ScanType = (typeof SCAN_TYPES)[number];
export type FocusKind = (typeof FOCUS_KINDS)[number];

export interface RepoCard { name: string; sentence: string; type: ScanType; languages: string[]; entryPoints: string[] }
export interface FocusOption { id: string; kind: FocusKind; title: string; sentence: string; files: string[] }

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const depth = (p: string) => p.split("/").length;
const shallowFirst = (a: string, b: string) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0);
/** Paths of the listing inside the folder (`""` is the root), relative to the folder, with their depth. */
const inside = (listing: readonly string[], folder: string) => {
  const pre = folder ? `${folder.replace(/\/+$/, "")}/` : "";
  return listing.filter((p) => p.startsWith(pre)).map((p) => ({ path: p, rel: p.slice(pre.length) }));
};

const README = /^readme(\.(md|rst|txt))?$/i;
const DEPS = /^(package\.json|pyproject\.toml|requirements[^/]*\.txt|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle|build\.gradle\.kts|Gemfile|composer\.json|[^/]+\.csproj)$/;
const ENTRY = /^(main|index|app|server|cli)\.[^/.]+$|^__main__\.py$|^manage\.py$/;
const README_ORDER = ["readme.md", "readme.rst", "readme.txt", "readme"];

/** The README, the dependency files and the entry-point candidates of the folder, all paths relative to the root. */
export function pickInputs(listing: readonly string[], folder: string, named: readonly string[] = []): { readme: string | null; deps: string[]; entries: string[] } {
  const all = inside(listing, folder);
  const top = all.filter((f) => !f.rel.includes("/"));
  const readme = top.filter((f) => README.test(f.rel)).sort((a, b) => README_ORDER.indexOf(a.rel.toLowerCase()) - README_ORDER.indexOf(b.rel.toLowerCase()))[0]?.path ?? null;
  const deps = all.filter((f) => depth(f.rel) <= 3 && DEPS.test(base(f.rel))).map((f) => f.path).sort(shallowFirst).slice(0, SCAN_BUDGET.deps);
  const byName = all.filter((f) => ENTRY.test(base(f.rel)) || /^cmd\/[^/]+\/main\.go$/.test(f.rel) || /^bin\/[^/]+$/.test(f.rel) || /(^|\/)cmd\/[^/]+\/main\.go$/.test(f.rel)).map((f) => f.path);
  const listed = new Set(listing);
  const fromDeps = named.filter((p) => listed.has(p));
  const entries = [...new Set([...fromDeps, ...byName.sort(shallowFirst)])].slice(0, SCAN_BUDGET.entries);
  return { readme, deps, entries };
}

/** Paths a dependency file names as entry points: `main`, `bin` and the file `scripts.start` runs (package.json). */
export function namedEntries(depPath: string, text: string): string[] {
  if (base(depPath) !== "package.json") return [];
  try {
    const j = JSON.parse(text) as { main?: unknown; bin?: unknown; scripts?: { start?: unknown } };
    const dir = depPath.includes("/") ? depPath.slice(0, depPath.lastIndexOf("/") + 1) : "";
    const out: string[] = [];
    const add = (p: unknown) => { if (typeof p === "string" && p.trim()) out.push(dir + p.trim().replace(/^\.\//, "")); };
    add(j.main);
    if (typeof j.bin === "string") add(j.bin); else if (j.bin && typeof j.bin === "object") Object.values(j.bin).forEach(add);
    const start = typeof j.scripts?.start === "string" ? /(?:node|tsx|ts-node|bun|deno run)\s+([^\s&|;]+)/.exec(j.scripts.start)?.[1] : undefined;
    add(start);
    return out;
  } catch { return []; }
}

/** An input file: its text as read, and the length the whole file has (when more than was read). */
export interface ScanInput { path: string; text: string; length?: number }
export interface ScanMaterial { listing: string[]; more: number; readme: ScanInput | null; deps: ScanInput[]; entries: ScanInput[] }

/**
 * The inputs as quoted text within the budget, in this order: listing, README, dependency files,
 * entry points. An input that does not fit is cut to what is left, and the cut is marked.
 */
export function scanText(m: ScanMaterial): string {
  let left = SCAN_BUDGET.total;
  const out: string[] = [];
  const put = (head: string, body: string, own: number, whole = body.length) => {
    if (left <= 0) return;
    const room = Math.min(own, left);
    const size = Math.max(whole, body.length);
    const text = size > room ? `${body.slice(0, room)}\n[… cut: ${size - Math.min(room, body.length)} more characters]` : body;
    out.push(`--- ${head} ---\n${text}`);
    left -= Math.min(body.length, room);
  };
  put("Files", m.listing.join("\n") + (m.more ? `\n… ${m.more} more` : ""), SCAN_BUDGET.total);
  if (m.readme) put(`README ${m.readme.path}`, m.readme.text, SCAN_BUDGET.readme, m.readme.length);
  for (const d of m.deps) put(`Dependencies ${d.path}`, d.text, SCAN_BUDGET.dep, d.length);
  for (const e of m.entries) put(`Entry point ${e.path}`, e.text, SCAN_BUDGET.entry, e.length);
  return out.join("\n\n");
}

/** The scan answer's schema, in the strict dialect (api contract, Scans). */
export const SCAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["card", "options"],
  properties: {
    card: {
      type: "object", additionalProperties: false, required: ["name", "sentence", "type", "languages", "entryPoints"],
      properties: {
        name: { type: "string" }, sentence: { type: "string" }, type: { type: "string", enum: [...SCAN_TYPES] },
        languages: { type: "array", items: { type: "string" } }, entryPoints: { type: "array", items: { type: "string" } },
      },
    },
    options: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "title", "sentence", "files"],
        properties: { kind: { type: "string", enum: [...FOCUS_KINDS] }, title: { type: "string" }, sentence: { type: "string" }, files: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;

export class ScanAnswerError extends Error {}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const cut = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t);
const cleanPath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").trim();

/**
 * Check a scan answer (api contract, Scans, Checks). One warning per change. `exists` says whether a
 * root-relative path is a file under the root.
 */
export function checkScan(raw: unknown, o: { folderName: string; exists: (rel: string) => boolean }): { card: RepoCard; options: FocusOption[]; warnings: string[] } {
  const warnings: string[] = [];
  const a = obj(raw), c = obj(a.card);
  if (!a.card || !Array.isArray(a.options)) throw new ScanAnswerError("The engine's scan has no card or no options");
  const long = (t: string, max: number, what: string) => { if (t.length > max) warnings.push(`Shortened ${what} to ${max} characters`); return cut(t, max); };
  let name = text(c.name);
  if (!name) { warnings.push(`The card had no name; named it "${o.folderName}"`); name = o.folderName; }
  name = long(name, 80, "the card's name");
  let sentence = text(c.sentence);
  if (!sentence) { warnings.push("The card had no sentence"); sentence = `The ${o.folderName} project.`; }
  sentence = long(sentence, 200, "the card's sentence");
  let type = text(c.type) as ScanType;
  if (!(SCAN_TYPES as readonly string[]).includes(type)) { warnings.push(`Unknown repository type "${text(c.type)}", taken as other`); type = "other"; }
  const languages: string[] = [];
  for (const l of arr(c.languages).map(text)) {
    if (!l) continue;
    if (languages.length >= 8) { warnings.push("Kept the first 8 languages"); break; }
    languages.push(long(l, 24, `the language "${l}"`));
  }
  const entryPoints: string[] = [];
  for (const p of arr(c.entryPoints).map((x) => cleanPath(text(x)))) {
    if (!p) continue;
    if (!o.exists(p)) { warnings.push(`Dropped the entry point "${p}": not found`); continue; }
    if (entryPoints.includes(p)) continue;
    if (entryPoints.length >= 8) { warnings.push("Kept the first 8 entry points"); break; }
    entryPoints.push(p);
  }

  const options: FocusOption[] = [];
  for (const x of arr(a.options).map(obj)) {
    const title = text(x.title);
    const files = [...new Set(arr(x.files).map((f) => cleanPath(text(f))).filter(Boolean))];
    const missing = files.find((f) => !o.exists(f));
    if (!files.length || missing !== undefined || files.length > 12) {
      warnings.push(`Left out the option "${title || "untitled"}": ${!files.length ? "it names no file" : missing !== undefined ? `"${missing}" does not exist` : "it names more than 12 files"}`);
      continue;
    }
    if (options.length >= 5) { warnings.push(`Left out the option "${title}": at most 5 options`); continue; }
    let kind = text(x.kind) as FocusKind;
    if (!(FOCUS_KINDS as readonly string[]).includes(kind)) { warnings.push(`Unknown focus kind "${text(x.kind)}" for "${title}", taken as flow`); kind = "flow"; }
    const t = title || files[0];
    if (!title) warnings.push(`An option had no title; titled it "${t}"`);
    let said = text(x.sentence);
    if (!said) { warnings.push(`The option "${t}" had no sentence`); said = t; }
    options.push({ id: `o${options.length + 1}`, kind, title: long(t, 80, `the option "${t}"`), sentence: long(said, 200, `the sentence of "${t}"`), files });
  }
  return { card: { name, sentence, type, languages, entryPoints }, options, warnings };
}
