import { randomBytes } from "node:crypto";
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { joinChannel } from "../core/channels";
import { diffDocuments, type Changes } from "../core/diff";
import { checkEvidence } from "../core/evidence";
import { fillDefaults3, validateDocument3, type ChannelId, type Document3 } from "../core/file3";
import { intentToChannel, STORY_SCHEMA } from "../core/intent";
import { LIMITS, newDocumentId, SCHEMA_V3 } from "../core/model";
import { NO_FACT, READ_SCHEMA, repairRead } from "../core/read";
import { layoutReport, type LayoutReport } from "../core/report";
import type { RepoCard } from "../core/scan";
import { startSwitches, type FormatId } from "../core/export/share";
import { documentToDraft } from "../core/repair";
import { focusText, postPrompt, readPrompt, storyPrompt, type DrawFocus } from "./engines/prompt";
import { EngineError, type Engine } from "./engines/types";
import { docText, repoFileChecker } from "./files";
import { headCommit, listFolder, type Folder } from "./folders";
import type { DrawStage, StoryChannel } from "./runs";
import { nowIso, type Store } from "./store";
import { storyAnswer } from "./story-turn";

/** A draw that cannot write its file, or whose answers cannot become a drawing: the run fails. */
export class DrawError extends Error {}

export interface DrawRequest {
  engine: Engine;
  model: string | null;
  /** The scan the draw starts from; with the focus, engine and model, the key of what a failed draw keeps. */
  scan: string;
  /** The scanned folder (api contract, Folders), checked again when the draw was asked for. */
  folder: Folder;
  /** One draw per folder at a time. */
  folderKey: string;
  card: RepoCard;
  focus: DrawFocus;
  channel: StoryChannel;
}

const STAGE_LINES: Record<StoryChannel, string> = { linkedin: "Drawing the LinkedIn post", readme: "Drawing the README drawing", presentation: "Drawing the presentation" };
const FORMAT_OF: Record<StoryChannel, FormatId> = { linkedin: "feed", readme: "readme", presentation: "slide" };
/**
 * What a draw that ended without a drawing had finished (api contract, What a failed draw keeps):
 * the read answer once it was checked, and the overview once it was converted, with the facts it was
 * drawn from and the warnings it added.
 */
export interface KeptDraw {
  read: unknown;
  overview: { facts: string; channel: Document3["channels"]["overview"]; warnings: string[] } | null;
}

/** The key a later draw must match to start from what a failed one kept (api contract). */
export const keptKey = (req: Pick<DrawRequest, "scan" | "focus" | "engine" | "model">) =>
  JSON.stringify([req.scan, req.focus, req.engine.id, req.model]);

/** The names a draw may take: `architecture.archdraw.json`, then `architecture-2` … `-99`. */
const NAMES = ["architecture.archdraw.json", ...Array.from({ length: 98 }, (_, i) => `architecture-${i + 2}.archdraw.json`)];

/**
 * A `draw` run (api contract, The draw run): read the facts, draw the overview, draw the chosen
 * channel, then write a new file that replaces none and register it. Nothing is written before the
 * last step, so a failure, cancel or timeout at any stage leaves nothing behind but what `done`
 * records in memory. `kept`, what an earlier failed draw of the same request finished, takes the
 * place of its calls (api contract, What a failed draw keeps).
 */
