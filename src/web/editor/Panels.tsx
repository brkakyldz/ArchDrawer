import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormThumb } from "./FormThumb";
import { bezierAt, layoutRects, measureText, routeEdges, textStyle } from "../../core/geometry";
import { FORM_LABELS, FORMS, KIND_INFO, KINDS, STYLE_LABELS, STYLES, TEXT_PRESETS, type Form, type Kind } from "../../core/model";
import { Icon } from "../ui/Icon";
import { deleteEdges, deleteTexts, reverseEdge, setEdge, setText, viewOf } from "./ops";
import type { Box, Ctl } from "./types";
import { NOTHING } from "./types";
import { toScreen, type Viewport } from "./viewport";
import type { Palette } from "../../core/theme";

/** Room kept free at the bottom of the stage for the ask box. */
const ASK_CLEARANCE = 84;

/** A text input over the drawing. Enter (Ctrl/Cmd+Enter when multiline) or blur commits; Escape cancels. */
export function InlineInput({ value, at, testid, multiline = false, select = true, fontSize = 14, onCommit, onCancel }: {
  value: string; at: Box; testid: string; multiline?: boolean; select?: boolean; fontSize?: number;
  onCommit: (v: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    if (select) el.select(); else el.setSelectionRange(el.value.length, el.value.length);
  }, [select]);
  const commit = () => { if (done.current) return; done.current = true; onCommit(ref.current!.value); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  };
  const style = { left: at.x, top: at.y, width: Math.max(80, at.w), height: multiline ? Math.max(84, at.h) : Math.max(24, at.h), fontSize };
  return multiline
    ? <textarea ref={ref} className="inline" data-testid={testid} defaultValue={value} style={style} onKeyDown={onKey} onBlur={commit} onPointerDown={(e) => e.stopPropagation()} />
    : <input ref={ref} className="inline" data-testid={testid} defaultValue={value} style={style} onKeyDown={onKey} onBlur={commit} onPointerDown={(e) => e.stopPropagation()} />;
}

/**
 * Typing a text in place (ui contract, Texts): a borderless textarea over the canvas in the text's own font, size and
 * line height, growing with what is typed, so the words appear where they will stay. Enter is a new line;
 * Escape, Ctrl+Enter or a click elsewhere commits.
 */
export function TextEditor({ vp, P, at, size, value, onCommit }: {
  vp: Viewport; P: Palette; at: { x: number; y: number }; size: number; value: string; onCommit: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [v, setV] = useState(value);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(ref.current!.value); };
  const st = textStyle(size);
  const m = measureText({ text: v || " ", size });
  const a = toScreen(vp, at);
  const k = vp.k;
  return (
    <textarea ref={ref} className="text-editor" data-testid="text-input" value={v} spellCheck={false} wrap="off"
      style={{ left: a.x, top: a.y, width: (m.w + st.size) * k, height: m.h * k, fontSize: st.size * k, lineHeight: `${st.line * k}px`, fontWeight: st.weight, color: P.ink }}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commit(); }
      }}
      onBlur={commit} onPointerDown={(e) => e.stopPropagation()} />
  );
}

