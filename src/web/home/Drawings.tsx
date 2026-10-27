import { useEffect, useRef, useState } from "react";
import { api, type DiagramSummary } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { kindName, previewOf, type Preview } from "./preview";
import { relativeTime, serverNow } from "./time";

/**
 * The drawings (ui contract, *Drawings*): cards in a grid or rows in a list, each with a preview of the drawing's
 * first view drawn by src/core, a search over titles and paths, and the layout kept in this browser.
 */

const LAYOUT_KEY = "archdraw-library-layout";
type Layout = "grid" | "list";
const STEP_MS = 1100;

// One read per drawing and change: the preview is asked when its card first comes into view.
const previews = new Map<string, Promise<Preview | null>>();
let prefixes = 0;
function loadPreview(d: DiagramSummary): Promise<Preview | null> {
  const key = `${d.id}@${d.updatedAt}`;
  let p = previews.get(key);
  if (!p) {
    const prefix = `pv${++prefixes}`;
    p = api.get(d.id).then((doc) => { try { return previewOf(doc, prefix); } catch { return null; } }, () => null);
    previews.set(key, p);
  }
  return p;
}

/** The preview of `d` once its element has come into view: undefined while unknown, null when it cannot be read. */
function usePreview(d: DiagramSummary, el: React.RefObject<HTMLElement | null>): Preview | null | undefined {
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const node = el.current;
    const load = () => void loadPreview(d).then((p) => { if (live) setPreview(p); });
    if (!node || typeof IntersectionObserver === "undefined") { load(); return () => { live = false; }; }
    const io = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: "200px" });
    io.observe(node);
    return () => { live = false; io.disconnect(); };
  }, [d.id, d.updatedAt]);
  return preview;
}

/** The preview frame: the view at `index`, the `<n> views` pill and its dots, and what sits on it (`library-open`). */
export function PreviewFrame({ preview, index, testId, children }: { preview: Preview | null | undefined; index: number; testId: string; children?: React.ReactNode }) {
  const views = preview?.views ?? [];
  const view = views[Math.min(index, views.length - 1)];
  const style = preview ? ({ "--pv-canvas": preview.canvas, "--pv-dot": preview.dot } as React.CSSProperties) : undefined;
  return (
    <div className="hm-thumb" data-testid={testId} data-theme={preview?.theme} style={style}>
      {preview === null || (preview && !view) ? <span className="hm-no-preview">No preview</span>
        : view && <div className="hm-pv" dangerouslySetInnerHTML={{ __html: view.svg }} />}
      {views.length > 1 && (
        <>
          <span className="hm-views-pill" data-testid="library-item-views"><Icon name="layers" size={13} />{views.length} views</span>
          <span className="hm-view-dots" aria-hidden="true">{views.map((v, i) => <i key={v.id} className={i === index ? "on" : ""} />)}</span>
        </>
      )}
      {children}
    </div>
  );
}

