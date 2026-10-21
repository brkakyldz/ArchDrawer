import { rearrangeForFeed } from "../../core/export/feed";
import { layoutView } from "../../core/layout";
import { LIMITS, type DiagramDocument, type DiagramView } from "../../core/model";
import { Icon } from "../ui/Icon";
import type { Runner } from "./runner";

const SAVED = "Saved in the file for your next archdrawer session";
const REWRITE = "Rewrite this post in plain words for someone who has never seen the project";

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

/** A post run started on the LinkedIn channel: going, failed or saved for the next session. */
function RunLine({ runner }: { runner: Runner }) {
  const { state } = runner;
  if (state.req?.origin !== "linkedin") return null;
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

const designPost = ({ runner, engine, model }: Engine, instruction = "", readCode = true) =>
  void runner.start({ instruction, engine, model: model || null, scope: { kind: "view" }, origin: "linkedin", kind: "post", format: "feed", readCode });

/**
 * Draw or redraw the channel from the facts alone (STORY-1): with an engine a post run that reads no
 * file; without one the simple version.
 */
export const drawFromFacts = (p: Engine, prepare: () => void) => (p.engine ? designPost(p, "", false) : prepare());

/**
 * On the LinkedIn channel's empty stage (ui contract, The LinkedIn flow): with an engine the post is
 * drawn from the facts, or designed with a look at the code; without one code prepares the simple version.
 */
export function LinkedInStart(p: Engine & { onPrepare: () => void }) {
  const running = p.runner.state.status === "running";
  return (
    <div className="li-flow li-start" data-testid="linkedin-flow">
      {p.engine ? (
        <>
          <button className="btn primary wide" data-testid="channel-draw" disabled={running} onClick={() => drawFromFacts(p, p.onPrepare)}>
            <Icon name="spark" size={15} /> Draw it
          </button>
          <p className="hint">The engine tells the story from the facts already read and is asked not to read the code again. Code places it and checks it.</p>
          <button className="btn wide" data-testid="design-post" disabled={running} onClick={() => designPost(p)}>Design the post</button>
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

/**
 * Beside the drawn LinkedIn channel (ui contract, The LinkedIn flow): its caption, placing it again,
 * redesigning and rewriting it. The share dialog only packages it.
 */
export function LinkedInPanel(p: Engine & { view: DiagramView; apply: (fn: (d: DiagramDocument) => DiagramDocument, opts?: { coalesce?: string }) => void }) {
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
        <input data-testid="share-caption-title" value={view.caption.title} maxLength={LIMITS.captionTitle} disabled={running} onChange={(e) => setCaption("title", e.target.value)} />
      </label>
      <label className="field">Description
        <textarea data-testid="share-caption-lede" value={view.caption.lede} maxLength={LIMITS.lede} rows={3} disabled={running} onChange={(e) => setCaption("lede", e.target.value)} />
      </label>
      <div className="flow-actions">
        <button className="btn" data-testid="arrange-feed" disabled={running} onClick={rearrange}>Re-arrange</button>
        {p.engine && <button className="btn" data-testid="design-post" disabled={running} onClick={() => designPost(p)}>Design the post</button>}
        <button className="btn primary wide" data-testid="explain-feed" disabled={running} onClick={() => designPost(p, REWRITE)}>
          <Icon name="spark" size={15} /> Rewrite it in plain words
        </button>
      </div>
      {!p.engine && <p className="hint" data-testid="post-engine-note">No engine available — prepared without AI</p>}
      <RunLine runner={p.runner} />
    </aside>
  );
}
