import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError, type DrawChannel, type DrawChoiceState, type DrawFocus, type FocusOption, type FolderCheck, type PickAnswer, type RepoCard, type ScanRecord, type ScanTarget, type Sources } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import type { EngineState } from "./Engine";
import { afterPaint, paced } from "./pace";
import { SourceRow } from "./Source";

/**
 * The `Draw a project` panel (ui contract, Home: *Choosing a repository*, *The scan and the repository card*,
 * *Choosing what to draw*, *Following a job*): the folder, its scan, the choices as cards, where it will go and
 * the bar, then the draw. The panel follows one job at a time; the server checks the folder, scans it and draws
 * every choice in one run (api contract, Folders, Scans, The draw run).
 */

const TYPES: Record<RepoCard["type"], string> = { agent: "AI agent project", backend: "Backend service", fullstack: "Full-stack app", other: "Other project" };
export const CHANNELS: { id: DrawChannel; label: string; size: string; summary: string; stage: string; page: { w: number; h: number } }[] = [
  { id: "linkedin", label: "LinkedIn post", size: "1080 × 1350", summary: " for a LinkedIn post", stage: "Drawing the LinkedIn post", page: { w: 44, h: 55 } },
  { id: "readme", label: "README drawing", size: "wide · light or dark", summary: " for a README", stage: "Drawing the README drawing", page: { w: 96, h: 40 } },
  { id: "presentation", label: "Presentation", size: "16 : 9 slides", summary: " for a presentation", stage: "Drawing the presentation", page: { w: 80, h: 45 } },
];
/** Sections take the kind hues in turn (DESIGN.md, Home screen, Choice cards). */
const SECTION_LOOKS = [
  { k: "client", icon: "window" }, { k: "service", icon: "server" }, { k: "llm", icon: "spark" },
  { k: "data", icon: "db" }, { k: "api", icon: "inbox" }, { k: "ops", icon: "timer" },
] as const;
const LANGUAGE_HUES = ["api", "gate", "service", "data", "llm", "ops"] as const;
const STAGES = ["read", "overview", "channel"] as const;
type Stage = (typeof STAGES)[number];
export const STEPS = ["Folder", "Focus", "Destination", "Draw"] as const;
export type Step = (typeof STEPS)[number];
const SHOWN_FILES = 3;
const UNREACHABLE = "Could not reach the archdrawer server";

/** The server's folder refusal in one plain sentence. */
export function folderSentence(message: string): string {
  if (/^Not found: /.test(message)) return "This folder does not exist.";
  if (/^Not a folder: /.test(message)) return "This is a file, not a folder.";
  if (/must be absolute|Give the absolute path/.test(message)) return "Give the whole path, starting from the drive or from /.";
  return message;
}

type Ticked = { whole: boolean; options: string[]; typed: boolean };
const NONE: Ticked = { whole: false, options: [], typed: false };
export interface Scan { id: string; target: ScanTarget; folder: string; card: RepoCard; options: FocusOption[]; cached: boolean; commit: string | null; link: string | null }
/** Where the repository comes from (ui contract, `start-source`). */
export type SourceTab = "local" | "link";
/** The latest check of the link field's text: its answer, or the server's refusal. */
type LinkCheck = { text: string; answer: FolderCheck | null; error: string | null };
/** A draw run the panel follows: its choices as the run record lists them, the latest line, and how it ended. */
interface Draw { status: "running" | "failed"; rows: DrawChoiceState[]; line: string; error: string | null; runId: string | null }
type End = { status: string; error: string | null; diagramId?: string | null; choice?: string; choices?: DrawChoiceState[] | null };
type Progress = { message: string; stage?: Stage | null; choice?: string | null };

/**
 * Follow a scan's or a run's event stream until it is done. When the stream drops, its record is read instead
 * until it has finished; three failed reads in a row mean the server is gone. Each progress line is rendered and
 * painted before the next (`paced`), so a burst never shows only its last line.
 */
