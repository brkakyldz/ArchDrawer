import { useEffect, useRef, useState } from "react";
import { summarize } from "../../core/diff";
import type { RunScope } from "../../core/repair";
import { SIMPLIFY_INSTRUCTION } from "../../core/simplify";
import type { EngineInfo } from "../api";
import { Icon } from "../ui/Icon";
import { LayoutReportLine } from "../ui/LayoutReport";
import { engineName, type Runner } from "./runner";

export type ScopeChoice = "view" | "selection" | "all";

interface Props {
  runner: Runner;
  /** A part's or connection's name for report warnings. */
  nameOf?: (id: string) => string;
  engines: EngineInfo[];
  engine: EngineInfo | null;
  model: string;
  onEngine: (id: string) => void;
  onModel: (id: string) => void;
  /** The components selected on the canvas (the `selection` scope). */
  selected: string[];
  /** What the panel opens with: text moved from the ask box, or a component's "Change this part". */
  initial: { text: string; scope: ScopeChoice; at: number };
  /** The first view: a simplification always works on it, and the editor shows it. */
  overview: string;
  onOverview: () => void;
  onClose: () => void;
}

const FIXTURE_NOTE = "Test engine (no AI): it understands only add, remove, rename, hold, move and align, gives a canned post and a canned simplification, and changes nothing else";
const SAVED = "Saved in the file for your next archdrawer session";

/** The AI panel (ui contract): a longer instruction with the engine, model and scope chosen. Not modal. */
export function AiPanel({ runner, engines, engine, model, onEngine, onModel, selected, initial, overview, onOverview, onClose, nameOf }: Props) {
  const [text, setText] = useState(initial.text);
  const [scope, setScope] = useState<ScopeChoice>(initial.scope);
  const input = useRef<HTMLTextAreaElement>(null);
  const { state } = runner;
  const mine = state.req?.origin === "panel";
  const running = state.status === "running";
  const available = engines.filter((e) => e.available);

  useEffect(() => {
    setText(initial.text); setScope(initial.scope);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [initial]);
  // The selection scope needs a selected component; losing it falls back to the view.
  useEffect(() => { if (scope === "selection" && !selected.length) setScope("view"); }, [scope, selected.length]);

  const toScope = (): RunScope => (scope === "selection" && selected.length ? { kind: "parts", ids: selected } : scope === "all" ? { kind: "all" } : { kind: "view" });
  const send = () => {
    const instruction = text.trim();
    if (!instruction || running) return;
    void runner.start({ instruction, engine: engine?.id ?? null, model: model || null, scope: toScope(), origin: "panel" });
  };
  // The overview becomes a map; without an engine the instruction is saved for the overview.
  const simplify = () => {
    if (running) return;
    setText(SIMPLIFY_INSTRUCTION); setScope("view"); onOverview();
    void runner.start({ instruction: SIMPLIFY_INSTRUCTION, engine: engine?.id ?? null, model: model || null, scope: { kind: "view" }, origin: "panel", view: overview, kind: "simplify" });
  };
  // A successful run clears the instruction (ui contract); a failed one keeps it.
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (mine && state.status === "succeeded" && state.id && done.current !== state.id) { done.current = state.id; setText(""); }
  }, [mine, state.status, state.id]);

  const c = mine && state.status === "succeeded" ? state.changes : null;

  return (
    <aside className="ai-panel" data-testid="ai-panel" aria-label="Change the drawing with AI" onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <header>
        <span className="spark"><Icon name="spark" size={17} /></span>
        <h2>Change the drawing</h2>
        <button className="x" data-testid="ai-close" aria-label="Close the AI panel" onClick={onClose}><Icon name="close" size={15} /></button>
      </header>

      <div className="bd">
        <textarea ref={input} data-testid="ai-input" value={text} maxLength={4000} rows={5} aria-label="Instruction"
          placeholder="Say what to change: add a cache between the API and the database, put the workers in one row…"
          onChange={(e) => { setText(e.target.value); if (mine && !running) runner.clear(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />

        <fieldset className="scope" disabled={running}>
          <legend>Change</legend>
          <label><input type="radio" name="ai-scope" data-testid="ai-scope-view" checked={scope === "view"} onChange={() => setScope("view")} /> This view</label>
          <label className={selected.length ? "" : "off"}>
            <input type="radio" name="ai-scope" data-testid="ai-scope-selection" checked={scope === "selection"} disabled={!selected.length} onChange={() => setScope("selection")} />
            {` Selected parts (${selected.length})`}
          </label>
          <label><input type="radio" name="ai-scope" data-testid="ai-scope-all" checked={scope === "all"} onChange={() => setScope("all")} /> The whole channel</label>
        </fieldset>

        <button className="btn wide" data-testid="simplify-overview" disabled={running} onClick={simplify}>
          <Icon name="layers" size={15} /> Simplify the overview
        </button>

        {engine && (
          <div className="pick">
            <label>
              <span>Engine</span>
              <select data-testid="ai-engine" value={engine.id} disabled={running} onChange={(e) => onEngine(e.target.value)}>
                {available.map((e) => <option key={e.id} value={e.id}>{engineName(e)}</option>)}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select data-testid="ai-model" value={model} disabled={running} onChange={(e) => onModel(e.target.value)}>
                <option value="">Default</option>
                {engine.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
        )}
        <p className={`engine-note${engine?.test ? " test" : ""}`} data-testid="ai-engine-note">
          {!engine ? "No engine is available: the instruction is saved in the file for your next archdrawer session"
            : engine.test ? FIXTURE_NOTE : `${engine.label} reads the repository (read-only) and changes the drawing`}
        </p>

        {running && (
          <div className="progress" data-testid="ai-progress" role="status">
            <ol>{state.lines.map((l, i) => <li key={`${i}-${l}`} data-testid="ai-progress-line">{l}</li>)}</ol>
            <button className="btn small" data-testid="ai-cancel" onClick={runner.cancel}>Cancel</button>
          </div>
        )}
        {mine && !running && state.error && (
          <div className="result err" data-testid="ai-error" role="alert">
            <span>{state.error}</span>
            <button className="btn small" data-testid="ai-retry" onClick={runner.retry}>Try again</button>
          </div>
        )}
        {c && (
          <div className="result ok" data-testid="ai-summary" role="status"
            data-added={c.added.length} data-removed={c.removed.length} data-changed={c.changed.length} data-moved={c.moved.length}
            data-edges-added={c.edgesAdded.length} data-edges-removed={c.edgesRemoved.length} data-edges-changed={c.edgesChanged.length}>
            {summarize(c)}
          </div>
        )}
        {mine && state.status === "succeeded" && state.layoutReport && <LayoutReportLine report={state.layoutReport} nameOf={nameOf} />}
        {mine && state.status === "saved" && <div className="result" data-testid="ai-saved">{SAVED}</div>}
      </div>

      <footer>
        <span className="hint"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
        <button className="btn primary" data-testid="ai-send" disabled={!text.trim() || running} onClick={send}><Icon name="send" size={15} /> Send</button>
      </footer>
    </aside>
  );
}
