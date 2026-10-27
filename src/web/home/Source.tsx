import { useState } from "react";
import type { SourceEntry, Sources } from "../api";
import { Icon } from "../ui/Icon";
import type { StartState } from "./Start";
import { relativeTime, serverNow } from "./time";

/**
 * Where a repository comes from (ui contract, Home, *Choosing a repository*; api contract, Sources): the tabs
 * This computer and Link, the folder combobox over Recent and Found on this computer, `Choose folder…`, the link
 * field checked as it is typed, and the same two lists in the navigation.
 */

/** Recent and Found take the kind hues in turn for their swatches. */
const SWATCHES = ["api", "llm", "service", "data", "ops", "client", "worker", "gate"] as const;
const swatch = (i: number) => `var(--k-${SWATCHES[i % SWATCHES.length]})`;
/** A text that starts like a path is a pasted path: the list stays closed. */
const PATHY = /^([A-Za-z]:[\\/]|\\\\|\/|~[\\/])/;
const LINK_HINT = "A github.com, gitlab.com or bitbucket.org link, public or reachable with your own git sign-in.";

/** `<branch> · <age of the last commit>`, either part left out when unknown. */
export const sourceLine = (e: SourceEntry) => [e.branch, relativeTime(e.lastCommitAt, serverNow())].filter(Boolean).join(" · ");

/** The tabs, then the field of the chosen tab with `Choose folder…` and Scan, then the link's hint. */
export function SourceRow({ s, sources, folderRef, scanRef }: {
  s: StartState; sources: Sources | null;
  folderRef: React.RefObject<HTMLInputElement | null>; scanRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const local = s.source === "local";
  const tab = (id: "local" | "link", label: string, icon: string) => (
    <button type="button" role="tab" data-testid={`start-source-${id}`} aria-selected={s.source === id} tabIndex={s.source === id ? 0 : -1}
      disabled={s.following} onClick={() => s.chooseSource(id)}
      onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); s.chooseSource(id === "local" ? "link" : "local"); } }}>
      <Icon name={icon} size={15} />{label}
    </button>
  );
  const showPick = local && s.step === "Folder" && !!sources?.picker && !s.pickGone;
  const showScan = !s.following || !!s.scanning;
  return (
    <>
      <div className="hm-src-tabs" role="tablist" aria-label="Where the repository is" data-testid="start-source">
        {tab("local", "This computer", "monitor")}
        {tab("link", "Link", "link")}
      </div>
      <div className="hm-folder-row">
        {local ? <FolderBox s={s} sources={sources} folderRef={folderRef} /> : (
          <label className="hm-field"><Icon name="link" size={18} />
            <input type="text" data-testid="start-link" aria-label="Repository link" placeholder="https://github.com/owner/repo" autoComplete="off" spellCheck={false}
              value={s.link} disabled={s.following} onChange={(e) => s.setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void s.onScan(); } }} />
          </label>
        )}
        {showPick && (
          <button type="button" className="btn hm-pick" data-testid="start-pick" disabled={s.picking || s.following} onClick={() => void s.pick()}>
            <Icon name="folder" size={16} />{s.picking ? "Dialog open…" : "Choose folder…"}
          </button>
        )}
        {showScan && (
          <button ref={scanRef} type="button" className="btn primary" data-testid="start-scan"
            disabled={!s.engine || s.following || (!local && !s.linkOk)} onClick={() => void s.onScan()}>Scan</button>
        )}
      </div>
      {!local && <LinkHint s={s} />}
    </>
  );
}

/** `start-link-hint`: what the latest check said of the link, or what a link may be. */
function LinkHint({ s }: { s: StartState }) {
  const c = s.link.trim() ? s.linkCheck : null;
  if (c?.error) return <p className="hm-hint bad" data-testid="start-link-hint" role="alert">{c.error}</p>;
  if (c?.answer) {
    const a = c.answer;
    return (
      <p className="hm-hint ok" data-testid="start-link-hint">
        <Icon name="check" size={15} stroke={2.4} />
        <span><b>{a.link}</b>{a.branch ? `, branch ${a.branch}` : ""}{a.copied ? " · already on this computer" : " · copied into archdrawer's own folder, read-only"}</span>
      </p>
    );
  }
  return <p className="hm-hint" data-testid="start-link-hint">{LINK_HINT}</p>;
}