function follow(url: string, record: () => Promise<End>, onProgress: (data: Progress) => void, live: Set<() => void>): Promise<End> {
  return new Promise((done) => {
    let over = false, timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(url);
    // The end goes through the same queue as the lines, so every earlier line is painted before it shows.
    const lines = paced((item: Progress | { end: End }) => { if ("end" in item) finish(item.end); else flushSync(() => onProgress(item)); }, afterPaint);
    const stop = () => { over = true; es.close(); lines.stop(); if (timer) clearTimeout(timer); live.delete(stop); };
    live.add(stop);
    const finish = (e: End) => { if (!over) { stop(); done(e); } };
    es.addEventListener("progress", (ev) => lines.push(JSON.parse((ev as MessageEvent).data)));
    let ended = false;
    es.addEventListener("done", (ev) => { ended = true; es.close(); lines.push({ end: JSON.parse((ev as MessageEvent).data) as End }); });
    let misses = 0;
    const poll = () => {
      if (over) return;
      record().then((r) => { misses = 0; if (r.status !== "running") finish(r); else timer = setTimeout(poll, 1000); },
        (e: unknown) => {
          // The server answered: a scan or run it no longer knows (it restarted) ends the wait now.
          if (e instanceof ApiError && e.status !== 0) return finish({ status: "failed", error: e.status === 404 ? "The server restarted; scan again" : e.message });
          if (++misses >= 3) finish({ status: "failed", error: UNREACHABLE }); else timer = setTimeout(poll, 1000);
        });
    };
    // The stream closing after its end is no drop.
    es.onerror = () => { if (over || ended) return; es.close(); if (!timer) poll(); };
  });
}

/** A row's stage as the screen shows it (ui contract, `draw-stage`). */
function stageState(row: DrawChoiceState, s: Stage): "waiting" | "running" | "done" | "failed" {
  if (row.status === "done") return "done";
  if (row.status === "waiting" || !row.stage) return "waiting";
  const at = STAGES.indexOf(row.stage), me = STAGES.indexOf(s);
  if (me < at) return "done";
  if (me > at) return "waiting";
  return row.status === "running" ? "running" : "failed";
}

/** The rows after a progress line of `choice` at `stage`: earlier choices done, that one running there, later ones waiting. */
function advance(rows: DrawChoiceState[], choice: string | null | undefined, stage: Stage | null | undefined): DrawChoiceState[] {
  const at = rows.findIndex((r) => r.id === choice);
  if (at < 0) return rows;
  return rows.map((r, i) => (i < at ? { ...r, status: "done", stage: "channel" } : i === at ? { ...r, status: "running", stage: stage ?? r.stage ?? "read" } : { ...r, status: "waiting", stage: null }));
}

export type StartState = ReturnType<typeof useStart>;

