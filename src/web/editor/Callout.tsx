import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutRects } from "../../core/geometry";
import {
  descendants, FORM_LABELS, FORMS, iconOf, ICONS, isRepoRelative, KIND_INFO, KINDS, LIMITS,
  type DiagramNode, type IconName,
} from "../../core/model";
import { api } from "../api";
import { Icon } from "../ui/Icon";
import { ROW_CAPS, rowOf as kindOf } from "./rows";
import { FormThumb } from "./FormThumb";
import { createInside, deleteNodes, setNode, type NodePatch } from "./ops";
import type { Ctl } from "./types";
import { NOTHING } from "./types";
import { placeCallout, rectToScreen } from "./viewport";

type Menu = "kind" | "form" | "icon" | null;

/** The paths among `files` that are not in the drawing's repository (api contract, check-files); none until the server answers. */
function useMissingFiles(docId: string, files: string[]): Set<string> {
  const key = JSON.stringify(files);
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const paths = JSON.parse(key) as string[];
    let live = true;
    if (!paths.length) { setMissing(new Set()); return; }
    api.checkFiles(docId, paths).then((m) => { if (live) setMissing(new Set(m)); }, () => { if (live) setMissing(new Set()); });
    return () => { live = false; };
  }, [docId, key]);
  return missing;
}

