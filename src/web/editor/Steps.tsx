import { useRef } from "react";
import { freeIdAmong, FACT3_LIMITS, type Step } from "../../core/file3";
import type { DiagramDocument, DiagramView } from "../../core/model";

/**
 * `steps-panel` (ui contract, README and presentation; STORY-4): the presentation's ordered steps.
 * Choosing one lights its parts and dims the rest; editing a step is an undoable edit of the
 * presentation channel only. Stepping through them is not an edit.
 */
interface Props {
  steps: Step[];
  view: DiagramView;
  current: string | null;
  onPick: (id: string | null) => void;
  /** Change the steps as one edit; `coalesce` joins typing in one field into one undo step. */
  edit: (fn: (steps: Step[]) => Step[], coalesce?: string) => void;
  selected: string[];
  toast: (m: string) => void;
}

export function StepsPanel({ steps, view, current, onPick, edit, selected, toast }: Props) {
  const panel = useRef<HTMLElement>(null);
  const at = steps.findIndex((s) => s.id === current);
  /** A button that disables itself at an end would drop focus to the page; keep it in the panel so the arrows still work. */
  const hold = (end: boolean) => {
    const a = document.activeElement;
    if (end && a instanceof HTMLButtonElement && panel.current?.contains(a)) panel.current.focus();
  };
  const step = at >= 0 ? steps[at] : null;
  const parts = view.nodes.filter((n) => n.form !== "group");
  const go = (d: number) => {
    if (!steps.length) return;
    const next = at < 0 ? (d > 0 ? 0 : -1) : at + d;
    if (next >= 0 && next < steps.length) { hold(next === 0 || next === steps.length - 1); onPick(steps[next].id); }
  };
  const set = (patch: Partial<Step>, key?: string) => step && edit((all) => all.map((s) => (s.id === step.id ? { ...s, ...patch } : s)), key);
  const add = () => {
    if (steps.length >= FACT3_LIMITS.steps) { toast(`A presentation has at most ${FACT3_LIMITS.steps} steps`); return; }
    const own = new Set(view.nodes.map((n) => n.id));
    const chosen = selected.filter((id) => own.has(id));
    const id = freeIdAmong(new Set(steps.map((s) => s.id)), `s${steps.length + 1}`);
    const added: Step = { id, parts: chosen.length ? chosen : step ? [...step.parts] : parts.slice(0, 1).map((n) => n.id), text: "New step", note: "" };
    edit((all) => { const i = all.findIndex((s) => s.id === current); const out = [...all]; out.splice(i >= 0 ? i + 1 : out.length, 0, added); return out; });
    onPick(id);
  };
  const move = (d: number) => step && (hold(at + d === 0 || at + d === steps.length - 1), edit((all) => {
    const i = all.findIndex((s) => s.id === step.id), j = i + d;
    if (i < 0 || j < 0 || j >= all.length) return all;
    const out = [...all];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }));
  const remove = () => {
    if (!step) return;
    const next = steps[at + 1] ?? steps[at - 1] ?? null;
    edit((all) => all.filter((s) => s.id !== step.id));
    onPick(next?.id ?? null);
  };
  const toggle = (id: string, on: boolean) => {
    if (!step) return;
    if (!on && step.parts.length === 1 && step.parts[0] === id) { toast("A step highlights at least one part"); return; }
    set({ parts: on ? [...step.parts, id] : step.parts.filter((p) => p !== id) });
  };

  return (
    <aside className="steps-panel" data-testid="steps-panel" aria-label="Steps" ref={panel} tabIndex={-1}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      }}>
      <h3>Steps</h3>
      {steps.length === 0 ? (
        <p className="hint" data-testid="step-none">No steps yet</p>
      ) : (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button data-testid="step-item" data-step-id={s.id} aria-current={s.id === current ? "true" : undefined} onClick={() => onPick(s.id)}>
                <span className="n">{i + 1}</span><span className="t">{s.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="step-nav">
        <button className="btn small" data-testid="step-prev" disabled={!steps.length || at <= 0} onClick={() => go(-1)}>Previous</button>
        <button className="btn small" data-testid="step-next" disabled={!steps.length || at === steps.length - 1} onClick={() => go(1)}>Next</button>
        <button className="btn small" data-testid="step-add" onClick={add}>Add a step</button>
      </div>
      {step && (
        <div className="step-edit">
          <label><span>On screen</span>
            <input type="text" data-testid="step-text" maxLength={FACT3_LIMITS.stepText} value={step.text} onChange={(e) => set({ text: e.target.value }, `step-text:${step.id}`)} />
          </label>
          <label><span>Speaker note</span>
            <textarea data-testid="step-note" maxLength={FACT3_LIMITS.stepNote} rows={4} value={step.note} onChange={(e) => set({ note: e.target.value }, `step-note:${step.id}`)} />
          </label>
          <fieldset data-testid="step-parts">
            <legend>Parts in this step</legend>
            {parts.map((n) => (
              <label key={n.id}><input type="checkbox" aria-label={n.label} checked={step.parts.includes(n.id)} onChange={(e) => toggle(n.id, e.target.checked)} /> {n.label}</label>
            ))}
          </fieldset>
          <div className="step-nav">
            <button className="btn small" data-testid="step-up" disabled={at <= 0} onClick={() => move(-1)}>Move up</button>
            <button className="btn small" data-testid="step-down" disabled={at >= steps.length - 1} onClick={() => move(1)}>Move down</button>
            <button className="btn small danger" data-testid="step-remove" onClick={remove}>Remove this step</button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** The steps of a joined presentation drawing. */
export const stepsOf = (d: DiagramDocument): Step[] => d.steps ?? [];
