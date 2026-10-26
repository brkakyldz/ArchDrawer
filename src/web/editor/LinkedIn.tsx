import { useEffect, useRef, useState } from "react";
import { rearrangeForFeed } from "../../core/export/feed";
import { layoutView } from "../../core/layout";
import { LIMITS, type DiagramDocument, type DiagramView } from "../../core/model";
import { Icon } from "../ui/Icon";
import { engineName, type Runner } from "./runner";
import type { EngineInfo } from "../api";

const SAVED = "Saved in the file for your next archdrawer session";
const REWRITE = "Rewrite this post in plain words for someone who has never seen the project";
const NO_TITLE = "A post needs a title";

/** A view placed by lanes can be placed again for either orientation. */
export const hasLanes = (v: DiagramView) => v.nodes.some((n) => n.lane);
/** The post placed again by its lanes, portrait or wide. */
export const placePost = (v: DiagramView, portrait: boolean): DiagramView =>
  ({ ...v, ...layoutView({ ...v, nodes: v.nodes.map((n) => ({ ...n, x: undefined, y: undefined })) }, { portrait, post: true }) });

interface Engine {
  /** The engine and model a run uses (ui contract, Choosing the engine); null: none is available. */
  engine: string | null;
  /** How the engine is named (the fixture is `Test engine (no AI)`). */
  engineLabel: string | null;
  model: string;
  runner: Runner;
}

/** A post or story run started on a channel's stage: going, failed or saved for the next session. */
export function RunLine({ runner }: { runner: Runner }) {
  const { state } = runner;
  if (state.req?.origin !== "linkedin" && state.req?.origin !== "story") return null;
  if (state.status === "running") {
    return (
      <div className="run" data-testid="share-run" role="status">
        <span className="spinner" /><span className="line">{state.lines[state.lines.length - 1] ?? "Starting"}</span>
        <button className="btn small" data-testid="share-run-cancel" onClick={runner.cancel}>Cancel</button>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="run err" data-testid="share-run-error" role="alert">
        <span className="line">{state.error}</span>
        <button className="btn small" data-testid="share-run-retry" onClick={runner.retry}>Try again</button>
      </div>
    );
  }
  return state.status === "saved" ? <div className="run" data-testid="share-run-saved">{SAVED}</div> : null;
}

/** A post run; `label` names the control in the conversation (ui contract, The conversation). */
const designPost = ({ runner, engine, model }: Engine, label: string, instruction = "", readCode = true) =>
  void runner.start({ instruction, label, engine, model: model || null, scope: { kind: "view" }, origin: "linkedin", kind: "post", format: "feed", readCode });

/**
 * Draw or redraw the channel from the facts alone (STORY-1): with an engine a post run that reads no
 * file; without one the simple version.
 */
export const drawFromFacts = (p: Engine, prepare: () => void, label = "Draw it") => (p.engine ? designPost(p, label, "", false) : prepare());

/**
 * On the LinkedIn channel's empty stage (ui contract, The LinkedIn flow): with an engine the post is
 * drawn from the facts, or designed with a look at the code; without one code prepares the simple version.
 */
export function LinkedInStart(p: Engine & { onPrepare: () => void; choice?: StageChoice }) {
  const running = p.runner.state.status === "running";
  return (
    <div className="li-flow li-start" data-testid="linkedin-flow">
      {p.engine ? (
        <>
          {p.choice && <StageEngine {...p.choice} running={running} />}
          <button className="btn primary wide" data-testid="channel-draw" disabled={running} onClick={() => drawFromFacts(p, p.onPrepare)}>
            <Icon name="spark" size={15} /> Draw it
          </button>
          <p className="hint">The engine tells the story from the facts already read and is asked not to read the code again. Code places it and checks it.</p>
          <button className="btn wide" data-testid="design-post" disabled={running} onClick={() => designPost(p, "Design the post")}>Design the post</button>
          <p className="hint">The same, letting the engine check the code where it needs to.{p.engineLabel ? ` With ${p.engineLabel}.` : ""}</p>
        </>
      ) : (
        <>
          <p className="hint">A drawing of its own for a tall post: the parts that explain the system open, the rest small. The overview stays as it is.</p>
          <button className="btn primary wide" data-testid="linkedin-prepare" onClick={p.onPrepare}>Prepare the simple version</button>
          <p className="hint" data-testid="post-engine-note">No engine available — prepared without AI</p>
        </>
      )}
      <RunLine runner={p.runner} />
    </div>
  );
}