export function useStart({ engine: eng, onJob, onSources }: { engine: EngineState; onJob: () => void; onSources: () => void }) {
  const { engine, model } = eng;
  const [source, setSource] = useState<SourceTab>("local");
  const [folder, setFolder] = useState("");
  const [link, setLink] = useState("");
  const [linkCheck, setLinkCheck] = useState<LinkCheck | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickGone, setPickGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ drawing: string; target: ScanTarget } | null>(null);
  const [scanning, setScanning] = useState<{ id: string | null; line: string } | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [ticked, setTicked] = useState<Ticked>(NONE);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<DrawChannel | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [focusAsk, setFocusAsk] = useState<{ el: "folder" | "scan"; n: number } | null>(null);
  const lastDraw = useRef<Parameters<typeof api.startDraw>[0] | null>(null);
  // Open streams, closed when the panel stops following or the screen goes; a job that ends after that changes nothing.
  const live = useRef(new Set<() => void>());
  const epoch = useRef(0);
  const mounted = useRef(true);
  // Set again on mount: StrictMode mounts twice in development, and a ref left false would drop every finished scan.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const stop of [...live.current]) stop(); }; }, []);

  const following = scanning !== null || scan !== null || draw !== null;
  const busy = scanning !== null || draw?.status === "running";
  const sections = scan?.options.filter((o) => o.kind === "section") ?? [];
  const flows = scan?.options.filter((o) => o.kind === "flow") ?? [];
  const count = (ticked.whole ? 1 : 0) + ticked.options.length + (ticked.typed ? 1 : 0);
  const step: Step = draw ? "Draw" : scan ? (count > 0 ? "Destination" : "Focus") : "Folder";
  const linkOk = !!linkCheck?.answer && linkCheck.text === link;
  const current = () => epoch.current;
  const still = (at: number) => mounted.current && epoch.current === at;

  /** The panel follows nothing any more: fields enabled, on the Folder step; the job goes on on the server. */
  const leave = (emptied: boolean) => {
    epoch.current++;
    for (const stop of [...live.current]) stop();
    setScanning(null); setScan(null); setDraw(null); setTicked(NONE); setChannel(null); setText("");
    setError(null); setExisting(null); lastDraw.current = null;
    if (emptied) { setFolder(""); setLink(""); }
  };
  const askFocus = (el: "folder" | "scan") => setFocusAsk((f) => ({ el, n: (f?.n ?? 0) + 1 }));

  // The link is checked 300 ms after its last change; an answer for an older text is dropped.
  useEffect(() => {
    if (!link.trim()) { setLinkCheck(null); return; }
    let gone = false;
    const timer = setTimeout(() => {
      api.checkFolder({ link }).then((answer) => { if (!gone) setLinkCheck({ text: link, answer, error: null }); },
        (e: Error) => { if (!gone) setLinkCheck({ text: link, answer: null, error: e.message }); });
    }, 300);
    return () => { gone = true; clearTimeout(timer); };
  }, [link]);

  const runScan = async (target: ScanTarget, refresh: boolean) => {
    if (!engine) return;
    const at = current();
    setError(null); setExisting(null); setDraw(null); setScan(null); setTicked(NONE); setChannel(null);
    setScanning({ id: null, line: "Starting" });
    let id: string;
    try { id = await api.startScan(target, { engine: engine.id, model: model || null, refresh }); }
    catch (e) {
      // A scan of this folder already running: the panel follows that one.
      const running = e instanceof ApiError && e.status === 409 && typeof e.body?.scanId === "string" ? (e.body.scanId as string) : null;
      if (!running) { if (still(at)) { setScanning(null); setError(folderSentence((e as Error).message)); } return; }
      id = running;
    }
    onJob();
    if (!still(at)) return;
    setScanning({ id, line: "Starting" });
    const end = await follow(`/api/scans/${id}/events`, () => api.scan(id), (p) => setScanning((s) => (s ? { ...s, line: p.message } : s)), live.current);
    if (!still(at)) return;
    setScanning(null);
    if (end.status !== "succeeded") { setError(end.status === "cancelled" ? "Cancelled" : end.error ?? "The scan failed"); return; }
    let r: ScanRecord & { link?: string | null };
    try { r = await api.scan(id); } catch (e) { if (still(at)) setError((e as Error).message); return; }
    if (!still(at)) return;
    setScan({ id, target, folder: r.folder, card: r.card!, options: r.options ?? [], cached: r.cached, commit: r.commit, link: r.link ?? null });
  };

  /**
   * Scan: a folder is checked first, a link was checked as it was typed; one that holds a drawing is offered
   * before anything is scanned.
   */
  const onScan = async () => {
    if (!engine || following) return;
    if (source === "link") {
      const answer = linkOk ? linkCheck!.answer! : null;
      if (!answer) return;
      setError(null); setExisting(null);
      if (answer.drawing) { setExisting({ drawing: answer.drawing, target: { link } }); return; }
      await runScan({ link }, false);
      return;
    }
    setError(null); setExisting(null);
    if (!folder.trim()) { setError("Give the whole path, starting from the drive or from /."); return; }
    const at = current();
    let check;
    try { check = await api.checkFolder({ folder }); } catch (e) { if (still(at)) setError(folderSentence((e as Error).message)); return; }
    if (!still(at)) return;
    if (check.drawing) { setExisting({ drawing: check.drawing, target: { folder: check.folder } }); return; }
    await runScan({ folder: check.folder }, false);
  };

  /** `start-pick`: the system's folder dialog; a picked folder goes into the field and Scan takes the focus. */
  const pick = async () => {
    if (picking || following) return;
    const at = current();
    setPicking(true);
    let r: PickAnswer;
    try { r = await api.pickFolder(); }
    catch (e) {
      if (mounted.current) setPicking(false);
      if (still(at)) setError(e instanceof ApiError && e.status === 400 ? folderSentence(e.message) : (e as Error).message);
      return;
    }
    if (!mounted.current) return;
    setPicking(false);
    if (!still(at)) return;
    if (r.status === "unavailable") { setPickGone(true); return; }
    if (r.status !== "picked") return;
    setError(null); setFolder(r.folder);
    setExisting(r.drawing ? { drawing: r.drawing, target: { folder: r.folder } } : null);
    askFocus("scan");
  };

  const openExisting = async () => {
    if (!existing) return;
    try { const id = await api.openFile(existing.drawing); onSources(); navigate(`/d/${id}`); } catch (e) { setError((e as Error).message); }
  };

  /** The ticked choices in the order of `focus-list`: the whole system, the sections, the flows, then the typed text. */
  const drawChoices = (): DrawFocus[] | null => {
    if (ticked.typed && !text.trim()) return null;
    const picked: DrawFocus[] = [
      ...(ticked.whole ? [{ kind: "whole" } as const] : []),
      ...[...sections, ...flows].filter((o) => ticked.options.includes(o.id)).map((o) => ({ kind: "option", option: o.id }) as const),
      ...(ticked.typed ? [{ kind: "typed", text: text.trim() } as const] : []),
    ];
    return picked.length ? picked : null;
  };
  const canDraw = !!scan && !!channel && !!drawChoices() && !busy && !!engine;

  const startDraw = async (body: Parameters<typeof api.startDraw>[0]) => {
    const at = current();
    lastDraw.current = body;
    setError(null);
    setDraw((d) => ({ status: "running", rows: d?.rows ?? [], line: "Starting", error: null, runId: null }));
    let runId: string;
    try { runId = await api.startDraw(body); }
    catch (e) { if (still(at)) setDraw({ status: "failed", rows: [], line: "", error: e instanceof ApiError ? e.message : "Could not start the drawing", runId: null }); return; }
    onJob();
    // The record lists the choices from the start; the lines then move them on.
    const first = await api.run(runId).catch(() => null);
    if (!still(at)) return;
    setDraw((d) => (d ? { ...d, runId, rows: first?.choices ?? [] } : d));
    const end = await follow(`/api/runs/${runId}/events`, () => api.run(runId) as Promise<End>,
      (p) => setDraw((d) => (d ? { ...d, line: p.message, rows: advance(d.rows, p.choice, p.stage) } : d)), live.current);
    if (!still(at)) return;
    onJob();
    if (end.status === "succeeded" && end.diagramId) { navigate(`/d/${end.diagramId}?choice=${encodeURIComponent(end.choice ?? end.choices?.[0]?.id ?? "")}&channel=${body.channel}`); return; }
    const record = end.choices ? end : await api.run(runId).catch(() => null);
    if (!still(at)) return;
    setDraw((d) => ({ status: "failed", rows: record?.choices ?? d?.rows ?? [], line: "", error: end.status === "cancelled" ? "Cancelled" : end.error ?? "The drawing failed", runId: null }));
  };
  const onDraw = () => {
    const choices = drawChoices();
    if (!canDraw || !choices || !scan || !channel || !engine) return;
    void startDraw({ scan: scan.id, choices, channel, engine: engine.id, model: model || null });
  };

  return {
    source, folder, setFolder, link, setLink, linkCheck, linkOk, picking, pickGone, pick,
    error, setError, existing, scanning, scan, ticked, setTicked, text, setText, channel, setChannel, draw,
    following, busy, sections, flows, count, step, canDraw, focusAsk, lastDraw, engine, noEngine: eng.none,
    onScan, runScan, openExisting, onDraw, startDraw, leave, askFocus,
    /** `start-source-local` / `start-source-link`; off while the panel follows a job. */
    chooseSource: (t: SourceTab) => { if (following || t === source) return; setSource(t); setError(null); setExisting(null); },
    cancelScan: () => { if (scanning?.id) void api.cancelScan(scanning.id).then(onJob, (e: Error) => setError(e.message)); },
    cancelDraw: () => { if (draw?.runId) void api.cancelRun(draw.runId).then(onJob, (e: Error) => setError(e.message)); },
    /** `start-change-folder`: back to the Folder step, the folder kept, the ticks and the channel cleared. */
    changeFolder: () => leave(false),
    /** A repository taken from a list: This computer, its path in the field, Scan focused; nothing is scanned. */
    take: (path: string) => { if (following) leave(false); setSource("local"); setError(null); setExisting(null); setFolder(path); askFocus("scan"); },
    /** `Ctrl K`: This computer and the folder field focused, after freeing the panel (as `draw-another`) when it follows a job. */
    fresh: () => { if (following) leave(true); setSource("local"); askFocus("folder"); },
    /** `home-nav-new`: as `draw-another` (the fields emptied), then This computer and the folder field focused. */
    newDrawing: () => { leave(true); setSource("local"); askFocus("folder"); },
  };
}

