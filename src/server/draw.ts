import { randomBytes } from "node:crypto";
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { joinChannel } from "../core/channels";
import { diffDocuments, type Changes } from "../core/diff";
import { checkEvidence } from "../core/evidence";
import { CHANNELS, fillDefaults3, freeIdAmong, validateDocument3, type Channel, type ChannelId, type ChoiceIds, type Document3 } from "../core/file3";
import { choiceDoc, choiceOfFocus, validateDocument4, type Choice4, type Document4 } from "../core/file4";
import { intentToChannel, STORY_SCHEMA } from "../core/intent";
import { mapAsOneView, splitMap } from "../core/map";
import { LIMITS, newDocumentId, SCHEMA_V3, SCHEMA_V4 } from "../core/model";
import { NO_FACT, READ_SCHEMA, repairRead } from "../core/read";
import { layoutReport, type LayoutReport } from "../core/report";
import type { RepoCard } from "../core/scan";
import { startSwitches, type FormatId } from "../core/export/share";
import { documentToDraft } from "../core/repair";
import { focusText, postPrompt, readPrompt, storyPrompt, type DrawFocus } from "./engines/prompt";
import { EngineError, type Engine } from "./engines/types";
import { docText } from "./files";
import { headCommit, listFolder, repoFile, type Folder } from "./folders";
import type { DrawStage, StoryChannel } from "./runs";
import { nowIso, type Store } from "./store";
import { storyAnswer } from "./story-turn";

/** A draw that cannot write its file, or whose answers cannot become a drawing: the run fails. */
export class DrawError extends Error {}

export interface DrawRequest {
  engine: Engine;
  model: string | null;
  /** The scan the draw starts from; with the engine and model, the key of what a failed draw keeps. */
  scan: string;
  /** The scanned folder (api contract, Folders), checked again when the draw was asked for. */
  folder: Folder;
  /** One draw per folder at a time. */
  folderKey: string;
  card: RepoCard;
  /** The choices to draw, in request order (api contract, The draw run). */
  focuses: DrawFocus[];
  channel: StoryChannel;
}

/** One choice of a draw as the run record lists it (api contract, Run record). */
export interface DrawChoice {
  id: string; kind: Choice4["kind"]; title: string;
  status: "waiting" | "running" | "done" | "failed" | "cancelled";
  stage: DrawStage | null;
}

const STAGE_LINES: Record<StoryChannel, string> = { linkedin: "Drawing the LinkedIn post", readme: "Drawing the README drawing", presentation: "Drawing the presentation" };
const REUSED_LINES: Record<StoryChannel, string> = { linkedin: "Using the LinkedIn post already drawn", readme: "Using the README drawing already drawn", presentation: "Using the presentation already drawn" };
const FORMAT_OF: Record<StoryChannel, FormatId> = { linkedin: "feed", readme: "readme", presentation: "slide" };

/**
 * What a draw that ended without a drawing kept of one choice (api contract, What a failed draw keeps): its read
 * answer once it was checked; its overview once it was converted, with the facts it was drawn from and the warnings
 * it added; and, for a choice that finished, its view of the chosen channel with that channel. Views carry the ids
 * of the place the choice had in its draw (`prefix`), renamed when a later draw puts it elsewhere.
 */
export interface KeptChoice {
  read: unknown;
  overview: { facts: string; channel: Channel; warnings: string[] } | null;
  channel: { channel: StoryChannel; state: Channel; warnings: string[] } | null;
  prefix: string | null;
}

/** The key a later draw must match to start from what a failed one kept: its scan, engine and model (api contract). */
export const keptKey = (req: Pick<DrawRequest, "scan" | "engine" | "model">) => JSON.stringify([req.scan, req.engine.id, req.model]);
/** A choice as requested: the whole system, the option's id, or the typed text as trimmed. */
export const choiceKey = (f: DrawFocus) => (f.kind === "whole" ? "whole" : f.kind === "option" ? `option:${f.option.id ?? f.option.title}` : `typed:${f.text.trim()}`);

