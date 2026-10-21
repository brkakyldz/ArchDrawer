import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DiagramSummary, type DrawChannel, type DrawFocus, type EngineInfo, type FocusOption, type RepoCard, type ScanRecord } from "../api";
import { navigate } from "../App";
import { chooseEngine, engineName, ENGINE_KEY, modelKey, rememberedModel } from "../editor/runner";

/**
 * Starting a drawing from a folder (ui contract, Starting a drawing from a folder; START-4): four
 * choices — folder, focus, channel, draw — each kept while the user goes on. The server checks the
 * folder, scans it and draws it (api contract, Folders, Scans, The draw run).
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

type Focus = { kind: "option"; option: string } | { kind: "whole" } | { kind: "typed" } | null;
interface Scan { id: string; folder: string; card: RepoCard; options: FocusOption[]; cached: boolean; commit: string | null }
interface Draw { status: "running" | "failed"; stage: Stage | null; line: string; error: string | null; runId: string | null }

const UNREACHABLE = "Could not reach the archdrawer server";
type End = { status: string; error: string | null; diagramId?: string | null };

/**
 * Follow a scan's or a run's event stream until it is done. When the stream drops, its record is
 * read instead until it has finished; three failed reads in a row mean the server is gone.
 */
function follow(url: string, record: () => Promise<End>, onProgress: (data: { message: string; stage?: Stage | null }) => void, live: Set<() => void>): Promise<End> {
  return new Promise((done) => {
    let over = false, timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(url);
    const stop = () => { over = true; es.close(); if (timer) clearTimeout(timer); live.delete(stop); };
    live.add(stop);
    const finish = (e: End) => { if (!over) { stop(); done(e); } };
    es.addEventListener("progress", (ev) => onProgress(JSON.parse((ev as MessageEvent).data)));
    es.addEventListener("done", (ev) => finish(JSON.parse((ev as MessageEvent).data)));
    let misses = 0;
    const poll = () => {
      if (over) return;
      record().then((r) => { misses = 0; if (r.status !== "running") finish(r); else timer = setTimeout(poll, 1000); },
        () => { if (++misses >= 3) finish({ status: "failed", error: UNREACHABLE }); else timer = setTimeout(poll, 1000); });
    };
    es.onerror = () => { if (over) return; es.close(); if (!timer) poll(); };
  });
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
  const [focus, setFocus] = useState<Focus>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<DrawChannel | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const textEl = useRef<HTMLInputElement>(null);
  const lastDraw = useRef<Parameters<typeof api.startDraw>[0] | null>(null);
  // Open streams, closed when the screen goes; a draw that ends after that opens nothing.
  const live = useRef(new Set<() => void>());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; for (const stop of [...live.current]) stop(); }, []);

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
    setError(null); setExisting(null); setDraw(null); setScan(null); setFocus(null); setChannel(null);
    let check;
    try { check = await api.checkFolder(folder); } catch (e) { setError(folderSentence((e as Error).message)); return; }
    if (check.drawing) { setExisting({ drawing: check.drawing, folder: check.folder }); return; }
    await runScan(check.folder, false);
  };

  const runScan = async (path: string, refresh: boolean) => {
    if (!engine) return;
    setError(null); setExisting(null); setDraw(null); setScan(null); setFocus(null); setChannel(null);
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

  const drawFocus = (): DrawFocus | null =>
    focus?.kind === "option" ? { kind: "option", option: focus.option } : focus?.kind === "whole" ? { kind: "whole" } : focus?.kind === "typed" && text.trim() ? { kind: "typed", text: text.trim() } : null;
  const canDraw = !!scan && !!channel && !!drawFocus() && !busy && !!engine;

  const startDraw = async (body: Parameters<typeof api.startDraw>[0]) => {
    lastDraw.current = body;
    setError(null);
    setDraw({ status: "running", stage: null, line: "Starting", error: null, runId: null });
    let runId: string;
    try { runId = await api.startDraw(body); } catch (e) { setDraw({ status: "failed", stage: null, line: "", error: e instanceof ApiError ? e.message : "Could not start the drawing", runId: null }); return; }
    setDraw((d) => (d ? { ...d, runId } : d));
    const end = await follow(`/api/runs/${runId}/events`, () => api.run(runId), (p) => setDraw((d) => (d ? { ...d, line: p.message, stage: p.stage ?? d.stage } : d)), live.current);
    if (!mounted.current) return;
    if (end.status === "succeeded" && end.diagramId) { navigate(`/d/${end.diagramId}?channel=${body.channel}`); return; }
    setDraw({ status: "failed", stage: null, line: "", error: end.status === "cancelled" ? "Cancelled" : end.error ?? "The drawing failed", runId: null });
  };
  const onDraw = () => {
    const f = drawFocus();
    if (!canDraw || !f || !scan || !channel || !engine) return;
    void startDraw({ scan: scan.id, focus: f, channel, engine: engine.id, model: model || null });
  };

  // Choosing a focus of one's own puts the cursor in its field.
  useEffect(() => { if (focus?.kind === "typed") textEl.current?.focus(); }, [focus?.kind]);

  const stageState = (s: Stage) => {
    if (!draw || draw.status !== "running") return "waiting";
    const at = draw.stage ? STAGES.indexOf(draw.stage) : -1, me = STAGES.indexOf(s);
    return me < at ? "done" : me === at ? "running" : "waiting";
  };
  const chosenChannel = CHANNELS.find((c) => c.id === (lastDraw.current?.channel ?? channel)) ?? CHANNELS[0];

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
          <fieldset className="start-choice" disabled={busy}>
            <legend>What should the drawing explain?</legend>
            {scan.options.map((o) => (
              <label key={o.id} className="focus-option" data-testid="focus-option" data-option={o.id} data-kind={o.kind}>
                <input type="radio" name="start-focus" checked={focus?.kind === "option" && focus.option === o.id} onChange={() => setFocus({ kind: "option", option: o.id })} />
                <span><b>{o.title}</b><span>{o.sentence}</span>
                  <span className="files" data-testid="focus-option-files">{o.files.map((f) => <code key={f}>{f}</code>)}</span>
                </span>
              </label>
            ))}
            <label className="focus-option">
              <input type="radio" name="start-focus" data-testid="focus-whole" checked={focus?.kind === "whole"} onChange={() => setFocus({ kind: "whole" })} />
              <span><b>The whole system</b></span>
            </label>
            <label className="focus-option">
              <input type="radio" name="start-focus" data-testid="focus-typed" checked={focus?.kind === "typed"} onChange={() => setFocus({ kind: "typed" })} />
              <span><b>Something else</b></span>
            </label>
            {focus?.kind === "typed" && (
              <input ref={textEl} type="text" data-testid="focus-text" aria-label="What should the drawing explain?" placeholder="What should the drawing explain?" maxLength={300}
                value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onDraw(); } }} />
            )}
          </fieldset>
          {focus && (
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
          <button className="btn primary" data-testid="draw-start" disabled={!canDraw} onClick={onDraw}>Draw it</button>
        </>
      )}
      {draw?.status === "running" && (
        <div className="start-progress draw" data-testid="draw-progress" role="status">
          <ol>
            {STAGES.map((s) => (
              <li key={s} data-testid="draw-stage" data-stage={s} data-state={stageState(s)}>
                {s === "read" ? "Reading the code" : s === "overview" ? "Drawing the overview" : chosenChannel.stage}
              </li>
            ))}
          </ol>
          <span data-testid="draw-line">{draw.line}</span>
          <button className="btn small" data-testid="draw-cancel" disabled={!draw.runId} onClick={() => draw.runId && void api.cancelRun(draw.runId).catch((e: Error) => setError(e.message))}>Cancel</button>
        </div>
      )}
      {draw?.status === "failed" && (
        <div className="draw-error" data-testid="draw-error" role="alert">
          <span>{draw.error}</span>
          <button className="btn small" data-testid="draw-retry" onClick={() => lastDraw.current && void startDraw(lastDraw.current)}>Try again</button>
        </div>
      )}
    </section>
  );
}


