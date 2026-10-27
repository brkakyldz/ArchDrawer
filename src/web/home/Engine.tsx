import { useEffect, useState } from "react";
import { api, type EngineInfo } from "../api";
import { chooseEngine, engineName, ENGINE_KEY, modelKey, rememberedModel } from "../editor/runner";

/**
 * The engine the home screen scans and draws with (ui contract, *The engine*): `ai-engine` and `ai-model` share
 * their stored choice with the editor's AI panel, so a change in either place shows in the other.
 */
export interface EngineState {
  engines: EngineInfo[] | null;
  engine: EngineInfo | null;
  model: string;
  /** No engine is available (the list answered and holds none). */
  none: boolean;
  /** The engine list could not be read. */
  error: string | null;
  pick: (id: string) => void;
  pickModel: (m: string) => void;
}

export function useEngine(): EngineState {
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => { try { return localStorage.getItem(ENGINE_KEY); } catch { return null; } });
  const [models, setModels] = useState<Record<string, string>>({});
  useEffect(() => { api.engines().then(setEngines, (e: Error) => { setEngines([]); setError(e.message); }); }, []);
  const engine = engines ? chooseEngine(engines, { engine: null }, chosen) : null;
  const model = engine ? models[engine.id] ?? rememberedModel(engine) : "";
  return {
    engines, engine, model, error, none: engines !== null && !engine && !error,
    pick: (id) => { try { localStorage.setItem(ENGINE_KEY, id); } catch { /* private mode */ } setChosen(id); },
    pickModel: (m) => {
      if (!engine) return;
      try { localStorage.setItem(modelKey(engine.id), m); } catch { /* private mode */ }
      setModels((x) => ({ ...x, [engine.id]: m }));
    },
  };
}

export function focusEngine() {
  document.querySelector('[data-testid="start-engine"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  document.querySelector<HTMLSelectElement>('[data-testid="ai-engine"]')?.focus({ preventScroll: true });
}

/** `home-engine-chip`: a dot and `Engine <label>`; absent without an engine. */
export function EngineChip({ engine }: { engine: EngineInfo | null }) {
  if (!engine) return null;
  return (
    <button type="button" className="hm-engine-chip" data-testid="home-engine-chip" onClick={focusEngine}>
      <span className="hm-dot" aria-hidden="true" /><span className="lbl">Engine</span>{" "}<b>{engineName(engine)}</b>
    </button>
  );
}

/** The side column's `Engine` panel: the agent, the model and what the engine is allowed to do. */
export function EnginePanel({ state, busy, example }: { state: EngineState; busy: boolean; example: React.ReactNode }) {
  const { engines, engine, model } = state;
  return (
    <section className="hm-panel" data-testid="start-engine" aria-label="Engine">
      <header>Engine</header>
      <div className="pad">
        {engine && engines && (
          <>
            <label className="hm-sel"><span>Agent</span>
              <select data-testid="ai-engine" value={engine.id} disabled={busy} onChange={(e) => state.pick(e.target.value)}>
                {engines.filter((e) => e.available).map((e) => <option key={e.id} value={e.id}>{engineName(e)}</option>)}
              </select>
            </label>
            <label className="hm-sel"><span>Model</span>
              <select data-testid="ai-model" value={model} disabled={busy} onChange={(e) => state.pickModel(e.target.value)}>
                <option value="">Default</option>
                {engine.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <p className="hm-status" data-testid="start-engine-status"><span className="hm-dot" aria-hidden="true" />{engineName(engine)}{engine.version ? ` ${engine.version}` : ""} · reads only</p>
          </>
        )}
        {state.none && (
          <div className="hm-no-engine" data-testid="start-no-engine">
            <p>To draw a project, install Claude Code or Codex and sign in to it.</p>
            <code>npm install -g @anthropic-ai/claude-code</code>
            <code>npm install -g @openai/codex</code>
            {example}
          </div>
        )}
        {state.error && <p className="hm-status bad">{state.error}</p>}
      </div>
    </section>
  );
}
