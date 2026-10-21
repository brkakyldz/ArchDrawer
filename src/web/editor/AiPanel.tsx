import { useEffect, useRef, useState } from "react";
import { summarize, type Changes } from "../../core/diff";
import type { RunScope } from "../../core/repair";
import type { EngineInfo } from "../api";
import { Icon } from "../ui/Icon";
import { LayoutReportLine } from "../ui/LayoutReport";
import type { ChannelId } from "../../core/file3";
import { engineName, ROUTE_SENTENCE, type Runner, type Turn } from "./runner";
import { SUGGESTIONS, type Suggestion } from "./suggestions";

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
  /** The scope the panel opens with (a component's "Change this part" chooses the selection); `at` marks each opening. */
  initial: { scope: ScopeChoice; at: number };
  /** What is typed in `ai-input`; the editor keeps it across channels. */
  text: string;
  setText: (t: string) => void;
  /** The current channel has no view: nothing to change there (ui contract, ai-send). */
  blank: boolean;
  /** The current channel: its suggestions (ui contract, Suggestions). */
  channel: ChannelId;
  /** The overview's first view, where `Simpler` runs; the editor goes there first. */
  overview: string;
  onOverview: () => void;
  onClose: () => void;
}

const FIXTURE_NOTE = "Test engine (no AI): it understands only add, remove, rename, hold, move and align, gives a canned post, a canned simplification and a canned second look, and changes nothing else";
const SAVED = "Saved in the file for your next archdrawer session";

/** The change summary with its counts (ui contract, ai-summary). */
function Summary({ c }: { c: Changes }) {
  return (
    <div className="result ok" data-testid="ai-summary" role="status"
      data-added={c.added.length} data-removed={c.removed.length} data-changed={c.changed.length} data-moved={c.moved.length}
      data-edges-added={c.edgesAdded.length} data-edges-removed={c.edgesRemoved.length} data-edges-changed={c.edgesChanged.length}>
      {summarize(c)}
    </div>
  );
}

const succeeded = (t: Turn) => t.state === "preview" || t.state === "accepted" || t.state === "undone" || t.state === "unchanged";

/**
 * One turn of the conversation (ui contract, The conversation): what was asked and where, its state,
 * and its result. Only the latest turn holds the progress, the error with its retry, the summary, the
 * route and the report; an earlier one keeps its result as one line.
 */
function TurnView({ turn, latest, runner, nameOf }: { turn: Turn; latest: boolean; runner: Runner; nameOf?: (id: string) => string }) {
  const result = turn.state === "saved" ? SAVED : turn.error ?? (turn.changes ? summarize(turn.changes) : null);
  return (
    <li className={`turn ${turn.state}`} data-testid="ai-turn" data-state={turn.state} {...(turn.runId ? { "data-run-id": turn.runId } : {})}>
      <p className="turn-text" data-testid="ai-turn-text">{turn.text}</p>
      <p className="turn-where" data-testid="ai-turn-where">{turn.where}</p>
      {!latest ? (result && <p className={`turn-result${turn.error ? " err" : ""}`} data-testid="ai-turn-result">{result}</p>) : <>
        {turn.state === "running" && (
          <div className="progress" data-testid="ai-progress" role="status">
            <ol>{turn.lines.map((l, i) => <li key={`${i}-${l}`} data-testid="ai-progress-line">{l}</li>)}</ol>
            <button className="btn small" data-testid="ai-cancel" onClick={runner.cancel}>Cancel</button>
          </div>
        )}
        {(turn.state === "failed" || turn.state === "cancelled") && (
          <div className="result err" data-testid="ai-error" role="alert">
            <span>{turn.error}</span>
            <button className="btn small" data-testid="ai-retry" onClick={runner.retry}>Try again</button>
          </div>
        )}
        {succeeded(turn) && turn.changes && <Summary c={turn.changes} />}
        {succeeded(turn) && turn.route && <div className="result route" data-testid="ai-route" data-route={turn.route}>{ROUTE_SENTENCE[turn.route]}</div>}
        {succeeded(turn) && turn.layoutReport && <LayoutReportLine report={turn.layoutReport} nameOf={nameOf} />}
        {turn.state === "saved" && <div className="result" data-testid="ai-saved">{SAVED}</div>}
      </>}
    </li>
  );
}