/** The run's choices as the record lists them from the start: ids are slugs, free among the earlier ones. */
export function drawChoices(focuses: DrawFocus[]): DrawChoice[] {
  const used = new Set<string>();
  return focuses.map((f) => {
    const c = choiceOfFocus(f, used);
    used.add(c.id);
    return { id: c.id, kind: c.kind, title: c.title, status: "waiting", stage: null };
  });
}

/** The names a draw may take: `architecture.archdraw.json`, then `architecture-2` … `-99`. */
const NAMES = ["architecture.archdraw.json", ...Array.from({ length: 98 }, (_, i) => `architecture-${i + 2}.archdraw.json`)];

/**
 * A `draw` run (api contract, The draw run): each choice in turn — its read, its overview, its channel — then one new
 * file holding them all, which replaces none, registered. Nothing is written before the last step, so a failure,
 * cancel or timeout in any choice leaves nothing behind but what `done` records in memory. `kept`, what earlier failed
 * draws with the same scan, engine and model finished, takes the place of their calls (api contract, What a failed
 * draw keeps). `choices` is the run record's list, updated as the draw goes.
 */
export async function runDraw(req: DrawRequest, ctx: {
  store: Store; timeoutMs: number; signal: AbortSignal;
  progress: (m: string, stage: DrawStage | null, choice: string | null) => void; wrote: (path: string) => void;
  choices: DrawChoice[];
  kept?: ReadonlyMap<string, KeptChoice> | null; done?: Map<string, KeptChoice>;
  /** A choice's own deadline starts at its first line. */
  restartDeadline?: () => void;
}): Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }> {
  const { channel } = req;
  const n = req.focuses.length;
  const drawn: { choice: Pick<Choice4, "id" | "title" | "kind" | "about">; doc: Document3; view: string }[] = [];
  for (let i = 0; i < n; i++) {
    const focus = req.focuses[i];
    const state = ctx.choices[i];
    const choice = { ...choiceOfFocus(focus), id: state.id };
    ctx.restartDeadline?.();
    state.status = "running"; state.stage = "read";
    const taken = drawn.flatMap((d) => CHANNELS.flatMap((c) => d.doc.channels[c].views.map((v) => v.id)));
    const ids: ChoiceIds = { prefix: i === 0 ? null : choice.id, taken, system: choice.kind === "system" };
    const progress = (m: string, stage: DrawStage | null) => { if (stage) state.stage = stage; ctx.progress(m, stage, choice.id); };
    progress(`Drawing "${choice.title}" (${i + 1} of ${n})`, "read");
    const key = choiceKey(focus);
    const r = await drawChoice(req, { signal: ctx.signal, timeoutMs: ctx.timeoutMs, progress, focus, choice, ids, index: i, kept: ctx.kept?.get(key) ?? null, done: (k) => ctx.done?.set(key, k) });
    state.status = "done";
    drawn.push({ choice, doc: r.doc, view: r.view });
  }

  // 4. A new file that replaces none, then registered; a file that cannot be registered goes again.
  // Each choice's warnings in turn; in a run of several, each starts with its choice's title.
  const warnings = drawn.flatMap((d) => d.doc.warnings.map((w) => (n > 1 ? `${d.choice.title}: ${w}` : w)));
  const base = drawn[0].doc;
  const doc4: Document4 = {
    schema: SCHEMA_V4, id: base.id, title: base.title, theme: base.theme, source: base.source, engine: { id: req.engine.id, model: req.model },
    createdAt: base.createdAt, updatedAt: nowIso(),
    choices: drawn.map((d) => ({ ...d.choice, facts: d.doc.facts, channels: d.doc.channels })), requests: [], warnings,
  };
  const valid = validateDocument4(doc4);
  if (!valid.ok) throw new DrawError(`The engine's answers could not become a valid drawing: ${valid.error}`);
  if (ctx.signal.aborted) throw new EngineError("Cancelled");
  const path = writeNewDrawing(req.folder.folder, docText(valid.doc));
  let id: string;
  try { id = ctx.store.register(path).id; } catch (e) {
    try { unlinkSync(path); } catch { /* already gone */ }
    throw new DrawError(`The drawing could not be registered: ${(e as Error).message}`);
  }
  ctx.wrote(path);
  const w = warnings.length;
  ctx.progress(w ? `Saved with ${w} warning${w === 1 ? "" : "s"}` : "Saved", "channel", drawn[n - 1].choice.id);

  // The result is the first choice's view of the chosen channel (api contract, The draw run).
  const head = drawn[0];
  const stored = ctx.store.get(id);
  const saved = stored ? choiceDoc(stored, head.choice.id) : head.doc;
  const joined = joinChannel(saved, channel);
  const format = FORMAT_OF[channel];
  const report = layoutReport(joined, head.view, { ...startSwitches(format, channel === "linkedin"), format, theme: saved.theme });
  // Everything the drawing holds is new.
  const empty = { ...joined, views: joined.views.map((v) => ({ ...v, nodes: [], edges: [] })) };
  return { diagramId: id, changes: diffDocuments(empty, joined, [head.view]), layoutReport: report, channel, view: head.view };
}