function Card({ d, menuOpen, onMenu, onForget }: { d: DiagramSummary; menuOpen: boolean; onMenu: (open: boolean) => void; onForget: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const preview = usePreview(d, ref);
  const [hover, setHover] = useState(false);
  const [index, setIndex] = useState(0);
  const count = preview?.views.length ?? 0;
  // While the pointer is on the card the preview moves to the next view every 1.1 s; back to the first when it leaves.
  useEffect(() => {
    if (!hover || count < 2) { setIndex(0); return; }
    const t = setInterval(() => setIndex((i) => (i + 1) % count), STEP_MS);
    return () => clearInterval(t);
  }, [hover, count]);
  const kinds = preview?.views[Math.min(index, count - 1)]?.kinds ?? [];
  const open = () => navigate(`/d/${d.id}`);
  const where = d.link ?? d.path ?? "Imported";
  return (
    <li ref={ref} className="hm-card" data-testid="library-item" data-diagram-id={d.id} tabIndex={0} aria-label={d.title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => { if (!(e.target as Element).closest("button, [role=menu]")) open(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); open(); } }}>
      <PreviewFrame preview={preview} index={index} testId="library-item-preview">
        <button type="button" className="hm-open" data-testid="library-open" onClick={open}>Open <Icon name="send" size={14} /></button>
      </PreviewFrame>
      <div className="hm-card-body">
        <div className="t">
          <b data-testid="library-item-title">{d.title}</b>
          <span className="p" data-testid="library-item-path" title={where}>{where}</span>
        </div>
        <div className="hm-row-menu">
          <button type="button" className="hm-icon-btn" data-testid="library-menu" aria-label={`More actions for ${d.title}`} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={() => onMenu(!menuOpen)}><Icon name="more" size={16} /></button>
          {menuOpen && (
            <div className="hm-menu" role="menu" data-testid="library-menu-list">
              <button type="button" role="menuitem" className={d.path ? "" : "danger"} data-testid="library-forget" onClick={onForget}>
                {d.path ? "Remove from list" : "Delete"}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="hm-card-foot">
        <span className="hm-kinds" data-testid="library-item-kinds">
          {kinds.map((k) => <i key={k} title={kindName(k)} style={{ "--k": `var(--k-${k})` } as React.CSSProperties} />)}
        </span>
        <time data-testid="library-item-updated" dateTime={d.updatedAt}>{relativeTime(d.updatedAt, serverNow())}</time>
      </div>
    </li>
  );
}

export function Drawings({ list, onForget, example }: { list: DiagramSummary[] | null; onForget: (d: DiagramSummary) => void; example: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>(() => { try { return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; } });
  const [menu, setMenu] = useState<string | null>(null);
  const choose = (l: Layout) => { try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* private mode */ } setLayout(l); };
  // The row menu closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.("[data-testid=library-menu-list], [data-testid=library-menu]")) setMenu(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", close); };
  }, [menu]);

  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((d) => !q || d.title.toLowerCase().includes(q) || (d.link ?? d.path ?? "Imported").toLowerCase().includes(q));
  return (
    <section className={`hm-drawings${layout === "list" ? " list" : ""}`} id="drawings" aria-label="Drawings">
      <div className="hm-lib-head">
        <h2>Drawings <span className="hm-count" data-testid="library-count">{list?.length ?? 0}</span></h2>
        <label className="hm-search"><Icon name="search" size={16} />
          <input type="search" data-testid="library-search" aria-label="Search drawings" placeholder="Search drawings" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="hm-seg" data-testid="library-layout" role="group" aria-label="Layout">
          <button type="button" data-testid="library-layout-grid" aria-label="Grid" aria-pressed={layout === "grid"} onClick={() => choose("grid")}><Icon name="grid" size={16} /></button>
          <button type="button" data-testid="library-layout-list" aria-label="List" aria-pressed={layout === "list"} onClick={() => choose("list")}><Icon name="list" size={16} /></button>
        </div>
      </div>
      {list && list.length === 0 && (
        <div className="hm-empty" data-testid="library-empty">
          <span className="art" aria-hidden="true"><i /><i /><i /></span>
          <b>No drawings yet</b>
          {example}
        </div>
      )}
      {list && list.length > 0 && (
        <>
          <ul className="hm-grid" data-testid="library">
            {shown.map((d) => <Card key={d.id} d={d} menuOpen={menu === d.id} onMenu={(o) => setMenu(o ? d.id : null)} onForget={() => { setMenu(null); onForget(d); }} />)}
          </ul>
          {shown.length === 0 && <p className="hm-none" data-testid="library-none">No drawing matches "{query}"</p>}
        </>
      )}
    </section>
  );
}

/** `home-continue`: the newest drawing, waiting to be opened. */
export function Continue({ d }: { d: DiagramSummary }) {
  const ref = useRef<HTMLElement>(null);
  const preview = usePreview(d, ref);
  const open = () => navigate(`/d/${d.id}`);
  return (
    <section ref={ref} className="hm-panel hm-cont" data-testid="home-continue" aria-label="Continue">
      <header>Continue</header>
      <PreviewFrame preview={preview} index={0} testId="home-continue-preview" />
      <div className="pad">
        <b>{d.title}</b>
        <div className="meta"><span>edited {relativeTime(d.updatedAt, serverNow())}</span>
          <button type="button" className="btn small primary" data-testid="home-continue-open" onClick={open}>Open <Icon name="send" size={14} /></button>
        </div>
      </div>
    </section>
  );
}