/** The engines a stage may choose from and the stored choice it changes (ui contract, Choosing the engine). */
export interface StageChoice {
  engines: EngineInfo[];
  engine: EngineInfo;
  model: string;
  onEngine: (id: string) => void;
  onModel: (model: string) => void;
}

/**
 * `stage-engine` and `stage-model` on the empty LinkedIn stage (#44): the engine and model `channel-draw` and
 * `design-post` use, the same choice `ai-engine` and `ai-model` store, so a change in either place shows in the other.
 */
function StageEngine({ engines, engine, model, onEngine, onModel, running }: StageChoice & { running: boolean }) {
  return (
    <div className="pick stage-pick">
      <label>
        <span>Engine</span>
        <select data-testid="stage-engine" value={engine.id} disabled={running} onChange={(e) => onEngine(e.target.value)}>
          {engines.filter((e) => e.available).map((e) => <option key={e.id} value={e.id}>{engineName(e)}</option>)}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select data-testid="stage-model" value={model} disabled={running} onChange={(e) => onModel(e.target.value)}>
          <option value="">Default</option>
          {engine.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
    </div>
  );
}

/**
 * Beside the drawn LinkedIn channel (ui contract, The LinkedIn flow): its caption, placing it again,
 * redesigning and rewriting it. The share dialog only packages it.
 */
export function LinkedInPanel(p: Engine & { view: DiagramView; apply: (fn: (d: DiagramDocument) => DiagramDocument, opts?: { coalesce?: string }) => void; toast: (m: string) => void }) {
  const { view, apply } = p;
  const running = p.runner.state.status === "running";
  const setCaption = (key: "title" | "lede", value: string) =>
    apply((d) => ({ ...d, views: d.views.map((v) => (v.id === view.id ? { ...v, caption: { ...v.caption, [key]: value } } : v)) }), { coalesce: `caption-${view.id}-${key}` });
  // Re-arrange places the parts again by their lanes for the portrait feed (an undoable edit, no engine).
  const rearrange = () => apply((d) => ({ ...d, views: d.views.map((v) => (v.id !== view.id ? v : hasLanes(v) ? placePost(v, true) : rearrangeForFeed(v))) }));
  return (
    <aside className="li-panel" data-testid="linkedin-panel" aria-label="LinkedIn post">
      <h2>LinkedIn post</h2>
      <label className="field">Title
        <TitleInput value={view.caption.title} disabled={running} onCommit={(t) => setCaption("title", t)} onEmpty={() => p.toast(NO_TITLE)} />
      </label>
      <label className="field">Description
        <textarea data-testid="share-caption-lede" value={view.caption.lede} maxLength={LIMITS.lede} rows={3} disabled={running} onChange={(e) => setCaption("lede", e.target.value)} />
      </label>
      <div className="flow-actions">
        <button className="btn" data-testid="arrange-feed" disabled={running} onClick={rearrange}>Re-arrange</button>
        {p.engine && <button className="btn" data-testid="design-post" disabled={running} onClick={() => designPost(p, "Design the post")}>Design the post</button>}
        <button className="btn primary wide" data-testid="explain-feed" disabled={running} onClick={() => designPost(p, "Rewrite it in plain words", REWRITE)}>
          <Icon name="spark" size={15} /> Rewrite it in plain words
        </button>
      </div>
      {!p.engine && <p className="hint" data-testid="post-engine-note">No engine available — prepared without AI</p>}
      <RunLine runner={p.runner} />
    </aside>
  );
}

/**
 * The post's title (a caption title has at least one character, diagram contract): what is typed
 * shows as typed, an empty or blank title is refused with a toast and never saved, and leaving the
 * field shows the saved title again.
 */
function TitleInput({ value, disabled, onCommit, onEmpty }: { value: string; disabled: boolean; onCommit: (t: string) => void; onEmpty: () => void }) {
  const [draft, setDraft] = useState(value);
  // The title this field last saved: any other value (an undo, a run) is shown at once, even while typing.
  const mine = useRef(value);
  useEffect(() => { if (value !== mine.current) { mine.current = value; setDraft(value); } }, [value]);
  return (
    <input data-testid="share-caption-title" value={draft} maxLength={LIMITS.captionTitle} disabled={disabled}
      onBlur={() => setDraft(value)}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (!t.trim()) onEmpty();
        else if (t !== value) { mine.current = t; onCommit(t); }
      }} />
  );
}
