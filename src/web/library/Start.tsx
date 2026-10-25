import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError, type DiagramSummary, type DrawChannel, type DrawChoiceState, type DrawFocus, type EngineInfo, type FocusOption, type RepoCard, type ScanRecord } from "../api";
import { navigate } from "../App";
import { chooseEngine, engineName, ENGINE_KEY, modelKey, rememberedModel } from "../editor/runner";
import { afterPaint, paced } from "./pace";

/**
 * Starting a drawing from a folder (ui contract, Starting a drawing from a folder; START-4): four
 * steps — folder, what to draw (one or several choices), channel, draw — each kept while the user goes
 * on. The server checks the folder, scans it and draws every choice in one run (api contract, Folders,
 * Scans, The draw run).
 */

const TYPES: Record<RepoCard["type"], string> = { agent: "AI agent project", backend: "Backend service", fullstack: "Full-stack app", other: "Other project" };
const CHANNELS: { id: DrawChannel; label: string; stage: string }[] = [
  { id: "linkedin", label: "LinkedIn post", stage: "Drawing the LinkedIn post" },
  { id: "readme", label: "README drawing", stage: "Drawing the README drawing" },
  { id: "presentation", label: "Presentation", stage: "Drawing the presentation" },
];
const STAGES = ["read", "overview", "channel"] as const;
type Stage = (typeof STAGES)[number];
const windows = typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent);

/** The server's folder refusal in one plain sentence. */
function folderSentence(message: string): string {
  if (/^Not found: /.test(message)) return "This folder does not exist.";
  if (/^Not a folder: /.test(message)) return "This is a file, not a folder.";
  if (/must be absolute|Give the absolute path/.test(message)) return "Give the whole path, starting from the drive or from /.";
  return message;
}

type Ticked = { whole: boolean; options: string[]; typed: boolean };
const NONE: Ticked = { whole: false, options: [], typed: false };
interface Scan { id: string; folder: string; card: RepoCard; options: FocusOption[]; cached: boolean; commit: string | null }
/** A draw run on the home screen: its choices as the run record lists them, the latest line, and how it ended. */
interface Draw { status: "running" | "failed"; rows: DrawChoiceState[]; line: string; error: string | null; runId: string | null }

const UNREACHABLE = "Could not reach the archdrawer server";
type End = { status: string; error: string | null; diagramId?: string | null; choice?: string; choices?: DrawChoiceState[] | null };
type Progress = { message: string; stage?: Stage | null; choice?: string | null };

/**
 * Follow a scan's or a run's event stream until it is done. When the stream drops, its record is
 * read instead until it has finished; three failed reads in a row mean the server is gone. Each
 * progress line is rendered and painted before the next (`paced`), so a burst — the replay of a
 * run's past lines, a reused stage's lines — never shows only its last line.
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

/** A row's stage as the screen shows it (ui contract, `draw-choice`). */
function stageState(row: DrawChoiceState, s: Stage): "waiting" | "running" | "done" | "failed" {
  if (row.status === "done") return "done";
  if (row.status === "waiting" || !row.stage) return "waiting";
  const at = STAGES.indexOf(row.stage), me = STAGES.indexOf(s);
  if (me < at) return "done";
  if (me > at) return "waiting";
  return row.status === "running" ? "running" : "failed";
}

/**
 * The rows after a progress line of `choice` at `stage`: earlier choices done, that one running there, later ones
 * waiting (a replay of the run's lines may start from a record read later than them).
 */
function advance(rows: DrawChoiceState[], choice: string | null | undefined, stage: Stage | null | undefined): DrawChoiceState[] {
  const at = rows.findIndex((r) => r.id === choice);
  if (at < 0) return rows;
  return rows.map((r, i) => (i < at ? { ...r, status: "done", stage: "channel" } : i === at ? { ...r, status: "running", stage: stage ?? r.stage ?? "read" } : { ...r, status: "waiting", stage: null }));
}