/** `start-steps`: four steps, the one the panel is on `now`, those before it `done`; narrow windows write only the current name. */
export function Stepper({ step, narrow }: { step: Step; narrow: boolean }) {
  const at = STEPS.indexOf(step);
  return (
    <ol className="hm-stepper" data-testid="start-steps" aria-label="Steps">
      {STEPS.map((name, i) => (
        <li key={name} data-state={i === at ? "now" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="b">{i + 1}</span>{(!narrow || i === at) && <span className="l">{name}</span>}
        </li>
      ))}
    </ol>
  );
}

function Option({ o, look, checked, onToggle }: { o: FocusOption; look: { k: string; icon: string }; checked: boolean; onToggle: () => void }) {
  const [all, setAll] = useState(false);
  const files = all ? o.files : o.files.slice(0, SHOWN_FILES);
  const more = o.files.length - files.length;
  return (
    <label className="hm-opt" data-testid="focus-option" data-option={o.id} data-kind={o.kind} style={{ "--k": `var(--k-${look.k})` } as React.CSSProperties}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="ico" aria-hidden="true"><Icon name={look.icon} size={18} /></span>
      <span className="tx">
        <b>{o.title}</b>
        <span className="sentence">{o.sentence}</span>
        {o.files.length > 0 && (
          <span className="files" data-testid="focus-option-files">
            {files.map((f) => <code key={f}>{f}</code>)}
            {more > 0 && <button type="button" className="more" data-testid="focus-option-files-more" onClick={(e) => { e.preventDefault(); setAll(true); }}>+{more} more</button>}
          </span>
        )}
      </span>
      <span className="tick" aria-hidden="true"><Icon name="check" size={12} stroke={2.6} /></span>
    </label>
  );
}

function Tickable({ testId, kind, title, line, icon, hue, checked, onToggle }: { testId: string; kind: string; title: string; line?: string; icon: string; hue: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="hm-opt wide" data-testid={testId} data-kind={kind} style={{ "--k": hue } as React.CSSProperties}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="tx"><b>{title}</b>{line && <span className="sentence">{line}</span>}</span>
      <span className="tick" aria-hidden="true"><Icon name="check" size={12} stroke={2.6} /></span>
    </label>
  );
}

function Rows({ rows, channel }: { rows: DrawChoiceState[]; channel: DrawChannel | null }) {
  const chosen = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];
  const stageText = (row: DrawChoiceState, s: Stage) =>
    s === "read" ? "Reading the code" : s === "overview" ? (row.kind === "system" ? "Drawing the map" : "Drawing the overview") : chosen.stage;
  return (
    <div className="hm-runs">
      {rows.map((row) => (
        <div key={row.id} className="hm-run" data-testid="draw-choice" data-choice={row.id} data-kind={row.kind} data-state={row.status}>
          <b data-testid="draw-choice-title">{row.title}</b>
          <ol className="hm-stages">
            {STAGES.map((s) => <li key={s} className="hm-stage" data-testid="draw-stage" data-stage={s} data-state={stageState(row, s)}><span>{stageText(row, s)}</span><i aria-hidden="true" /></li>)}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function StartPanel({ s, sources, scanWaits, narrow, folderRef, scanRef }: {
  s: StartState; sources: Sources | null; scanWaits: boolean; narrow: boolean;
  folderRef: React.RefObject<HTMLInputElement | null>; scanRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const textEl = useRef<HTMLInputElement>(null);
  const { scan, draw, ticked, setTicked } = s;
  // Ticking Something else puts the cursor in its field.
  useEffect(() => { if (ticked.typed) textEl.current?.focus(); }, [ticked.typed]);
  useEffect(() => {
    if (!s.focusAsk) return;
    (s.focusAsk.el === "folder" ? folderRef : scanRef).current?.focus();
  }, [s.focusAsk]);

  const toggleOption = (id: string) => setTicked((t) => ({ ...t, options: t.options.includes(id) ? t.options.filter((x) => x !== id) : [...t.options, id] }));
  // On the choosing step, Enter on a focused choice or destination presses the draw button when it is enabled.
  const enterDraws = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (e.key !== "Enter" || el.tagName !== "INPUT" || (el.type !== "checkbox" && el.type !== "radio")) return;
    e.preventDefault(); s.onDraw();
  };
  const choosing = scan && draw?.status !== "running";
  const drawn = CHANNELS.find((c) => c.id === s.channel);
  const looks = new Map(s.sections.map((o, i) => [o.id, SECTION_LOOKS[i % SECTION_LOOKS.length]]));

  return (
    <section className="hm-start" data-testid="start" id="start" aria-label="Draw a project">
      <div className="deco" aria-hidden="true" />
      <div className="hm-start-head">
        <h1>Draw a project</h1>
        <Stepper step={s.step} narrow={narrow} />
      </div>
      <div className="hm-start-body">
        <SourceRow s={s} sources={sources} folderRef={folderRef} scanRef={scanRef} />
        {s.error && <p className="hm-error" data-testid="start-error" role="alert">{s.error}</p>}
        {s.existing && (
          <div className="hm-existing" data-testid="start-existing">
            <p>This folder already has a drawing.</p>
            <button type="button" className="btn primary small" data-testid="start-open-existing" onClick={() => void s.openExisting()}>Open it</button>
            <button type="button" className="btn small" data-testid="start-again" onClick={() => void s.runScan(s.existing!.target, false)}>Start again</button>
          </div>
        )}
        {s.scanning && (
          <div className="hm-scan-live" data-testid="scan-progress" role="status">
            <span className="hm-spin" aria-hidden="true" />
            <div className="txt"><b>{scanWaits ? "Waiting for a free engine" : "Scanning"}</b><span>{s.scanning.line}</span><div className="hm-track"><i /></div></div>
            <button type="button" className="btn small" data-testid="scan-cancel" disabled={!s.scanning.id} onClick={s.cancelScan}>Cancel</button>
          </div>
        )}
        {draw?.status === "running" && (
          <div className="hm-drawing" data-testid="draw-progress" role="status">
            <Rows rows={draw.rows} channel={s.lastDraw.current?.channel ?? s.channel} />
            <div className="hm-log">
              <span className="hm-spin small" aria-hidden="true" />
              <span data-testid="draw-line">{draw.line}</span>
              <button type="button" className="btn small hm-ghost" data-testid="draw-another" onClick={() => s.leave(true)}>Draw another project</button>
              <button type="button" className="btn small" data-testid="draw-cancel" disabled={!draw.runId} onClick={s.cancelDraw}>Cancel</button>
            </div>
          </div>
        )}
        {draw?.status === "failed" && (
          <div className="hm-draw-error" data-testid="draw-error" role="alert">
            <Rows rows={draw.rows} channel={s.lastDraw.current?.channel ?? s.channel} />
            <div className="hm-log bad">
              <span>{draw.error}</span>
              <button type="button" className="btn small hm-ghost" data-testid="draw-another" onClick={() => s.leave(true)}>Draw another project</button>
              <button type="button" className="btn small" data-testid="draw-retry" onClick={() => s.lastDraw.current && void s.startDraw(s.lastDraw.current)}>Try again</button>
            </div>
          </div>
        )}
        {choosing && (
          <>
            <div className="hm-focus" data-testid="focus-list" role="group" aria-labelledby="focus-heading" onKeyDown={enterDraws}>
            <div className="hm-q"><h2 id="focus-heading">What should it draw?</h2>{s.count > 0 && <span className="cnt" data-testid="focus-count">{s.count} chosen</span>}</div>
            <div className="hm-opts">
              <Tickable testId="focus-whole" kind="system" title="The whole system" line="A map of the main parts; open each one for its inside" icon="layers" hue="var(--accent)"
                checked={ticked.whole} onToggle={() => setTicked((t) => ({ ...t, whole: !t.whole }))} />
              {!scan.options.length && <p className="hm-focus-none" data-testid="focus-none">The scan found no sections or flows. Draw the whole system, or say what to draw.</p>}
              {s.sections.length > 0 && (
                <div className="hm-grp" data-testid="focus-sections" role="group" aria-label="Sections">
                  <h3>Sections</h3>
                  {s.sections.map((o) => <Option key={o.id} o={o} look={looks.get(o.id)!} checked={ticked.options.includes(o.id)} onToggle={() => toggleOption(o.id)} />)}
                </div>
              )}
              {s.flows.length > 0 && (
                <div className="hm-grp" data-testid="focus-flows" role="group" aria-label="Flows">
                  <h3>Flows</h3>
                  {s.flows.map((o) => <Option key={o.id} o={o} look={{ k: "worker", icon: "flow" }} checked={ticked.options.includes(o.id)} onToggle={() => toggleOption(o.id)} />)}
                </div>
              )}
              <Tickable testId="focus-typed" kind="custom" title="Something else" icon="pen" hue="var(--muted)"
                checked={ticked.typed} onToggle={() => setTicked((t) => ({ ...t, typed: !t.typed }))} />
              {ticked.typed && (
                <div className="hm-typed">
                  <input ref={textEl} type="text" data-testid="focus-text" aria-label="What should the drawing explain?" placeholder="What should the drawing explain?" maxLength={300}
                    value={s.text} onChange={(e) => s.setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); s.onDraw(); } }} />
                </div>
              )}
            </div>
            </div>
            {s.count > 0 && (
              <>
                <div className="hm-q"><h2>Where will it go?</h2></div>
                <div className="hm-dests" role="radiogroup" aria-label="Where will it go?" onKeyDown={enterDraws}>
                  {CHANNELS.map((c) => (
                    <label key={c.id} className="hm-dest">
                      <input type="radio" name="start-channel" data-testid={`channel-choice-${c.id}`} checked={s.channel === c.id} onChange={() => s.setChannel(c.id)} />
                      <span className="frame" aria-hidden="true"><i style={{ width: c.page.w, height: c.page.h }} /></span>
                      <span className="row"><span><b>{c.label}</b><small>{c.size}</small></span><span className="tick" aria-hidden="true" /></span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="hm-go">
              <span className="sum" data-testid="draw-summary">
                {s.count === 0 ? "Pick at least one" : <><b>{s.count} {s.count === 1 ? "drawing" : "drawings"}</b>{drawn ? drawn.summary : ": choose where it will go"}</>}
              </span>
              <button type="button" className="btn hm-ghost" data-testid="start-change-folder" onClick={s.changeFolder}>Change folder</button>
              <button type="button" className="btn primary lg" data-testid="draw-start" disabled={!s.canDraw} onClick={s.onDraw}>
                {s.count > 1 ? `Draw all ${s.count}` : "Draw it"} <Icon name="send" size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** `scan-card`: the repository the followed scan read, in the side column in place of `home-continue`. */
export function ScanCard({ s }: { s: StartState }) {
  const scan = s.scan!;
  const { card } = scan;
  return (
    <section className="hm-panel hm-proj" data-testid="scan-card" aria-label="Project">
      <header>Project <button type="button" className="btn small hm-ghost" data-testid="scan-again" disabled={s.busy} onClick={() => void s.runScan(scan.target, true)}>Scan again</button></header>
      <div className="pad">
        <b className="name" data-testid="scan-card-name">{card.name}</b>
        {scan.link && <span className="link" data-testid="scan-card-link">{scan.link}</span>}
        <p data-testid="scan-card-sentence">{card.sentence}</p>
        <div className="hm-tags">
          <span className="hm-tag" data-testid="scan-card-type" data-type={card.type} style={{ "--k": "var(--k-client)" } as React.CSSProperties}><i />{TYPES[card.type]}</span>
          <span className="hm-tags" data-testid="scan-card-languages">
            {card.languages.map((l, i) => <span key={l} className="hm-tag" style={{ "--k": `var(--k-${LANGUAGE_HUES[i % LANGUAGE_HUES.length]})` } as React.CSSProperties}><i />{l}</span>)}
          </span>
        </div>
        <dl className="hm-kv">
          {card.entryPoints.map((p, i) => <div key={p}><dt>{i === 0 ? "Entry" : ""}</dt><dd data-testid="scan-card-entry">{p}</dd></div>)}
          {scan.commit && <div><dt>Commit</dt><dd data-testid="scan-card-commit">{scan.commit.slice(0, 7)}</dd></div>}
        </dl>
        {scan.cached && <p className="cached" data-testid="scan-cached">Scanned before at {(scan.commit ?? "").slice(0, 7)}</p>}
      </div>
    </section>
  );
}
