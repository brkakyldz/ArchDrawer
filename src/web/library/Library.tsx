import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DiagramSummary } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { Logo } from "../ui/Logo";
import { Start } from "./Start";
import { DrawingArtwork } from "./DrawingArtwork";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** `/`: start a drawing from a folder, the drawings this server has opened, and import (ui contract, Library). */
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
      <div className="lib-frame">
        <header className="lib-appbar">
          <div className="lib-appbar-brand">
            <Logo size={25} />
            <span className="lib-appbar-divider" aria-hidden="true" />
            <span className="lib-appbar-location">Workspace <span>/</span> Overview</span>
          </div>
          <div className="lib-appbar-actions">
            <span className="lib-local-status"><span className="lib-status-dot" /> Local workspace</span>
            <label className="btn lib-import">
              <Icon name="download" size={16} /> <span>Import drawing</span>
              <input data-testid="import-input" ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
            </label>
          </div>
        </header>

        <div className="lib-shell">
          <nav className="lib-navigation" aria-label="Workspace navigation">
            <div className="lib-nav-heading">WORKSPACE</div>
            <a className="lib-nav-link active" href="#drawings"><Icon name="layers" size={18} /> All drawings <span className="lib-nav-count">{list?.length ?? "·"}</span></a>
            <a className="lib-nav-link" href="#create"><Icon name="plus" size={18} /> New drawing</a>
            <div className="lib-nav-divider" />
            <div className="lib-nav-heading">RECENT PROJECTS</div>
            <div className="lib-nav-recents">
              {(list ?? []).slice(0, 5).map((d) => (
                <button className="lib-recent-link" key={d.id} onClick={() => navigate(`/d/${d.id}`)} title={d.path ?? d.title}>
                  <span className="lib-recent-symbol"><Icon name="file" size={14} /></span>
                  <span className="lib-recent-name">{d.title}</span>
                  <Icon name="open" size={13} className="lib-recent-arrow" />
                </button>
              ))}
              {list && list.length === 0 && <span className="lib-nav-empty">Your recent projects will appear here.</span>}
            </div>
            <div className="lib-nav-foot">
              <div className="lib-foot-symbol"><Icon name="dock" size={19} /></div>
              <div><strong>Your code stays yours.</strong><p>Powered by your local AI tools.</p></div>
            </div>
          </nav>

          <main className="lib-content">
            <div className="lib-content-inner">
              <div className="lib-intro">
                <div className="lib-intro-eyebrow"><span className="lib-intro-spark">✦</span> YOUR ARCHITECTURE WORKSPACE</div>
                <h1>Make sense of <em>what you build.</em></h1>
                <p>Explore the structure behind your code, then turn it into clear, beautiful diagrams ready to share.</p>
                <div className="lib-intro-metrics">
                  <span><strong>{list?.length ?? "—"}</strong> drawings</span>
                  <i aria-hidden="true" />
                  <span><Icon name="spark" size={14} /> AI-assisted mapping</span>
                  <i aria-hidden="true" />
                  <span><Icon name="layers" size={14} /> Fully editable</span>
                </div>
              </div>

              {error && <p className="form-error" data-testid="form-error" role="alert">{error}</p>}

              <div id="create" className="lib-create">
                <Start list={list} onExample={() => void example()} exampleBusy={busy} />
              </div>

              <section className="lib-gallery" id="drawings" aria-label="Your drawings">
                <div className="lib-gallery-heading">
                  <div>
                    <span className="lib-section-overline">YOUR LIBRARY</span>
                    <h2>Recent drawings <span>{list?.length ?? 0}</span></h2>
                  </div>
                  <span className="lib-gallery-detail">Your saved architecture work</span>
                </div>

                {list && list.length > 0 ? (
                  <ul className="lib-grid" data-testid="library">
                    {list.map((d, index) => (
                      <li className="lib-drawing-card" key={d.id} data-testid="library-item" data-diagram-id={d.id}>
                        <div className="lib-artwork">
                          <DrawingArtwork variant={index % 4} />
                          <span className="lib-artwork-label"><span className="lib-artwork-dot" /> ARCHITECTURE</span>
                        </div>
                        <div className="lib-drawing-content">
                          <div className="lib-drawing-top">
                            <div className="t">
                              <b data-testid="library-item-title">{d.title}</b>
                              <span className="p" data-testid="library-item-path" title={d.path ?? undefined}>{d.path ?? "Imported"}</span>
                            </div>
                            <div className="row-menu">
                              <button className="btn small icon-btn" data-testid="library-menu" aria-label={`More actions for ${d.title}`} aria-haspopup="menu" aria-expanded={menu === d.id}
                                onClick={() => setMenu(menu === d.id ? null : d.id)}><Icon name="more" size={17} /></button>
                              {menu === d.id && (
                                <div className="menu" role="menu" data-testid="library-menu-list">
                                  <button role="menuitem" className={d.path ? "" : "danger"} data-testid="library-forget" onClick={() => void forget(d)}>
                                    {d.path ? "Remove from list" : "Delete"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="lib-drawing-bottom">
                            <span className="when"><Icon name="file" size={13} /> {when(d.updatedAt)}</span>
                            <button className="btn small primary" data-testid="library-open" onClick={() => navigate(`/d/${d.id}`)}>Open drawing <Icon name="send" size={14} /></button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : list && list.length === 0 ? (
                  <div className="lib-empty">
                    <div className="lib-empty-icon"><Icon name="layers" size={26} /></div>
                    <h3>A blank canvas, full of possibilities.</h3>
                    <p>Scan a repository above to create your first architecture drawing, or start with the example.</p>
                    <button className="btn" data-testid="library-empty-example" disabled={busy} onClick={() => void example()}><Icon name="open" size={15} /> Explore example</button>
                  </div>
                ) : (
                  <div className="lib-list-loading" role="status">Loading your drawings…</div>
                )}
              </section>
              <footer className="lib-content-footer">ARCHDRAWER <span>·</span> FROM SOURCE CODE TO SHARED UNDERSTANDING</footer>
            </div>
          </main>

          <aside className="lib-guide" aria-label="Getting started">
            <div className="lib-guide-heading">
              <span className="lib-section-overline">THE PROCESS</span>
              <h2>Code to canvas.</h2>
              <p>Three simple steps to bring your system into focus.</p>
            </div>
            <div className="lib-guide-steps">
              <div className="lib-guide-step">
                <span className="lib-guide-number">01</span>
                <div><strong>Connect your code</strong><p>Point Archdrawer to a folder on your computer.</p></div>
              </div>
              <div className="lib-guide-step">
                <span className="lib-guide-number">02</span>
                <div><strong>Choose your story</strong><p>Pick an overview, a feature, or a specific flow.</p></div>
              </div>
              <div className="lib-guide-step">
                <span className="lib-guide-number">03</span>
                <div><strong>Make it yours</strong><p>Fine-tune your diagram and export it anywhere.</p></div>
              </div>
            </div>
            <div className="lib-guide-note">
              <div className="lib-guide-note-mark"><Icon name="spark" size={17} /></div>
              <strong>Understand, don't just document.</strong>
              <p>Give your work the clarity it deserves.</p>
              <div className="lib-guide-note-graphic" aria-hidden="true"><span /><i /><span /><i /><span /></div>
            </div>
            <div className="lib-guide-foot"><span className="lib-status-dot" /> Runs on your machine</div>
          </aside>
        </div>
      </div>
    </div>
  );
}