/** The explanation of a component, beside it in free canvas at screen size, every field editable (ui contract, Callout). */
export function Callout({ ctl, id, docked = false }: { ctl: Ctl; id: string; docked?: boolean }) {
  const node = ctl.view.nodes.find((n) => n.id === id);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(360);
  const [menu, setMenu] = useState<Menu>(null);
  const [editDesc, setEditDesc] = useState(false);
  const [editItem, setEditItem] = useState<number | null>(null);
  const [addFile, setAddFile] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  useLayoutEffect(() => { if (box.current) setH(box.current.offsetHeight); });
  const missing = useMissingFiles(ctl.doc.id, node?.files ?? []);
  if (!node) return null;

  const patch = (p: NodePatch, coalesce?: string) => ctl.apply((d) => setNode(d, ctl.vid, id, p), coalesce ? { coalesce } : undefined);
  const rects = layoutRects(ctl.view);
  const r = rectToScreen(ctl.vp, rects.get(id)!);
  // Keep clear of the components it talks about: its neighbours, its group and its members.
  const near = new Set<string>([...descendants(ctl.view, id)]);
  for (const e of ctl.view.edges) { if (e.from === id) near.add(e.to); if (e.to === id) near.add(e.from); }
  for (let p = node.parent; p; p = ctl.view.nodes.find((n) => n.id === p)?.parent ?? null) near.add(p);
  const avoid = [...near].filter((x) => rects.has(x)).map((x) => rectToScreen(ctl.vp, rects.get(x)!));
  const pos = placeCallout(r, { w: 296, h }, ctl.stage, avoid);
  const K = ctl.P.kinds[node.kind];
  const links = linksOf(ctl, node);
  const inside = descendants(ctl.view, id);
  const groups = ctl.view.nodes.filter((n) => n.form === "group" && n.id !== id && !inside.has(n.id));

  // A panel's rows: its held mechanisms first, its items, its limits last (diagram contract, What a
  // channel draws). Renaming a held or limit row edits that fact; removing one only stops showing it.
  const limitN = node.limitIds?.length ?? 0;
  const firstLimit = node.items.length - limitN;
  const rowOf = (i: number) => kindOf(node, i);
  const capOf = (i: number) => ROW_CAPS[rowOf(i)];
  const setItems = (items: string[]) => patch({ items });
  const removeRow = (i: number) => {
    const items = node.items.filter((_, j) => j !== i);
    if (rowOf(i) === "held") patch({ items, heldIds: node.heldIds!.filter((_, j) => j !== i) });
    else if (rowOf(i) === "limit") patch({ items, limitIds: node.limitIds!.filter((_, j) => j !== i - firstLimit) });
    else setItems(items);
  };
  const commitItem = (i: number, v: string) => {
    setEditItem(null);
    const t = v.trim().slice(0, capOf(i));
    if (!t) return removeRow(i);
    const items = [...node.items];
    items[i] = t;
    if (t !== node.items[i]) setItems(items);
  };
  // A row moves only among rows of its own kind.
  const canMove = (i: number, d: number) => i + d >= 0 && i + d < node.items.length && rowOf(i) === rowOf(i + d);
  const move = (i: number, d: number) => {
    const items = [...node.items];
    [items[i], items[i + d]] = [items[i + d], items[i]];
    const swap = (ids: string[], a: number, b: number) => { const x = [...ids]; [x[a], x[b]] = [x[b], x[a]]; return x; };
    if (rowOf(i) === "held") patch({ items, heldIds: swap(node.heldIds!, i, i + d) });
    else if (rowOf(i) === "limit") patch({ items, limitIds: swap(node.limitIds!, i - firstLimit, i + d - firstLimit) });
    else setItems(items);
  };
  const close = () => ctl.setCallout(null);
  const keyStop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <div ref={box} className={docked ? "callout docked" : `callout ${pos.side}`} data-testid={`callout-${id}`} data-docked={String(docked)}
      style={docked ? { ["--k" as string]: K } : { left: pos.x, top: pos.y, ["--k" as string]: K, [pos.side === "r" || pos.side === "l" ? "--ny" : "--nx"]: `${pos.pointer}px` }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={keyStop}>
      <header>
        <span className="ic"><Icon name={iconOf(node)} size={20} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editTitle ? (
            <input className="title-input" autoFocus data-testid="callout-title-input" defaultValue={node.label} maxLength={LIMITS.label} ref={(el) => el?.select()}
              aria-label="Name"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { e.preventDefault(); const t = e.target as HTMLInputElement; t.dataset.cancel = "1"; t.blur(); }
              }}
              onBlur={(e) => { const v = e.target.value.trim(); setEditTitle(false); if (!e.target.dataset.cancel && v && v !== node.label) patch({ label: v }); }} />
          ) : (
            <h3 data-testid="callout-title" title="Click to rename" onClick={() => setEditTitle(true)}>{node.label}</h3>
          )}
          <div className="meta">
            <button className="pill" data-testid="callout-kind" onClick={() => setMenu(menu === "kind" ? null : "kind")}><i />{KIND_INFO[node.kind].label}</button>
            <button className="pill" data-testid="callout-form" onClick={() => setMenu(menu === "form" ? null : "form")}>{FORM_LABELS[node.form]}</button>
            <button className="pill" data-testid="callout-icon" aria-label="Icon" onClick={() => setMenu(menu === "icon" ? null : "icon")}><Icon name={iconOf(node)} size={14} /></button>
          </div>
          {menu === "kind" && (
            <div className="menu" data-testid="kind-menu" style={{ left: 44, top: 70 }}>
              {KINDS.map((k) => (
                <button key={k} data-testid={`kind-option-${k}`} aria-pressed={node.kind === k} style={{ ["--k" as string]: ctl.P.kinds[k] }}
                  onClick={() => { patch({ kind: k }); setMenu(null); }}><i />{KIND_INFO[k].label}</button>
              ))}
            </div>
          )}
          {menu === "form" && (
            <div className="menu" data-testid="form-menu" style={{ left: 100, top: 70 }}>
              {FORMS.map((f) => (
                <button key={f} className="form-opt" data-testid={`form-option-${f}`} aria-pressed={node.form === f} onClick={() => { patch({ form: f }); setMenu(null); }}><FormThumb form={f} />{FORM_LABELS[f]}</button>
              ))}
            </div>
          )}
          {menu === "icon" && (
            <div className="menu icons" data-testid="icon-menu" style={{ left: 20, top: 70 }}>
              <button className="wide" data-testid="icon-option-default" aria-pressed={node.icon === null} onClick={() => { patch({ icon: null }); setMenu(null); }}>
                <Icon name={KIND_INFO[node.kind].icon} size={16} /> Kind's icon
              </button>
              {ICONS.map((name) => (
                <button key={name} data-testid={`icon-option-${name}`} aria-pressed={node.icon === name} title={name} onClick={() => { patch({ icon: name as IconName }); setMenu(null); }}>
                  <Icon name={name} size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="x" data-testid="callout-pin" aria-label="Pin to the side" aria-pressed={docked} title={docked ? "Unpin" : "Pin to the side"} onClick={() => ctl.setPinned(!docked)}>
          <Icon name={docked ? "unpin" : "dock"} size={15} />
        </button>
        <button className="x" data-testid="callout-close" aria-label="Close" onClick={close}><Icon name="close" size={15} /></button>
      </header>

      <div className="bd">
        {editDesc ? (
          <textarea autoFocus data-testid="callout-description-input" defaultValue={node.description} maxLength={LIMITS.description}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { e.preventDefault(); setEditDesc(false); }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
            }}
            onBlur={(e) => { const v = e.target.value.trim() || node.description; setEditDesc(false); if (v !== node.description) patch({ description: v }); }} />
        ) : (
          <p data-testid="callout-description" title="Double-click to edit" onDoubleClick={() => setEditDesc(true)}>{node.description}</p>
        )}

        {node.form === "panel" && (
          <>
            <h4>What it holds</h4>
            <ul className="items" data-testid="callout-items">
              {node.items.map((t, i) => (
                <li key={`${i}-${t}`} data-testid="callout-item" data-row={rowOf(i)}>
                  {editItem === i ? (
                    <input type="text" autoFocus data-testid="callout-item-input" defaultValue={t} maxLength={capOf(i)}
                      ref={(el) => el?.select()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                        if (e.key === "Escape") { e.preventDefault(); setEditItem(null); }
                      }}
                      onBlur={(e) => { if (editItem === i) commitItem(i, e.target.value); }} />
                  ) : (
                    <span onDoubleClick={() => setEditItem(i)} title="Double-click to edit">{t}</span>
                  )}
                  <button className="mini" data-testid="callout-item-up" aria-label="Move up" disabled={!canMove(i, -1)} onClick={() => move(i, -1)}><Icon name="up" size={13} /></button>
                  <button className="mini" data-testid="callout-item-down" aria-label="Move down" disabled={!canMove(i, 1)} onClick={() => move(i, 1)}><Icon name="down" size={13} /></button>
                  <button className="mini" data-testid="callout-item-remove" aria-label="Remove" onClick={() => removeRow(i)}><Icon name="close" size={13} /></button>
                </li>
              ))}
            </ul>
            {node.items.length < LIMITS.items && (
              <button className="add" data-testid="callout-item-add" onClick={() => { setItems([...node.items.slice(0, firstLimit), "New item", ...node.items.slice(firstLimit)]); setEditItem(firstLimit); }}>+ Add an item</button>
            )}
          </>
        )}

        <h4>Connected to</h4>
        {links.length ? (
          <div className="chips">
            {links.map((l) => (
              <button key={l.id} className="chip" data-testid={`callout-link-${l.id}`} data-direction={l.direction} style={{ ["--k" as string]: ctl.P.kinds[l.kind] }}
                onClick={() => { ctl.setSel({ ...NOTHING, nodes: [l.id] }); ctl.setCallout(l.id); }}>
                <i />{l.label}<span className="d"><Icon name={l.direction === "to" ? "ar" : l.direction === "from" ? "al" : "lr"} size={13} stroke={2} /></span>
              </button>
            ))}
          </div>
        ) : <span className="empty">Nothing yet</span>}

        {(node.facts?.length ?? 1) > 0 && <>
        <h4>In the code</h4>
        <div className="paths" data-testid="callout-files">
          {node.files.map((f) => (
            <span key={f} className="path" data-testid="callout-file" data-missing={missing.has(f) ? "true" : undefined}>
              <span>{f}{missing.has(f) && <em data-testid="callout-file-missing">not in the repository</em>}</span>
              <button className="mini" data-testid="callout-file-remove" aria-label={`Remove ${f}`} onClick={() => patch({ files: node.files.filter((x) => x !== f) })}><Icon name="close" size={13} /></button>
            </span>
          ))}
          {!node.files.length && !addFile && <span className="empty">No files listed</span>}
          {addFile ? (
            <input type="text" autoFocus data-testid="callout-file-input" placeholder="src/path/to/file.ts" className="mono"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") { e.preventDefault(); setAddFile(false); }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const v = (e.target as HTMLInputElement).value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
                  if (!v) { setAddFile(false); return; }
                  if (!isRepoRelative(v)) { ctl.toast("Use a path inside the repository, like src/app.ts"); return; }
                  if (!node.files.includes(v) && node.files.length < LIMITS.files) patch({ files: [...node.files, v] });
                  setAddFile(false);
                }
              }}
              onBlur={() => setAddFile(false)} />
          ) : (
            <button className="add" data-testid="callout-file-add" onClick={() => setAddFile(true)}>+ Add a file</button>
          )}
        </div>
        </>}

        <h4>Inside</h4>
        <div className="field-row">
          <select data-testid="callout-parent" value={node.parent ?? ""} onChange={(e) => patch({ parent: e.target.value || null })} aria-label="Inside group">
            <option value="">Top level</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
      </div>

      <footer>
        {node.detail
          ? <button className="btn primary" data-testid="callout-open-inside" onClick={() => ctl.goView(node.detail!)}><Icon name="stack" size={15} /> Open inside</button>
          : <button className="btn" data-testid="callout-create-inside" onClick={() => {
              const r = createInside(ctl.doc, ctl.vid, id);
              ctl.apply(() => r.doc);
              ctl.goView(r.view, r.doc);
            }}><Icon name="stack" size={15} /> Draw its inside</button>}
        <button className="btn" data-testid="callout-ask" onClick={() => ctl.changePart(id)}><Icon name="spark" size={15} /> Change this part</button>
        <button className="btn danger" data-testid="callout-delete" aria-label="Delete component" onClick={() => { ctl.apply((d) => deleteNodes(d, ctl.vid, [id])); ctl.setSel(NOTHING); close(); }}><Icon name="trash" size={15} /></button>
      </footer>
    </div>
  );
}

function linksOf(ctl: Ctl, node: DiagramNode) {
  const out = new Map<string, { id: string; label: string; kind: DiagramNode["kind"]; direction: "to" | "from" | "both" }>();
  for (const e of ctl.view.edges) {
    const other = e.from === node.id ? e.to : e.to === node.id ? e.from : null;
    if (!other) continue;
    const n = ctl.view.nodes.find((x) => x.id === other);
    if (!n) continue;
    const dir = e.both ? "both" : e.from === node.id ? "to" : "from";
    const prev = out.get(other);
    out.set(other, { id: other, label: n.label, kind: n.kind, direction: prev && prev.direction !== dir ? "both" : dir });
  }
  return [...out.values()];
}
