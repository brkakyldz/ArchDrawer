import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DiagramSummary, type Sources } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { Logo } from "../ui/Logo";
import { ActivityPanel, ActivityToggle, JobNotice, useActivity } from "./Activity";
import { Continue, Drawings } from "./Drawings";
import { EngineChip, EnginePanel, useEngine } from "./Engine";
import { openUrl } from "./jobs";
import { ScanCard, StartPanel, useStart, type Ready } from "./Start";
import "./home.css";

/**
 * `/`: the home screen (ui contract, Home; DESIGN.md, Home screen). Three columns: the navigation (the drawings
 * and New drawing), the work column (the `Draw a project` panel over the drawings)
 * and the side column (Activity, then the newest drawing or the scanned repository, then the engine).
 */

const THEME_KEY = "archdraw-theme";
type Theme = "light" | "dark";
const storedTheme = (): Theme | null => { try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : null; } catch { return null; } };
const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const change = () => setOn(m.matches);
    change(); m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, [query]);
  return on;
}

/** The theme kept in this browser (the same stored choice `tool-theme` writes), else the system's. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const change = () => { if (!storedTheme()) setTheme(systemTheme()); };
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  const flip = () => setTheme((t) => { const next: Theme = t === "dark" ? "light" : "dark"; try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ } return next; });
  return { theme, flip };
}

export function Home() {
  const [list, setList] = useState<DiagramSummary[] | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);
  const [notice, setNotice] = useState<Ready | null>(null);
  // The draws this page saw running, and those it already said were ready.
  const sawRunning = useRef(new Set<string>());
  const noticed = useRef(new Set<string>());
  const file = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLButtonElement>(null);
  const { theme, flip } = useTheme();
  const narrow = useMedia("(max-width: 640px)");
  const folded = useMedia("(max-width: 1240px)");
  const engine = useEngine();
  const activity = useActivity();
  const load = () => api.list().then(setList, (e: Error) => setError(e.message));
  /** A draw the page saw running is ready: the notice, once per draw; its file is new in the library. */
  const tell = (r: Ready) => {
    if (noticed.current.has(r.runId)) return;
    noticed.current.add(r.runId); setNotice(r); void load();
  };
  const start = useStart({
    engine, activity: activity.data, onJob: activity.bump,
    onDrawn: (r) => { if (r) tell(r); else void load(); },
  });
  // Activity also tells of the draws that end while the panel follows another job.
  useEffect(() => {
    for (const j of activity.data?.jobs ?? []) {
      if (j.type !== "draw") continue;
      if (j.status === "running") sawRunning.current.add(j.id);
      else if (j.status === "succeeded" && j.diagramId && sawRunning.current.has(j.id)) tell({ runId: j.id, name: j.name ?? "The drawing", url: openUrl(j.diagramId, j.choice, j.channel) });
    }
  }, [activity.data]);
  // Whether `Choose folder…` shows is asked once, when the page loads (ui contract, Choosing a repository).
  useEffect(() => { void load(); void api.sources().then(setSources, () => undefined); document.title = "archdrawer"; }, []);

  // `Ctrl K` (`⌘ K` on macOS): the folder field, after freeing the panel when it follows a job.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(mac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault(); start.fresh();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const toStart = () => document.getElementById("start")?.scrollIntoView({ block: "start", behavior: "smooth" });
  // A scan the panel follows that waits for a free engine says so (its job in Activity).
  const scanWaits = !!start.scanning?.id && !!activity.data?.jobs.some((j) => j.id === start.scanning!.id && j.waiting === true);

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
    setError(null);
    if (!confirm(d.path ? `Remove "${d.title}" from this list? The file stays where it is.` : `Delete the imported drawing "${d.title}"?`)) return;
    const copy = !!d.link && confirm(`Also delete the copy of ${d.link} from this computer?`);
    await api.forget(d.id, copy).catch((e: Error) => setError(e.message));
    void load();
  };

  const example = async () => {
    setExampleBusy(true); setError(null);
    try { navigate(`/d/${await api.example()}`); }
    catch (e) { setError((e as Error).message); setExampleBusy(false); }
  };
  const exampleButton = <button type="button" className="btn" data-testid="library-example" disabled={exampleBusy} onClick={() => void example()}><Icon name="open" size={16} />Open the example drawing</button>;
  const empty = list !== null && list.length === 0;

  return (
    <div className="home" data-testid="home" data-theme={theme}>
      <header className="hm-bar">
        <a className="hm-brand" href="/" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0 }); }}><Logo /></a>
        <span className="bar-sep" aria-hidden="true" />
        <span className="hm-crumb">Drawings</span>
        <span className="grow" />
        {folded && <ActivityToggle data={activity.data} />}
        <EngineChip engine={engine.engine} />
        <button type="button" className="btn icon-btn" data-testid="home-theme" aria-label="Switch theme" onClick={flip}><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
        <button type="button" className="btn hm-import" data-testid="home-import" onClick={() => file.current?.click()}><Icon name="download" size={16} /><span>Import</span></button>
        <input data-testid="import-input" ref={file} type="file" accept=".json,application/json" hidden tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
      </header>
      {error && <p className="hm-form-error" data-testid="form-error" role="alert">{error}</p>}
      {notice && <JobNotice ready={notice} onClose={() => setNotice(null)} />}
      <div className="hm-shell">
        <nav className="hm-nav" data-testid="home-nav" aria-label="Library">
          <button type="button" className="hm-nav-a on" data-testid="home-nav-drawings"
            onClick={() => document.getElementById("drawings")?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            <Icon name="layers" size={18} />Drawings <span className="n">{list?.length ?? 0}</span>
          </button>
          <button type="button" className="hm-nav-a" data-testid="home-nav-new" onClick={() => { start.newDrawing(); toStart(); }}><Icon name="plus" size={18} />New drawing</button>
          <p className="hm-server" data-testid="home-server"><span className="hm-dot" aria-hidden="true" />{location.host}</p>
        </nav>
        <main className="hm-work">
          <div className="hm-work-in">
            <StartPanel s={start} sources={sources} scanWaits={scanWaits} timeoutMs={activity.data?.timeoutMs ?? null} narrow={narrow} folderRef={folderRef} scanRef={scanRef} />
            <Drawings list={list} onForget={(d) => void forget(d)} example={exampleButton} />
          </div>
        </main>
        <aside className="hm-rail" aria-label="Activity and engine">
          <ActivityPanel data={activity.data} restarted={activity.restarted} followed={start.followed} onFollow={(j) => { start.followJob(j); toStart(); }} />
          {start.scan ? <ScanCard s={start} /> : start.step === "Folder" && list && list.length > 0 && <Continue d={list[0]} />}
          <EnginePanel state={engine} busy={start.busy} example={empty ? null : exampleButton} />
        </aside>
      </div>
    </div>
  );
}