/** One choice of a draw: its read, its overview (for the whole system, split into the map), its channel. */
async function drawChoice(req: DrawRequest, ctx: {
  signal: AbortSignal; timeoutMs: number; progress: (m: string, stage: DrawStage | null) => void;
  focus: DrawFocus; choice: Pick<Choice4, "id" | "title" | "kind" | "about">; ids: ChoiceIds; index: number;
  kept: KeptChoice | null; done: (k: KeptChoice) => void;
}): Promise<{ doc: Document3; view: string }> {
  const { engine, model, folder: f, channel } = req;
  const { signal, focus, kept } = ctx;
  const root = f.root, folderName = basename(f.folder);
  const cancelled = () => { if (signal.aborted) throw new EngineError("Cancelled"); };
  // What the fixture reads markers from: the typed choice's text (the folder's name it is given apart).
  const instruction = focus.kind === "typed" ? focus.text : "";
  type Task = NonNullable<Parameters<Engine["run"]>[0]["task"]>;
  // The engine is told which of the run's choices it draws (the fixture's `:second` markers read it).
  const call = (stage: DrawStage, task: Task, base: unknown = null, view = "") =>
    engine.run({ cwd: root, folderName, instruction, view, model, scope: { kind: "all" }, parts: [], base, signal, timeoutMs: ctx.timeoutMs, progress: (m) => ctx.progress(m, stage), task: { ...task, data: { ...task.data, choiceIndex: ctx.index } } });
  // A repair turn: the call again with its repair prompt and no tools (diagram contract, Problems and the repair turn).
  const repairOf = (stage: DrawStage, task: Task, base: unknown = null, view = "") =>
    (prompt: string) => call(stage, { ...task, tools: "none", prompt, data: { ...task.data, repair: true } }, base, view);
  const isSystem = ctx.choice.kind === "system";
  const record: KeptChoice = { read: undefined, overview: null, channel: null, prefix: ctx.ids.prefix };

  // 1. Read: the facts with their evidence, read-only; a kept read answer is checked again, with no call.
  let read: unknown;
  if (kept) {
    ctx.progress("Using the facts already read", "read");
    read = kept.read;
  } else {
    const inGit = (await headCommit(root)) !== null;
    const { listing } = await listFolder(f, inGit);
    cancelled();
    read = await call("read", {
      kind: "read", schema: READ_SCHEMA, tools: "read", data: { listing, draw: "read" },
      prompt: readPrompt({ folderName, rel: f.rel, card: req.card, focus, agent: req.card.type === "agent" }),
    });
    cancelled();
  }
  ctx.progress("Checking the facts", "read");
  const repaired = repairRead(read);
  const checked = checkEvidence(repaired.facts, { exists: repoFile(root), lineCount: (p) => lineCount(join(root, p)) });
  if (!checked.facts.components.length) throw new DrawError(NO_FACT);
  record.read = read;
  ctx.done(record);
  const filled = fillDefaults3({
    schema: SCHEMA_V3, title: req.card.name.slice(0, LIMITS.title) || folderName,
    facts: checked.facts, channels: { overview: { views: [] } }, warnings: [...repaired.warnings, ...checked.warnings],
  } as Parameters<typeof fillDefaults3>[0], { id: newDocumentId(), now: nowIso(), source: { kind: "local", path: root } });
  // Where the choice sits in the file decides the ids of the views made in it (diagram contract, The view).
  const skeleton: Document3 = { ...filled, ids: ctx.ids };

  // 2. The overview: a story from the facts and the card, every fact then drawn by code, then split into the map.
  // A kept overview is used only when the facts came out of the check as they were when it was drawn.
  ctx.progress("Drawing the overview", "overview");
  const facts = JSON.stringify(skeleton.facts);
  let withOverview: Document3;
  const keptOverview = kept?.overview && kept.overview.facts === facts ? kept.overview : null;
  if (keptOverview) {
    ctx.progress("Using the overview already drawn", "overview");
    withOverview = { ...skeleton, channels: { ...skeleton.channels, overview: placedAt(keptOverview.channel, kept!.prefix, skeleton, "overview") }, warnings: [...skeleton.warnings, ...keptOverview.warnings] };
    cancelled();
  } else {
    const task = {
      kind: "story" as const, schema: STORY_SCHEMA, tools: "none" as const, data: { channel: "overview", title: skeleton.title, draw: "overview" as const },
      prompt: storyPrompt({ channel: isSystem ? "map" : "overview", folderName, facts: skeleton.facts, card: req.card, focus: focusText(focus) }),
    };
    const answer = await call("overview", task);
    cancelled();
    const intent = await storyAnswer(answer, { channel: "overview", check: null, signal, progress: (m) => ctx.progress(m, "overview"), repair: repairOf("overview", task) });
    const drawnOverview = intentToChannel(skeleton, intent, { portrait: false, channel: "overview" }).doc;
    withOverview = isSystem ? splitMap(drawnOverview, ctx.ids.taken) : drawnOverview;
  }
  // The choice's place in the file goes on to the channel, whose view takes its id from it.
  withOverview = { ...withOverview, ids: ctx.ids };
  record.overview = { facts, channel: withOverview.channels.overview, warnings: withOverview.warnings.slice(skeleton.warnings.length) };
  ctx.done(record);

  // 3. The chosen channel, told from the facts and the overview just drawn (for the whole system, the map and its
  // detail views as one view, skipping parts with an inside: diagram contract, The map). A finished choice's kept
  // channel is used when its overview was and the channel is the one it was drawn in.
  ctx.progress(STAGE_LINES[channel], "channel");
  if (keptOverview && kept!.channel && kept!.channel.channel === channel) {
    ctx.progress(REUSED_LINES[channel], "channel");
    const doc: Document3 = { ...withOverview, channels: { ...withOverview.channels, [channel]: placedAt(kept!.channel.state, kept!.prefix, withOverview, channel) }, warnings: [...withOverview.warnings, ...kept!.channel.warnings] };
    const valid = validateDocument3(doc);
    if (!valid.ok) throw new DrawError(`The engine's answers could not become a valid drawing: ${valid.error}`);
    record.channel = { ...kept!.channel, state: valid.doc.channels[channel] };
    ctx.done(record);
    cancelled();
    const placed: Document3 = { ...valid.doc, ids: ctx.ids };
    return { doc: placed, view: placed.channels[channel].views[0].id };
  }
  const joinedOverview = joinChannel(withOverview, "overview");
  const overview = isSystem && joinedOverview.views.length > 1 ? { ...joinedOverview, views: [mapAsOneView(joinedOverview.views)] } : joinedOverview;
  const draft = documentToDraft({ ...overview, views: overview.views.map((v) => ({ ...v, nodes: v.nodes.map((n) => ({ ...n, from: [...(n.facts ?? [])] })) })) });
  const source = overview.views[0];
  const channelTask = {
    kind: channel === "linkedin" ? "post" as const : "story" as const, schema: STORY_SCHEMA, tools: "none" as const, data: { channel, overview: source, draw: "channel" as const },
    prompt: channel === "linkedin"
      ? postPrompt({ folderName, view: source.id, base: draft, facts: withOverview.facts, format: "feed", readCode: false })
      : storyPrompt({ channel, folderName, view: source.id, base: draft, facts: withOverview.facts, focus: focusText(focus) }),
  };
  const channelAnswer = await call("channel", channelTask, draft, source.id);
  cancelled();
  ctx.progress("Checking the drawing", "channel");
  const channelIntent = await storyAnswer(channelAnswer, {
    channel, check: "Checking the drawing", signal, progress: (m) => ctx.progress(m, "channel"), repair: repairOf("channel", channelTask, draft, source.id),
  });
  const told = intentToChannel(withOverview, channelIntent, { portrait: channel === "linkedin", channel });
  const doc: Document3 = { ...told.doc, engine: { id: engine.id, model }, updatedAt: nowIso() };
  const valid = validateDocument3(doc);
  if (!valid.ok) throw new DrawError(`The engine's answers could not become a valid drawing: ${valid.error}`);
  record.channel = { channel, state: valid.doc.channels[channel], warnings: valid.doc.warnings.slice(withOverview.warnings.length) };
  ctx.done(record);
  cancelled();
  return { doc: { ...valid.doc, ids: ctx.ids }, view: told.view };
}