/**
 * `start-folder`: a combobox over Recent and Found on this computer. Focusing or typing opens the list unless the
 * text starts like a path; ArrowDown/ArrowUp move the highlight, Enter takes it (or presses Scan), Escape closes.
 */
function FolderBox({ s, sources, folderRef }: { s: StartState; sources: Sources | null; folderRef: React.RefObject<HTMLInputElement | null> }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const q = s.folder.trim().toLowerCase();
  const pathy = PATHY.test(s.folder.trim());
  const holds = (e: SourceEntry) => !q || e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q);
  const recent = (sources?.recent ?? []).filter(holds), found = (sources?.found ?? []).filter(holds);
  const all = [...recent, ...found];
  const shown = open && !pathy && !s.following && (sources === null || all.length > 0 || q !== "");
  // The field shows the followed job's folder, a copy by its link.
  const value = s.following && s.scan?.link ? s.scan.link : s.folder;
  const close = () => { setOpen(false); setHi(-1); };
  const take = (e: SourceEntry) => { close(); s.take(e.path); };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (pathy || !all.length) return;
      e.preventDefault(); setOpen(true);
      const down = e.key === "ArrowDown";
      setHi((h) => (down ? (h + 1) % all.length : h <= 0 ? all.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown && all[hi]) take(all[hi]); else { close(); void s.onScan(); }
    } else if (e.key === "Escape" && shown) { e.preventDefault(); close(); }
  };
  const group = (title: string, entries: SourceEntry[], from: number) => entries.length > 0 && (
    <div role="group" aria-label={title}>
      <div className="h" aria-hidden="true">{title}</div>
      {entries.map((e, j) => {
        const i = from + j, line = sourceLine(e);
        return (
          <div key={e.path} id={`start-folder-option-${i}`} role="option" aria-selected={i === hi} className={i === hi ? "on" : undefined}
            data-testid="start-folder-option" data-path={e.path} onMouseDown={(ev) => ev.preventDefault()} onClick={() => take(e)} onMouseMove={() => setHi(i)}>
            <i className="sw" style={{ background: swatch(i) }} aria-hidden="true" />
            <b>{e.name}</b>{" "}<span className="p">{e.link ?? e.path}</span>{line && <>{" "}<span className="m">{line}</span></>}
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="hm-field">
      <Icon name="folder" size={18} />
      <input ref={folderRef} type="text" data-testid="start-folder" role="combobox" aria-label="Folder of the project" aria-autocomplete="list"
        aria-expanded={shown} aria-controls="start-folder-list" aria-activedescendant={shown && hi >= 0 ? `start-folder-option-${hi}` : undefined}
        placeholder="Search your repositories, or paste a path" autoComplete="off" spellCheck={false} value={value} disabled={s.following}
        onFocus={() => setOpen(true)} onBlur={close} onChange={(e) => { s.setFolder(e.target.value); setOpen(true); setHi(-1); }} onKeyDown={key} />
      {shown && (
        <div className="hm-combo" id="start-folder-list" data-testid="start-folder-list" role="listbox" aria-label="Repositories">
          {group("Recent", recent, 0)}
          {group("Found on this computer", found, recent.length)}
          {sources !== null && !all.length && (
            <p className="none" data-testid="start-folder-none">No repository here matches "{s.folder.trim()}". Paste the whole path, or choose the folder.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** *Recent* or *Found on this computer* in the navigation: one `source-item` per entry. */
export function SourceList({ testId, title, entries, onTake, onForget, extra }: {
  testId: string; title: string; entries: SourceEntry[]; onTake: (path: string) => void; onForget?: (e: SourceEntry) => void; extra?: React.ReactNode;
}) {
  return (
    <div className="hm-src">
      <h3><span>{title}</span>{extra}</h3>
      <div data-testid={testId}>
        {entries.map((e, i) => {
          const line = sourceLine(e);
          return (
            <div key={e.path} className="hm-src-item" data-testid="source-item" data-path={e.path}>
              <button type="button" className="take" title={e.link ?? e.path} onClick={() => onTake(e.path)}>
                <i className="sw" style={{ background: swatch(i) }} aria-hidden="true" />
                <span className="t"><span className="n">{e.name}</span>{line && <>{" "}<span className="m">{line}</span></>}</span>
              </button>
              {onForget && e.diagrams.length === 0 && (
                <button type="button" className="forget" data-testid="source-forget" aria-label={`Remove ${e.name} from Recent`} title={`Remove ${e.name} from Recent`} onClick={() => onForget(e)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