/** The component picker (ui contract, Adding a component). */
export function Picker({ ctl, onAdd }: { ctl: Ctl; onAdd: (kind: Kind, form: Form) => void }) {
  const [kind, setKind] = useState<Kind>("service");
  const [form, setForm] = useState<Form>("card");
  const p = ctl.picker!;
  // Measured, so the whole picker (its Add button too) stays clear of the stage edge and the ask box.
  const el = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 360 });
  useLayoutEffect(() => { const r = el.current!.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); }, []);
  const bottom = ctl.stage.h - ASK_CLEARANCE;
  const left = Math.max(10, Math.min(ctl.stage.w - size.w - 10, p.screen.x + 8));
  const below = p.screen.y + 8, above = p.screen.y - 8 - size.h;
  const top = Math.max(10, below + size.h <= bottom ? below : above >= 10 ? above : bottom - size.h);
  return (
    <div ref={el} className="picker" data-testid="component-picker" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <h4>Kind</h4>
      <div className="grid">
        {KINDS.map((k) => (
          <button key={k} className="opt" data-testid={`picker-kind-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)} style={{ ["--k" as string]: ctl.P.kinds[k] }}>
            <span className="ic"><Icon name={KIND_INFO[k].icon} size={16} /></span>{KIND_INFO[k].label}
          </button>
        ))}
      </div>
      <h4>Form</h4>
      <div className="grid forms">
        {FORMS.map((f) => (
          <button key={f} className="opt form-opt" data-testid={`picker-form-${f}`} aria-pressed={form === f} onClick={() => setForm(f)}><FormThumb form={f} />{FORM_LABELS[f]}</button>
        ))}
      </div>
      <button className="btn primary" data-testid="picker-add" onClick={() => onAdd(kind, form)}>Add component</button>
    </div>
  );
}

/** Selecting one connection opens its callout (ui contract, Connections). */
export function EdgeCallout({ ctl, id }: { ctl: Ctl; id: string }) {
  const edge = ctl.view.edges.find((e) => e.id === id);
  const [label, setLabel] = useState(edge?.label ?? "");
  const [step, setStep] = useState(edge?.step === null || edge?.step === undefined ? "" : String(edge.step));
  useEffect(() => { setLabel(edge?.label ?? ""); setStep(edge?.step == null ? "" : String(edge.step)); }, [edge?.label, edge?.step, id]);
  if (!edge) return null;
  const from = viewOf(ctl.doc, ctl.vid).nodes.find((n) => n.id === edge.from), to = viewOf(ctl.doc, ctl.vid).nodes.find((n) => n.id === edge.to);
  const route = routeEdges(ctl.view, layoutRects(ctl.view)).get(id);
  const a = route ? toScreen(ctl.vp, bezierAt(route, 0.5)) : { x: 40, y: 40 };
  const left = Math.max(10, Math.min(ctl.stage.w - 290, a.x - 140));
  const top = Math.max(10, Math.min(ctl.stage.h - 260, a.y + 20));
  const commitLabel = () => { if (label !== edge.label) ctl.apply((d) => setEdge(d, ctl.vid, id, { label })); };
  const commitStep = () => {
    const v = step.trim() === "" ? null : Number(step);
    if (v !== edge.step) ctl.apply((d) => setEdge(d, ctl.vid, id, { step: v === null || Number.isNaN(v) ? null : v }));
  };
  const keys = (commit: () => void, reset: () => void) => (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLElement).blur(); }
    if (e.key === "Escape") { reset(); (e.target as HTMLElement).blur(); }
  };
  return (
    <div className="edge-callout" data-testid="edge-callout" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="field-row"><b style={{ color: "var(--ink)", fontWeight: 600 }}>{from?.label ?? edge.from}</b> → <b style={{ color: "var(--ink)", fontWeight: 600 }}>{to?.label ?? edge.to}</b></div>
      <input type="text" data-testid="edge-label-input" placeholder="Label" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel} onKeyDown={keys(commitLabel, () => setLabel(edge.label))} />
      <div className="seg">
        {STYLES.map((s) => (
          <button key={s} className="opt" data-testid={`edge-style-${s}`} aria-pressed={edge.style === s} onClick={() => ctl.apply((d) => setEdge(d, ctl.vid, id, { style: s }))}>{STYLE_LABELS[s]}</button>
        ))}
      </div>
      <label><input type="checkbox" data-testid="edge-both" checked={edge.both} onChange={(e) => ctl.apply((d) => setEdge(d, ctl.vid, id, { both: e.target.checked }))} /> Two-way</label>
      <label>Step <input type="number" min={1} data-testid="edge-step-input" value={step} onChange={(e) => setStep(e.target.value)} onBlur={commitStep} onKeyDown={keys(commitStep, () => setStep(edge.step == null ? "" : String(edge.step)))} /></label>
      <div className="row">
        <button className="btn small" data-testid="edge-reverse" onClick={() => ctl.apply((d) => reverseEdge(d, ctl.vid, id))}><Icon name="swap" size={15} /> Reverse</button>
        <button className="btn small danger" data-testid="edge-delete" onClick={() => { ctl.apply((d) => deleteEdges(d, ctl.vid, [id])); ctl.setSel(NOTHING); }}><Icon name="trash" size={15} /> Delete</button>
      </div>
    </div>
  );
}

/** Selecting one text shows its toolbar: its size, and delete (ui contract, Texts). */
export function TextToolbar({ ctl, id }: { ctl: Ctl; id: string }) {
  const text = ctl.view.texts.find((t) => t.id === id);
  if (!text) return null;
  const a = toScreen(ctl.vp, { x: text.x, y: text.y });
  // Above the text, clear of its corner handles; below it when the stage edge is too close.
  const above = a.y - 64;
  return (
    <div className="text-toolbar" data-testid="text-toolbar" style={{ left: Math.max(10, a.x - 6), top: above >= 10 ? above : a.y + (measureText(text).h + 6) * ctl.vp.k + 14 }} onPointerDown={(e) => e.stopPropagation()}>
      {TEXT_PRESETS.map((s) => (
        <button key={s.label} className="btn small" data-testid={`text-size-${s.label.toLowerCase()}`} aria-pressed={text.size === s.size} title={`${s.size} px`}
          onClick={() => { ctl.textSize.current = s.size; ctl.apply((d) => setText(d, ctl.vid, id, { size: s.size })); }}>{s.label}</button>
      ))}
      <span className="sep" />
      <button className="btn small danger" data-testid="text-delete" aria-label="Delete text" onClick={() => { ctl.apply((d) => deleteTexts(d, ctl.vid, [id])); ctl.setSel(NOTHING); }}><Icon name="trash" size={15} /></button>
    </div>
  );
}

export function Warnings({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  return (
    <div className="warnings" data-testid="warnings" role="status">
      <header>{warnings.length} warning{warnings.length === 1 ? "" : "s"} from the last change
        <button className="x" data-testid="warnings-dismiss" aria-label="Dismiss warnings" onClick={onDismiss}><Icon name="close" size={15} /></button>
      </header>
      <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>
  );
}