/** The AI panel (ui contract): the one place to type, the conversation of the open drawing, the engine, model and scope. Not modal. */
export function AiPanel({ runner, engines, engine, model, onEngine, onModel, selected, initial, text, setText, blank, channel, overview, onOverview, onClose, nameOf }: Props) {
  const [scope, setScope] = useState<ScopeChoice>(initial.scope);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLOListElement>(null);
  const { state, turns } = runner;
  const running = state.status === "running";
  const available = engines.filter((e) => e.available);

  useEffect(() => {
    setScope(initial.scope);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [initial]);
  // The selection scope needs a selected component; losing it falls back to the view.
  useEffect(() => { if (scope === "selection" && !selected.length) setScope("view"); }, [scope, selected.length]);
  // The latest turn stays in sight.
  const last = turns[turns.length - 1];
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [turns.length, last?.state, last?.lines.length]);

  const toScope = (): RunScope => (scope === "selection" && selected.length ? { kind: "parts", ids: selected } : scope === "all" ? { kind: "all" } : { kind: "view" });
  const canSend = !!text.trim() && !running && !blank;
  const send = () => {
    if (!canSend) return;
    void runner.start({ instruction: text.trim(), typed: true, engine: engine?.id ?? null, model: model || null, scope: toScope(), origin: "panel" });
  };
  // A suggestion is sent as a typed instruction would be, with the view as its scope, and leaves the input as it is.
  const suggest = (s: Suggestion) => {
    if (running || blank) return;
    const base = { instruction: s.instruction, label: s.label, engine: engine?.id ?? null, model: model || null, scope: { kind: "view" } as RunScope, origin: "panel" as const };
    if (s.kind === "simplify") { onOverview(); void runner.start({ ...base, view: overview, kind: "simplify" }); }
    else void runner.start(base);
  };
  const placeholder = !engine ? "Ask Claude to change this drawing"
    : engine.test ? "Ask the test engine (no AI) to change this drawing" : `Ask ${engine.label} to change this drawing`;

  return (
    <aside className="ai-panel" data-testid="ai-panel" aria-label="Change the drawing with AI" onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <header>
        <span className="spark"><Icon name="spark" size={17} /></span>
        <h2>Change the drawing</h2>
        <button className="x" data-testid="ai-close" aria-label="Close the AI panel" onClick={onClose}><Icon name="close" size={15} /></button>
      </header>

      <div className="bd">
        <ol className="thread" data-testid="ai-thread" ref={thread} aria-label="Conversation">
          {turns.map((t, i) => <TurnView key={t.key} turn={t} latest={i === turns.length - 1} runner={runner} nameOf={nameOf} />)}
        </ol>

        <div className="suggestions" data-testid="ai-suggestions" role="group" aria-label="Suggestions">
          {SUGGESTIONS[channel].map((s) => (
            <button key={s.id} type="button" className="chip" data-testid={`ai-suggest-${s.id}`} disabled={running || blank} title={s.instruction} onClick={() => suggest(s)}>{s.label}</button>
          ))}
        </div>

        <textarea ref={input} data-testid="ai-input" value={text} maxLength={4000} rows={4} aria-label="Instruction" placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a line break (ui contract, ai-input).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />

        <fieldset className="scope" disabled={running}>
          <legend>Change</legend>
          <label><input type="radio" name="ai-scope" data-testid="ai-scope-view" checked={scope === "view"} onChange={() => setScope("view")} /> This view</label>
          <label className={selected.length ? "" : "off"}>
            <input type="radio" name="ai-scope" data-testid="ai-scope-selection" checked={scope === "selection"} disabled={!selected.length} onChange={() => setScope("selection")} />
            {` Selected parts (${selected.length})`}
          </label>
          <label><input type="radio" name="ai-scope" data-testid="ai-scope-all" checked={scope === "all"} onChange={() => setScope("all")} /> The whole channel</label>
        </fieldset>

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
      </div>

      <footer>
        <span className="hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd> <kbd>Enter</kbd> new line</span>
        <button className="btn primary" data-testid="ai-send" disabled={!canSend} onClick={send}><Icon name="send" size={15} /> Send</button>
      </footer>
    </aside>
  );
}