export function Start({ list, onExample, exampleBusy }: { list: DiagramSummary[] | null; onExample: () => void; exampleBusy: boolean }) {
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => { try { return localStorage.getItem(ENGINE_KEY); } catch { return null; } });
  const [models, setModels] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ drawing: string; folder: string } | null>(null);
  const [scanning, setScanning] = useState<{ id: string | null; line: string } | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [ticked, setTicked] = useState<Ticked>(NONE);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<DrawChannel | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const textEl = useRef<HTMLInputElement>(null);
  const lastDraw = useRef<Parameters<typeof api.startDraw>[0] | null>(null);
  // Open streams, closed when the screen goes; a draw that ends after that opens nothing.
  const live = useRef(new Set<() => void>());
  const mounted = useRef(true);
  // Set again on mount: StrictMode mounts twice in development, and a ref left false would drop every finished scan.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const stop of [...live.current]) stop(); }; }, []);

  useEffect(() => { api.engines().then(setEngines, (e: Error) => { setEngines([]); setError(e.message || UNREACHABLE); }); }, []);
  const engine = engines ? chooseEngine(engines, { engine: null }, chosen) : null;
  const model = engine ? models[engine.id] ?? rememberedModel(engine) : "";
  const noEngine = engines !== null && !engine && error !== UNREACHABLE;
  const busy = scanning !== null || draw?.status === "running";
  const roots = [...new Set((list ?? []).map((d) => d.root).filter((r): r is string => !!r))];

  const pickEngine = (id: string) => { try { localStorage.setItem(ENGINE_KEY, id); } catch { /* private mode */ } setChosen(id); };
  const pickModel = (m: string) => {
    if (!engine) return;
    try { localStorage.setItem(modelKey(engine.id), m); } catch { /* private mode */ }
    setModels((x) => ({ ...x, [engine.id]: m }));
  };

  /** Scan: the folder is checked first; one that holds a drawing is offered before anything is scanned. */
  const onScan = async () => {
    if (!engine || busy) return;
    // A new folder: the earlier card and choices go, so Draw it never draws the previous folder.
    setError(null); setExisting(null); setDraw(null); setScan(null); setTicked(NONE); setChannel(null);
    let check;
    try { check = await api.checkFolder(folder); } catch (e) { setError(folderSentence((e as Error).message)); return; }
    if (check.drawing) { setExisting({ drawing: check.drawing, folder: check.folder }); return; }
    await runScan(check.folder, false);
  };

  const runScan = async (path: string, refresh: boolean) => {
    if (!engine) return;
    setError(null); setExisting(null); setDraw(null); setScan(null); setTicked(NONE); setChannel(null);
    setScanning({ id: null, line: "Starting" });
    let id: string;
    try { id = await api.startScan(path, { engine: engine.id, model: model || null, refresh }); } catch (e) { setScanning(null); setError(folderSentence((e as Error).message)); return; }
    setScanning({ id, line: "Starting" });
    const end = await follow(`/api/scans/${id}/events`, () => api.scan(id), (p) => setScanning((s) => (s ? { ...s, line: p.message } : s)), live.current);
    if (!mounted.current) return;
    setScanning(null);
    if (end.status !== "succeeded") { setError(end.status === "cancelled" ? "Cancelled" : end.error ?? "The scan failed"); return; }
    let r: ScanRecord;
    try { r = await api.scan(id); } catch (e) { setError((e as Error).message); return; }
    setScan({ id, folder: r.folder, card: r.card!, options: r.options ?? [], cached: r.cached, commit: r.commit });
  };

  const openExisting = async () => {
    if (!existing) return;
    try { navigate(`/d/${await api.openFile(existing.drawing)}`); } catch (e) { setError((e as Error).message); }
  };

  const sections = scan?.options.filter((o) => o.kind === "section") ?? [];
  const flows = scan?.options.filter((o) => o.kind === "flow") ?? [];
  const count = (ticked.whole ? 1 : 0) + ticked.options.length + (ticked.typed ? 1 : 0);
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
    lastDraw.current = body;
    setError(null);
    setDraw((d) => ({ status: "running", rows: d?.rows ?? [], line: "Starting", error: null, runId: null }));
    let runId: string;
    try { runId = await api.startDraw(body); } catch (e) { setDraw({ status: "failed", rows: [], line: "", error: e instanceof ApiError ? e.message : "Could not start the drawing", runId: null }); return; }
    // The record lists the choices from the start; the lines then move them on.
    const first = await api.run(runId).catch(() => null);
    setDraw((d) => (d ? { ...d, runId, rows: first?.choices ?? [] } : d));
    const end = await follow(`/api/runs/${runId}/events`, () => api.run(runId) as Promise<End>,
      (p) => setDraw((d) => (d ? { ...d, line: p.message, rows: advance(d.rows, p.choice, p.stage) } : d)), live.current);
    if (!mounted.current) return;
    if (end.status === "succeeded" && end.diagramId) { navigate(`/d/${end.diagramId}?choice=${encodeURIComponent(end.choice ?? end.choices?.[0]?.id ?? "")}&channel=${body.channel}`); return; }
    const record = end.choices ? end : await api.run(runId).catch(() => null);
    setDraw((d) => ({ status: "failed", rows: record?.choices ?? d?.rows ?? [], line: "", error: end.status === "cancelled" ? "Cancelled" : end.error ?? "The drawing failed", runId: null }));
  };
  const onDraw = () => {
    const choices = drawChoices();
    if (!canDraw || !choices || !scan || !channel || !engine) return;
    void startDraw({ scan: scan.id, choices, channel, engine: engine.id, model: model || null });
  };

  // Ticking Something else puts the cursor in its field.
  useEffect(() => { if (ticked.typed) textEl.current?.focus(); }, [ticked.typed]);

  const toggleOption = (id: string) => setTicked((t) => ({ ...t, options: t.options.includes(id) ? t.options.filter((x) => x !== id) : [...t.options, id] }));
  const chosenChannel = CHANNELS.find((c) => c.id === (lastDraw.current?.channel ?? channel)) ?? CHANNELS[0];
  const stageText = (row: DrawChoiceState, s: Stage) =>
    s === "read" ? "Reading the code" : s === "overview" ? (row.kind === "system" ? "Drawing the map" : "Drawing the overview") : chosenChannel.stage;
  const rowsEl = (rows: DrawChoiceState[]) => rows.map((row) => (
    <div key={row.id} className="draw-choice" data-testid="draw-choice" data-choice={row.id} data-kind={row.kind} data-state={row.status}>
      <b data-testid="draw-choice-title">{row.title}</b>
      <ol>
        {STAGES.map((s) => <li key={s} data-testid="draw-stage" data-stage={s} data-state={stageState(row, s)}>{stageText(row, s)}</li>)}
      </ol>
    </div>
  ));
  const option = (o: FocusOption) => (
    <label key={o.id} className="focus-option" data-testid="focus-option" data-option={o.id} data-kind={o.kind}>
      <input type="checkbox" checked={ticked.options.includes(o.id)} onChange={() => toggleOption(o.id)} />
      <span><b>{o.title}</b><span>{o.sentence}</span>
        <span className="files" data-testid="focus-option-files">{o.files.map((f) => <code key={f}>{f}</code>)}</span>
      </span>
    </label>
  );

  return (
    <section className="start" data-testid="start" aria-label="Start a drawing from a folder">
      <h2>Draw a project</h2>
      <div className="start-row">
        <input type="text" data-testid="start-folder" aria-label="Folder of the project" placeholder={windows ? "C:\\code\\my-project" : "/home/me/my-project"}
          list="start-folders" value={folder} disabled={busy} onChange={(e) => setFolder(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onScan(); } }} />
        <datalist id="start-folders">{roots.map((r) => <option key={r} value={r} />)}</datalist>
        <button className="btn primary" data-testid="start-scan" disabled={!engine || busy} onClick={() => void onScan()}>Scan</button>
      </div>
      {engine && engines && (
        <div className="start-engine" data-testid="start-engine">
          <label><span>Engine</span>
            <select value={engine.id} disabled={busy} onChange={(e) => pickEngine(e.target.value)}>
              {engines.filter((e) => e.available).map((e) => <option key={e.id} value={e.id}>{engineName(e)}</option>)}
            </select>
          </label>
          <label><span>Model</span>
            <select value={model} disabled={busy} onChange={(e) => pickModel(e.target.value)}>
              <option value="">Default</option>
              {engine.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {noEngine && (
        <div className="start-no-engine" data-testid="start-no-engine">
          <p>To draw a project, install Claude Code or Codex and sign in to it.</p>
          <p><code>npm install -g @anthropic-ai/claude-code</code></p>
          <p><code>npm install -g @openai/codex</code></p>
        </div>
      )}
      {(noEngine || (list !== null && list.length === 0)) && (
        <button className="btn" data-testid="library-example" disabled={exampleBusy} onClick={onExample}>Open the example drawing</button>
      )}
      {error && <p className="start-error" data-testid="start-error" role="alert">{error}</p>}
      {existing && (
        <div className="start-existing" data-testid="start-existing">
          <p>This folder already has a drawing.</p>
          <button className="btn primary" data-testid="start-open-existing" onClick={() => void openExisting()}>Open it</button>
          <button className="btn" data-testid="start-again" onClick={() => void runScan(existing.folder, false)}>Start again</button>
        </div>
      )}
      {scanning && (
        <div className="start-progress" data-testid="scan-progress" role="status">
          <span>{scanning.line}</span>
          <button className="btn small" data-testid="scan-cancel" disabled={!scanning.id} onClick={() => scanning.id && void api.cancelScan(scanning.id).catch((e: Error) => setError(e.message))}>Cancel</button>
        </div>
      )}
      {scan && (
        <>
          <div className="scan-card" data-testid="scan-card">
            <b data-testid="scan-card-name">{scan.card.name}</b>
            <p data-testid="scan-card-sentence">{scan.card.sentence}</p>
            <p className="meta">
              <span data-testid="scan-card-type" data-type={scan.card.type}>{TYPES[scan.card.type]}</span>
              <span data-testid="scan-card-languages">{scan.card.languages.join(", ")}</span>
            </p>
            {scan.card.entryPoints.length > 0 && <p className="meta">{scan.card.entryPoints.map((p) => <code key={p} data-testid="scan-card-entry">{p}</code>)}</p>}
            {scan.cached && (
              <p className="meta">
                <span data-testid="scan-cached">Scanned before at {(scan.commit ?? "").slice(0, 7)}</span>
                <button className="btn small" data-testid="scan-again" disabled={busy} onClick={() => void runScan(scan.folder, true)}>Scan again</button>
              </p>
            )}
          </div>
          <fieldset className="start-choice" data-testid="focus-list" disabled={busy}>
            <legend>What should it draw?</legend>
            <label className="focus-option" data-testid="focus-whole" data-kind="system">
              <input type="checkbox" checked={ticked.whole} onChange={() => setTicked((t) => ({ ...t, whole: !t.whole }))} />
              <span><b>The whole system</b><span>A map of the main parts; open each one for its inside</span></span>
            </label>
            {!scan.options.length && <p className="focus-none" data-testid="focus-none">The scan found no sections or flows. Draw the whole system, or say what to draw.</p>}
            {sections.length > 0 && (
              <div className="focus-group" data-testid="focus-sections" role="group" aria-label="Sections">
                <span className="focus-heading">Sections</span>
                {sections.map(option)}
              </div>
            )}
            {flows.length > 0 && (
              <div className="focus-group" data-testid="focus-flows" role="group" aria-label="Flows">
                <span className="focus-heading">Flows</span>
                {flows.map(option)}
              </div>
            )}
            <label className="focus-option" data-testid="focus-typed" data-kind="custom">
              <input type="checkbox" checked={ticked.typed} onChange={() => setTicked((t) => ({ ...t, typed: !t.typed }))} />
              <span><b>Something else</b></span>
            </label>
            {ticked.typed && (
              <input ref={textEl} type="text" data-testid="focus-text" aria-label="What should the drawing explain?" placeholder="What should the drawing explain?" maxLength={300}
                value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onDraw(); } }} />
            )}
            {count > 0 && <span className="focus-count" data-testid="focus-count">{count} chosen</span>}
          </fieldset>
          {count > 0 && (
            <fieldset className="start-choice" disabled={busy}>
              <legend>Where will it go?</legend>
              {CHANNELS.map((c) => (
                <label key={c.id} className="channel-option">
                  <input type="radio" name="start-channel" data-testid={`channel-choice-${c.id}`} checked={channel === c.id} onChange={() => setChannel(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button className="btn primary" data-testid="draw-start" disabled={!canDraw} onClick={onDraw}>{count > 1 ? `Draw all ${count}` : "Draw it"}</button>
        </>
      )}
      {draw?.status === "running" && (
        <div className="start-progress draw" data-testid="draw-progress" role="status">
          {rowsEl(draw.rows)}
          <span data-testid="draw-line">{draw.line}</span>
          <button className="btn small" data-testid="draw-cancel" disabled={!draw.runId} onClick={() => draw.runId && void api.cancelRun(draw.runId).catch((e: Error) => setError(e.message))}>Cancel</button>
        </div>
      )}
      {draw?.status === "failed" && (
        <div className="draw-error" data-testid="draw-error" role="alert">
          <span>{draw.error}</span>
          {rowsEl(draw.rows)}
          <button className="btn small" data-testid="draw-retry" onClick={() => lastDraw.current && void startDraw(lastDraw.current)}>Try again</button>
        </div>
      )}
    </section>
  );
}
