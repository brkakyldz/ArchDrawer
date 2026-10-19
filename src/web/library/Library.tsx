import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DiagramSummary } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** `/`: the drawings this server has opened, and import (ui contract, Library). */
export function Library() {
  const [list, setList] = useState<DiagramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const theme = (localStorage.getItem("archdraw-theme") as "light" | "dark" | null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  const load = () => api.list().then(setList, (e: Error) => setError(e.message));
  useEffect(() => { void load(); document.title = "archdrawer"; }, []);
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

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const id = await api.import(JSON.parse(await f.text()));
      navigate(`/d/${id}`);
    } catch (e) {
      const errs = e instanceof ApiError && Array.isArray(e.body?.errors) ? `\n${(e.body!.errors as string[]).slice(0, 8).join("\n")}` : "";
      setError(e instanceof SyntaxError ? `Not a JSON file: ${e.message}` : `${(e as Error).message}${errs}`);
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const forget = async (d: DiagramSummary) => {
    setMenu(null);
    if (!confirm(d.path ? `Remove "${d.title}" from this list? The file stays where it is.` : `Delete the imported drawing "${d.title}"?`)) return;
    await api.forget(d.id).catch((e: Error) => setError(e.message));
    void load();
  };

  const example = async () => {
    setBusy(true); setError(null);
    try { navigate(`/d/${await api.example()}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="lib" data-theme={theme}>
      <div className="lib-in">
        <div className="lib-top">
          <span className="mark" aria-hidden="true"><Icon name="mark" size={16} stroke={2} /></span>
          <h1>Drawings</h1>
          <div className="right">
            <label className="btn">
              <Icon name="file" size={16} /> Import a drawing
              <input data-testid="import-input" ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
            </label>
          </div>
        </div>
        {error && <p className="form-error" data-testid="form-error" role="alert">{error}</p>}
        {list && list.length === 0 && (
          <div className="help" data-testid="start-help">
            <h2>Start a drawing from your coding agent</h2>
            <p>In Claude Code or Codex, with the archdrawer plugin installed, ask in your repository:</p>
            <p><code>/archdrawer:archdrawer</code> — or just “draw the architecture of this repo”.</p>
            <p>The session reads the code, writes the drawing file and opens it here. You can also open a file yourself with <code>archdrawer open &lt;file&gt;</code>.</p>
            <button className="btn primary" data-testid="library-example" disabled={busy} onClick={() => void example()}>
              <Icon name="open" size={16} /> Open the example drawing
            </button>
          </div>
        )}
        {list && list.length > 0 && (
          <ul data-testid="library">
            {list.map((d) => (
              <li key={d.id} data-testid="library-item" data-diagram-id={d.id}>
                <div className="t">
                  <b data-testid="library-item-title">{d.title}</b>
                  <span className="p" data-testid="library-item-path" title={d.path ?? undefined}>{d.path ?? "Imported"}</span>
                </div>
                <span className="when">{when(d.updatedAt)}</span>
                <button className="btn small primary" data-testid="library-open" onClick={() => navigate(`/d/${d.id}`)}>Open</button>
                <div className="row-menu">
                  <button className="btn small icon-btn" data-testid="library-menu" aria-label={`More actions for ${d.title}`} aria-haspopup="menu" aria-expanded={menu === d.id}
                    onClick={() => setMenu(menu === d.id ? null : d.id)}>⋯</button>
                  {menu === d.id && (
                    <div className="menu" role="menu" data-testid="library-menu-list">
                      <button role="menuitem" className={d.path ? "" : "danger"} data-testid="library-forget" onClick={() => void forget(d)}>
                        {d.path ? "Remove from list" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
