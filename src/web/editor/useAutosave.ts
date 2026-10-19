import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DiagramDocument } from "../../core/model";
import { api, ApiError } from "../api";

export type SaveStatus = "saved" | "saving" | "error" | "conflict";
const DEBOUNCE_MS = 350;

/**
 * Persist every change (ui contract, `save-status`). One request in flight at a time and always
 * the latest document, so an older save never lands after a newer one (autosave race). Each save
 * names the version it was based on; a file that moved on (a session, the CLI) answers 409 and
 * the editor says so instead of overwriting it. A failed save never shows as "Saved".
 */
export function useAutosave(doc: DiagramDocument | null) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<DiagramDocument | null>(null);
  const base = useRef<string | null>(null);
  const pending = useRef<DiagramDocument | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);

  const pump = useCallback(() => {
    if (inFlight.current || !pending.current || blocked.current) return;
    const next = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus("saving");
    api.save(next, base.current).then(
      (r) => {
        inFlight.current = false;
        saved.current = next;
        base.current = r.updatedAt;
        if (pending.current) pump();
        else { setStatus("saved"); setError(null); }
      },
      (e: unknown) => {
        inFlight.current = false;
        if (!pending.current) pending.current = next;
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setStatus("conflict");
          setError("The file changed outside the editor");
        } else {
          setStatus("error");
          setError(e instanceof ApiError ? e.message : "Could not reach the archdrawer server");
        }
      },
    );
  }, []);

  /** The server has this document (just loaded, or written by the server): nothing to save. */
  const markSaved = useCallback((d: DiagramDocument) => {
    saved.current = d;
    base.current = d.updatedAt;
    pending.current = null;
    blocked.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setStatus("saved");
    setError(null);
  }, []);

  // A layout effect: an unsaved change shows as "Saving" in the same frame, never as "Saved".
  useLayoutEffect(() => {
    if (!doc) return;
    if (doc === saved.current && !inFlight.current) {
      pending.current = null;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (!blocked.current) setStatus("saved");
      return;
    }
    pending.current = doc;
    if (blocked.current) return;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; pump(); }, DEBOUNCE_MS);
  }, [doc, pump]);

  const retry = useCallback(() => pump(), [pump]);

  /** True when every edit has reached the file. */
  const clean = useCallback(() => !pending.current && !inFlight.current && !timer.current && !blocked.current, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current || inFlight.current || timer.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { status, error, markSaved, retry, clean };
}
