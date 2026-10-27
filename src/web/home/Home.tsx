import { useEffect, useRef, useState } from "react";
import { api, ApiError, type DiagramSummary, type SourceEntry, type Sources } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { Logo } from "../ui/Logo";
import { ActivityPanel, ActivityToggle, useActivity } from "./Activity";
import { Continue, Drawings } from "./Drawings";
import { EngineChip, EnginePanel, useEngine } from "./Engine";
import { ScanCard, StartPanel, useStart } from "./Start";
import { relativeTime, serverNow } from "./time";
import "./home.css";

/**
 * `/`: the home screen (ui contract, Home; DESIGN.md, Home screen). Three columns: the navigation (the drawings,
 * New drawing, Recent and Found on this computer), the work column (the `Draw a project` panel over the drawings)
 * and the side column (Activity, then the newest drawing or the scanned repository, then the engine).
 */

const THEME_KEY = "archdraw-theme";
type Theme = "light" | "dark";
const storedTheme = (): Theme | null => { try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : null; } catch { return null; } };
const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
/** Recent and Found take the kind hues in turn for their swatches. */
const SWATCHES = ["api", "llm", "service", "data", "ops", "client", "worker", "gate"] as const;
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

/** `<branch> · <age of the last commit>`, either part left out when unknown. */
const sourceLine = (e: SourceEntry) => [e.branch, relativeTime(e.lastCommitAt, serverNow())].filter(Boolean).join(" · ");

function SourceList({ testId, title, entries, onTake }: { testId: string; title: string; entries: SourceEntry[]; onTake: (path: string) => void }) {
  if (!entries.length) return null;
  return (
    <div className="hm-src">
      <h3>{title}</h3>
      <div data-testid={testId}>
        {entries.map((e, i) => (
          <button key={e.path} type="button" className="hm-src-item" data-testid="source-item" data-path={e.path} title={e.link ?? e.path} onClick={() => onTake(e.path)}>
            <i className="sw" style={{ background: `var(--k-${SWATCHES[i % SWATCHES.length]})` }} aria-hidden="true" />
            <span className="t"><span className="n">{e.name}</span>{sourceLine(e) && <span className="m">{sourceLine(e)}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Home() {
  const [list, setList] = useState<DiagramSummary[] | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLButtonElement>(null);
  const { theme, flip } = useTheme();
  const narrow = useMedia("(max-width: 640px)");
  const folded = useMedia("(max-width: 1240px)");
  const engine = useEngine();
  const activity = useActivity();
  const start = useStart({ engine, list, onJob: activity.bump });

  const load = () => api.list().then(setList, (e: Error) => setError(e.message));
  const loadSources = () => api.sources().then(setSources, () => undefined);
  useEffect(() => { void load(); void loadSources(); document.title = "archdrawer"; }, []);
  // A scan that succeeded joins Recent.
  useEffect(() => { if (start.scan) void loadSources(); }, [start.scan?.id]);

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
  const take = (path: string) => { start.take(path); toStart(); };

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
    void load(); void loadSources();
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
      <div className="hm-shell">
        <nav className="hm-nav" data-testid="home-nav" aria-label="Library">
          <button type="button" className="hm-nav-a on" data-testid="home-nav-drawings"
            onClick={() => document.getElementById("drawings")?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            <Icon name="layers" size={18} />Drawings <span className="n">{list?.length ?? 0}</span>
          </button>
          <button type="button" className="hm-nav-a" data-testid="home-nav-new" onClick={() => { start.fresh(); toStart(); }}><Icon name="plus" size={18} />New drawing</button>
          <SourceList testId="source-recent" title="Recent" entries={sources?.recent ?? []} onTake={take} />
          <SourceList testId="source-found" title="Found on this computer" entries={sources?.found ?? []} onTake={take} />
          <p className="hm-server" data-testid="home-server"><span className="hm-dot" aria-hidden="true" />{location.host}</p>
        </nav>
        <main className="hm-work">
          <div className="hm-work-in">
            <StartPanel s={start} narrow={narrow} folderRef={folderRef} scanRef={scanRef} />
            <Drawings list={list} onForget={(d) => void forget(d)} example={exampleButton} />
          </div>
        </main>
        <aside className="hm-rail" aria-label="Activity and engine">
          <ActivityPanel data={activity.data} />
          {start.scan ? <ScanCard s={start} /> : start.step === "Folder" && list && list.length > 0 && <Continue d={list[0]} />}
          <EnginePanel state={engine} busy={start.busy} example={empty ? null : exampleButton} />
        </aside>
      </div>
    </div>
  );
}
