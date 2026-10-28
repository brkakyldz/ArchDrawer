import type { Sources } from "../api";
import { Icon } from "../ui/Icon";
import type { StartState } from "./Start";

/**
 * Where a repository comes from (ui contract, Home, *Choosing a repository*; api contract, Sources): the tabs
 * This computer and Link, the path field, `Choose folder…`, and the link field checked as it is typed.
 */

const LINK_HINT = "A github.com, gitlab.com or bitbucket.org link, public or reachable with your own git sign-in.";

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
        {local ? <FolderBox s={s} folderRef={folderRef} /> : (
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

/** `start-folder`: a plain text field for a pasted path; Enter presses Scan. */
function FolderBox({ s, folderRef }: { s: StartState; folderRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <label className="hm-field">
      <Icon name="folder" size={18} />
      {/* The field shows the followed job's folder, a copy by its link. */}
      <input ref={folderRef} type="text" data-testid="start-folder" aria-label="Folder of the project"
        placeholder="Paste the path of a folder" autoComplete="off" spellCheck={false} value={s.fieldText} disabled={s.following}
        onChange={(e) => s.setFolder(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void s.onScan(); } }} />
    </label>
  );
}