export async function runDraw(req: DrawRequest, ctx: {
  store: Store; timeoutMs: number; signal: AbortSignal;
  progress: (m: string, stage: DrawStage | null) => void; wrote: (path: string) => void;
  kept?: KeptDraw | null; done?: Partial<KeptDraw>;
}): Promise<{ diagramId: string; changes: Changes; layoutReport: LayoutReport; channel: ChannelId; view: string }> {
  const { engine, model, folder: f, channel } = req;
  const { signal } = ctx;
  const root = f.root, folderName = basename(f.folder);
  const cancelled = () => { if (signal.aborted) throw new EngineError("Cancelled"); };
  // What the fixture reads markers from: the typed focus (the folder's name it is given apart).
  const instruction = req.focus.kind === "typed" ? req.focus.text : "";
  const call = (stage: DrawStage, task: NonNullable<Parameters<Engine["run"]>[0]["task"]>, base: unknown = null, view = "") =>
    engine.run({ cwd: root, folderName, instruction, view, model, scope: { kind: "all" }, parts: [], base, signal, timeoutMs: ctx.timeoutMs, progress: (m) => ctx.progress(m, stage), task });

  const kept = ctx.kept ?? null;
  const done = ctx.done ?? {};
  // A repair turn: the call again with its repair prompt and no tools (diagram contract, Problems and the repair turn).
  const repairOf = (stage: DrawStage, task: NonNullable<Parameters<Engine["run"]>[0]["task"]>, base: unknown = null, view = "") =>
    (prompt: string) => call(stage, { ...task, tools: "none", prompt, data: { ...task.data, repair: true } }, base, view);

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
      prompt: readPrompt({ folderName, rel: f.rel, card: req.card, focus: req.focus, agent: req.card.type === "agent" }),
    });
    cancelled();
  }
  ctx.progress("Checking the facts", "read");
  const repaired = repairRead(read);
  const checked = checkEvidence(repaired.facts, { exists: repoFileChecker(root), lineCount: (p) => lineCount(join(root, p)) });
  if (!checked.facts.components.length) throw new DrawError(NO_FACT);
  done.read = read;
  const skeleton = fillDefaults3({
    schema: SCHEMA_V3, title: req.card.name.slice(0, LIMITS.title) || folderName,
    facts: checked.facts, channels: { overview: { views: [] } }, warnings: [...repaired.warnings, ...checked.warnings],
  } as Parameters<typeof fillDefaults3>[0], { id: newDocumentId(), now: nowIso(), source: { kind: "local", path: root } });

  // 2. The overview: a story from the facts and the card, every fact then drawn by code.
  // A kept overview is used only when the facts came out of the check as they were when it was drawn.
  ctx.progress("Drawing the overview", "overview");
  const facts = JSON.stringify(skeleton.facts);
  let withOverview: Document3;
  if (kept?.overview && kept.overview.facts === facts) {
    ctx.progress("Using the overview already drawn", "overview");
    withOverview = { ...skeleton, channels: { ...skeleton.channels, overview: kept.overview.channel }, warnings: [...skeleton.warnings, ...kept.overview.warnings] };
    cancelled();
  } else {
    const task = {
      kind: "story" as const, schema: STORY_SCHEMA, tools: "none" as const, data: { channel: "overview", title: skeleton.title, draw: "overview" as const },
      prompt: storyPrompt({ channel: "overview", folderName, facts: skeleton.facts, card: req.card, focus: focusText(req.focus) }),
    };
    const answer = await call("overview", task);
    cancelled();
    const intent = await storyAnswer(answer, { channel: "overview", check: null, signal, progress: (m) => ctx.progress(m, "overview"), repair: repairOf("overview", task) });
    withOverview = intentToChannel(skeleton, intent, { portrait: false, channel: "overview" }).doc;
  }
  done.overview = { facts, channel: withOverview.channels.overview, warnings: withOverview.warnings.slice(skeleton.warnings.length) };

  // 3. The chosen channel, told from the facts and the overview just drawn.
  ctx.progress(STAGE_LINES[channel], "channel");
  const overview = joinChannel(withOverview, "overview");
  const draft = documentToDraft({ ...overview, views: overview.views.map((v) => ({ ...v, nodes: v.nodes.map((n) => ({ ...n, from: [...(n.facts ?? [])] })) })) });
  const source = overview.views[0];
  const channelTask = {
    kind: channel === "linkedin" ? "post" as const : "story" as const, schema: STORY_SCHEMA, tools: "none" as const, data: { channel, overview: source, draw: "channel" as const },
    prompt: channel === "linkedin"
      ? postPrompt({ folderName, view: source.id, base: draft, facts: withOverview.facts, format: "feed", readCode: false })
      : storyPrompt({ channel, folderName, view: source.id, base: draft, facts: withOverview.facts, focus: focusText(req.focus) }),
  };
  const channelAnswer = await call("channel", channelTask, draft, source.id);
  cancelled();
  ctx.progress("Checking the drawing", "channel");
  const channelIntent = await storyAnswer(channelAnswer, {
    channel, check: "Checking the drawing", signal, progress: (m) => ctx.progress(m, "channel"), repair: repairOf("channel", channelTask, draft, source.id),
  });
  const drawn = intentToChannel(withOverview, channelIntent, { portrait: channel === "linkedin", channel });
  const doc: Document3 = { ...drawn.doc, engine: { id: engine.id, model }, updatedAt: nowIso() };
  const valid = validateDocument3(doc);
  if (!valid.ok) throw new DrawError(`The engine's answers could not become a valid drawing: ${valid.error}`);
  cancelled();

  // 4. A new file that replaces none, then registered; a file that cannot be registered goes again.
  const path = writeNewDrawing(f.folder, docText(valid.doc));
  let id: string;
  try { id = ctx.store.register(path).id; } catch (e) {
    try { unlinkSync(path); } catch { /* already gone */ }
    throw new DrawError(`The drawing could not be registered: ${(e as Error).message}`);
  }
  ctx.wrote(path);
  const n = valid.doc.warnings.length;
  ctx.progress(n ? `Saved with ${n} warning${n === 1 ? "" : "s"}` : "Saved", "channel");

  const saved = ctx.store.get(id) ?? valid.doc;
  const view = drawn.view;
  const joined = joinChannel(saved, channel);
  const format = FORMAT_OF[channel];
  const report = layoutReport(joined, view, { ...startSwitches(format, channel === "linkedin"), format, theme: saved.theme });
  // Everything the drawing holds is new.
  const empty = { ...joined, views: joined.views.map((v) => ({ ...v, nodes: [], edges: [] })) };
  return { diagramId: id, changes: diffDocuments(empty, joined, [view]), layoutReport: report, channel, view };
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

