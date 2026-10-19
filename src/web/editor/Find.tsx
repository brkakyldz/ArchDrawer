import { useEffect, useMemo, useRef, useState } from "react";
import type { DiagramDocument } from "../../core/model";
import { Icon } from "../ui/Icon";

export interface Hit { view: string; viewTitle: string; id: string; label: string }

/** Components of every view whose label contains `q`, case-insensitively, in file order. */
export function findParts(doc: Pick<DiagramDocument, "views">, q: string): Hit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return doc.views.flatMap((v) => v.nodes.filter((n) => n.label.toLowerCase().includes(t)).map((n) => ({ view: v.id, viewTitle: v.title, id: n.id, label: n.label })));
}

/** `search` (ui contract): find a component anywhere in the drawing and go to it. */
export function Search({ doc, onPick, onClose }: { doc: DiagramDocument; onPick: (h: Hit) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findParts(doc, q).slice(0, 50), [doc, q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setAt(0), [q]);
  return (
    <div className="search" data-testid="search" role="dialog" aria-label="Find a component" onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
        else if (e.key === "Enter" && hits[at]) { e.preventDefault(); onPick(hits[at]); }
      }}>
      <div className="search-in">
        <Icon name="search" size={16} />
        <input ref={input} data-testid="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a component in every view" aria-label="Find a component" autoComplete="off" />
        <kbd>Esc</kbd>
      </div>
      {q.trim() && (
        <ul role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.view}/${h.id}`} role="option" aria-selected={i === at}>
              <button data-testid="search-result" data-view={h.view} data-node-id={h.id} className={i === at ? "on" : ""} onMouseEnter={() => setAt(i)} onClick={() => onPick(h)}>
                <span className="l">{h.label}</span><span className="v">{h.viewTitle}</span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="none">No component is called that</li>}
        </ul>
      )}
    </div>
  );
}
