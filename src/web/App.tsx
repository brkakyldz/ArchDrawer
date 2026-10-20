import { useEffect, useState } from "react";
import { Editor } from "./editor/Editor";
import { EditorBoundary } from "./editor/LoadError";
import { Library } from "./library/Library";

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

export function App() {
  const { path, search } = useLocation();
  const m = /^\/d\/([^/]+)\/?$/.exec(path);
  if (!m) return <Library />;
  const q = new URLSearchParams(search);
  return <EditorBoundary key={m[1]}><Editor id={decodeURIComponent(m[1])} channel={q.get("channel")} view={q.get("view")} /></EditorBoundary>;
}