/**
 * A kept channel put where the choice now sits (api contract, What a failed draw keeps): a channel's first view takes
 * the id the place gives it, and a detail view keeps its id unless an earlier choice holds it; `detail` follows.
 */
function placedAt(ch: Channel, from: string | null, at: Document3, channel: ChannelId): Channel {
  const to = at.ids?.prefix ?? null;
  const taken = at.ids?.taken ?? [];
  if (from === to && !ch.views.some((v) => taken.includes(v.id))) return structuredClone(ch);
  const used = new Set(taken);
  const rename = new Map<string, string>();
  ch.views.forEach((v, i) => {
    const id = freeIdAmong(used, i === 0 ? (to ? `${to}-${channel}` : channel) : v.id);
    used.add(id); rename.set(v.id, id);
  });
  const copy = structuredClone(ch);
  return { ...copy, views: copy.views.map((v) => ({ ...v, id: rename.get(v.id)!, nodes: v.nodes.map((p) => ({ ...p, detail: p.detail ? rename.get(p.detail) ?? p.detail : null })) })) };
}

/** A file's number of lines; a last line without a newline counts (diagram contract, The evidence check). */
function lineCount(p: string): number {
  try {
    const st = statSync(p);
    if (!st.isFile()) return 0;
    const buf = readFileSync(p);
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
  } catch { return 0; }
}

