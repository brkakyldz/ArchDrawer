import { useState, type KeyboardEvent } from "react";
import type { ChannelId } from "../../core/file3";
import type { Choice4, Document4 } from "../../core/file4";
import { panelDepths } from "../../core/map";
import { Icon } from "../ui/Icon";

/** The browser's memory of a folded panel, for every drawing (ui contract, Choices and the views panel). */
const FOLDED_KEY = "archdrawer.viewsFolded";
const readFolded = () => { try { return localStorage.getItem(FOLDED_KEY) === "1"; } catch { return false; } };

/** Whether a drawing has a views panel: more than one choice, or its one choice's overview holds more than one view. */
export const hasViewsPanel = (whole: Document4) => whole.choices.length > 1 || whole.choices[0].channels.overview.views.length > 1;

/** The panel's headings in order: the `system` choice has none (ui contract). */
const KINDS: { kind: Choice4["kind"]; heading: string | null }[] = [
  { kind: "system", heading: null }, { kind: "section", heading: "Sections" }, { kind: "flow", heading: "Flows" }, { kind: "custom", heading: "Your own" },
];

/** Folded or open, remembered by the browser for every drawing. */
export function useViewsFolded(): [boolean, (f: boolean) => void] {
  const [folded, setFolded] = useState(readFolded);
  const set = (f: boolean) => { setFolded(f); try { localStorage.setItem(FOLDED_KEY, f ? "1" : "0"); } catch { /* not remembered */ } };
  return [folded, set];
}

/**
 * `views-panel` (ui contract, Choices and the views panel): every overview view of every choice, the choices by kind,
 * each choice's views in the order `detail` links reach them. One click on an entry goes to that view in the overview
 * channel of its choice. Up and Down move between entries, Home and End to the first and the last.
 */
export function ViewsPanel({ whole, choice, channel, view, onGo, folded, onFold, inMenu = false }: {
  whole: Document4; choice: string; channel: ChannelId; view: string; onGo: (choice: string, view: string) => void;
  folded: boolean; onFold: (folded: boolean) => void; inMenu?: boolean;
}) {
  const shut = folded && !inMenu;
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-entry]"));
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
    all[next].focus();
  };
  return (
    <nav className={`views-panel${shut ? " folded" : ""}${inMenu ? " in-menu" : ""}`} data-testid="views-panel" aria-label="Views" onKeyDown={onKey}>
      {!inMenu && (
        <button className="btn icon-btn views-fold" data-testid="views-collapse" aria-expanded={!folded} aria-label={folded ? "Show views" : "Hide views"} title={folded ? "Show views" : "Hide views"}
          onClick={() => onFold(!folded)}>
          <Icon name="layers" size={16} />
        </button>
      )}
      {!shut && KINDS.map(({ kind, heading }) => {
        const of = whole.choices.filter((c) => c.kind === kind);
        if (!of.length) return null;
        return (
          <div key={kind} className="views-kind">
            {heading && <h3 className="views-heading" data-testid={`views-heading-${kind}`}>{heading}</h3>}
            {of.map((c) => (
              <div key={c.id} className="views-choice" data-testid={`views-choice-${c.id}`} data-kind={c.kind}>
                {panelDepths(c.channels.overview.views).map(({ view: v, depth }) => {
                  // In the overview channel the current view is marked; in another channel the current choice's first entry.
                  const current = c.id === choice && (channel === "overview" ? v.id === view : depth === 0);
                  return (
                    <button key={v.id} type="button" className="views-entry" data-entry="" data-testid={`views-entry-${v.id}`} data-choice={c.id} data-view={v.id} data-depth={depth}
                      aria-current={current ? "true" : undefined} style={{ paddingLeft: 10 + 16 * depth }} onClick={() => onGo(c.id, v.id)}>
                      <span className="views-title">{depth === 0 ? c.title : v.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
