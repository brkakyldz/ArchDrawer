import { useEffect, useMemo, useRef, useState } from "react";
import type { DiagramDocument } from "../../core/model";
import { Icon } from "../ui/Icon";

export interface Hit { view: string; viewTitle: string; id: string; label: string }
/** What the canvas shows while searching: the matches of the current view and the one stepped to. */
export interface Found { ids: Set<string>; current: string | null }

/** Components of every view whose label contains `q`, case-insensitively, in file order. */
export function findParts(doc: Pick<DiagramDocument, "views">, q: string): Hit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return doc.views.flatMap((v) => v.nodes.filter((n) => n.label.toLowerCase().includes(t)).map((n) => ({ view: v.id, viewTitle: v.title, id: n.id, label: n.label })));
}

/** The match after (or, with `back`, before) `current`, wrapping; from none, the first (or the last). */
export function stepMatch(ids: string[], current: string | null, back = false): string | null {
  if (!ids.length) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return ids[back ? ids.length - 1 : 0];
  return ids[(i + (back ? ids.length - 1 : 1)) % ids.length];
}

/** `search-count` (ui contract). */
export function countText(n: number, at: number): string {
  if (!n) return "No match in this view";
  return at >= 0 ? `${at + 1} of ${n}` : `${n} ${n === 1 ? "match" : "matches"}`;
}

/** The other views' list holds at most this many results. */
const LISTED = 50;

/**
 * `search` (ui contract): matches on the current view are lit on the canvas and stepped through
 * with Enter / Shift+Enter; matches in other views are listed and open that view.
 */
export function Search({ doc, view, focusRound, onFound, onStep, onOpen, onClose }: {
  doc: DiagramDocument; view: string; focusRound: number;
  onFound: (f: Found | null) => void; onStep: (id: string) => void; onOpen: (h: Hit) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [at, setAt] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findParts(doc, q), [doc, q]);
  const here = useMemo(() => hits.filter((h) => h.view === view).map((h) => h.id), [hits, view]);
  const elsewhere = useMemo(() => hits.filter((h) => h.view !== view).slice(0, LISTED), [hits, view]);
  // A stepped-to part that no longer matches here (the text, the view or the drawing changed) is none.
  const cur = current !== null && here.includes(current) ? current : null;
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRound]);
  useEffect(() => setAt(-1), [q, view]);
  const key = q.trim() ? `${here.join("\n")}\u0000${cur ?? ""}` : null;
  useEffect(() => { onFound(q.trim() ? { ids: new Set(here), current: cur } : null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onFound(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (back: boolean) => {
    const next = stepMatch(here, cur, back);
    if (next === null) return;
    setCurrent(next); setAt(-1); onStep(next);
  };
  const open = (h: Hit) => { setCurrent(h.id); setAt(-1); onOpen(h); };

  return (
    <div className="search" data-testid="search" role="dialog" aria-label="Find a component" onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        else if (e.key === "ArrowDown" && elsewhere.length) { e.preventDefault(); setAt((i) => Math.min(elsewhere.length - 1, i + 1)); }
        else if (e.key === "ArrowUp" && elsewhere.length) { e.preventDefault(); setAt((i) => Math.max(-1, i - 1)); }
        else if (e.key === "Enter" && e.target === input.current) {
          e.preventDefault();
          if (elsewhere[at]) open(elsewhere[at]);
          else if (here.length) step(e.shiftKey);
          else if (elsewhere.length && !e.shiftKey) open(elsewhere[0]);
        }
      }}>
      <div className="search-in">
        <Icon name="search" size={16} />
        <input ref={input} data-testid="search-input" value={q} onChange={(e) => setQ(e.target.value)}
          // Any typing ends the stepping, even typing the same text again (React reports no change then).
          onInput={() => setCurrent(null)} placeholder="Find a component in every view" aria-label="Find a component" autoComplete="off" />
        {q.trim() && <span className="search-count" data-testid="search-count" role="status">{countText(here.length, cur === null ? -1 : here.indexOf(cur))}</span>}
        {here.length > 0 && (
          <span className="search-step">
            <button className="tb" data-testid="search-prev" aria-label="Previous match" onClick={() => step(true)}><Icon name="up" size={15} /></button>
            <button className="tb" data-testid="search-next" aria-label="Next match" onClick={() => step(false)}><Icon name="down" size={15} /></button>
          </span>
        )}
        <kbd>Esc</kbd>
      </div>
      {q.trim() && (elsewhere.length > 0 || !hits.length) && (
        <ul role="listbox" aria-label="In other views">
          {elsewhere.length > 0 && <li className="head" role="presentation">In other views</li>}
          {elsewhere.map((h, i) => (
            <li key={`${h.view}/${h.id}`} role="option" aria-selected={i === at}>
              <button data-testid="search-result" data-view={h.view} data-node-id={h.id} className={i === at ? "on" : ""} onMouseEnter={() => setAt(i)} onClick={() => open(h)}>
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
