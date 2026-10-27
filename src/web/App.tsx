import { useEffect, useState } from "react";
import { Editor } from "./editor/Editor";
import { EditorBoundary } from "./editor/LoadError";
import { Home } from "./home/Home";

export function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useLocation() {
  const [loc, setLoc] = useState({ path: location.pathname, search: location.search });
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return loc;
}

/** An id whose percent-encoding is broken (`/d/%ZZ`) stays as typed: no drawing has it, so the editor shows `not-found`. */
function decodeId(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function App() {
  const { path, search } = useLocation();
  const m = /^\/d\/([^/]+)\/?$/.exec(path);
  if (!m) return <Home />;
  const q = new URLSearchParams(search);
  return <EditorBoundary key={m[1]}><Editor id={decodeId(m[1])} choice={q.get("choice")} channel={q.get("channel")} view={q.get("view")} /></EditorBoundary>;
}