/**
 * Write a new drawing into `<folder>/docs/` under the first free name, never replacing a file: the
 * text goes to a temporary file, and the name is claimed by linking it there, which fails when the
 * name exists (api contract, The draw run). Where links are not supported, the name is created
 * exclusively instead. The temporary file is removed in every outcome.
 */
export function writeNewDrawing(folder: string, text: string): string {
  const docs = join(folder, "docs");
  const fail = (reason: string): never => { throw new DrawError(`Could not write the drawing in ${docs}: ${reason}`); };
  const why = (e: unknown) => {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM" || code === "EROFS" ? "the folder is read-only" : code === "ENOTDIR" || code === "EEXIST" ? "docs is not a folder" : (e as Error).message;
  };
  try { mkdirSync(docs, { recursive: true }); } catch (e) { fail(why(e)); }
  // A docs that is a link (a symlink or a junction) could lead anywhere: the drawing is written only inside the folder.
  try {
    const st = lstatSync(docs);
    if (st.isSymbolicLink()) fail("docs is a link, not a folder of this project");
    if (!st.isDirectory()) fail("docs is not a folder");
    const inside = relative(realpathSync.native(folder), realpathSync.native(docs));
    if (inside !== "docs" && inside.toLowerCase() !== "docs") fail("docs leads out of the folder");
  } catch (e) { if (e instanceof DrawError) throw e; fail(why(e)); }
  const tmp = join(docs, `.archdraw-${randomBytes(6).toString("hex")}.tmp`);
  try { writeFileSync(tmp, text, { flag: "wx" }); } catch (e) { fail(why(e)); }
  try {
    for (const name of NAMES) {
      const target = join(docs, name);
      try { linkSync(tmp, target); return target; } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EEXIST") continue;
        // No links here (FAT, exFAT, some shares answer EPERM, ENOTSUP, EISDIR …): claim the name by creating it exclusively.
        try { copyFileSync(tmp, target, constants.COPYFILE_EXCL); return target; } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code === "EEXIST") continue;
          fail(why(e2));
        }
      }
    }
    return fail("every name from architecture.archdraw.json to architecture-99.archdraw.json is taken");
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

