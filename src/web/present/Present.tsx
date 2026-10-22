import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { joinChannel } from "../../core/channels";
import { renderSlide } from "../../core/export/slide";
import type { Document3 } from "../../core/file3";
import { atOf, firstIndex, indexOf, NO_NOTE, NO_STEPS, noteLines, SLIDE_SWITCHES, statusOf, type At } from "./slides";

/**
 * `present` (ui contract, Presenting and the tour; ADR 0012): a layer over the whole window that
 * shows core's slide image and nothing else. It edits nothing; while it is open the editor under it
 * takes no key (every key is taken here, in the capture phase) and no pointer (the layer covers it).
 */
export type PresentMode = "present" | "tour";

interface Props {
  mode: PresentMode;
  /** The stored document, live: an outside change re-renders the slide shown. */
  stored: Document3;
  toast: (m: string) => void;
  /** Leaves the layer; `step` is the step shown (null on the opening slide). */
  onLeave: (step: At) => void;
}

const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
const NEXT = new Set(["ArrowRight", "ArrowDown", " ", "Spacebar", "PageDown"]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

export function Present({ mode, stored, toast, onLeave }: Props) {
  const doc = useMemo(() => joinChannel(stored, "presentation"), [stored]);
  const steps = useMemo(() => doc.steps ?? [], [doc]);
  const empty = !doc.views.length || !steps.length;
  const [at, setAt] = useState<At>(() => (mode === "tour" ? (steps[0]?.id ?? null) : null));
  const index = empty ? 0 : Math.max(firstIndex(mode), indexOf(steps, at));
  const [noteOpen, setNoteOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const [full, setFull] = useState(false);
  const layer = useRef<HTMLDivElement>(null);

  // Leaving happens once, whichever way it comes (a key, Exit, the browser leaving full screen).
  const left = useRef(false);
  const shown = useRef<At>(null);
  shown.current = atOf(steps, index);
  const leave = useRef(() => {});
  leave.current = () => {
    if (left.current) return;
    left.current = true;
    if (document.fullscreenElement && document.fullscreenElement === layer.current) document.exitFullscreen().catch(() => {});
    onLeave(shown.current);
  };

  // An outside change: the step shown is followed by its id, a removed one gives way to the last
  // step, and with no step left the layer closes and says why.
  useLayoutEffect(() => {
    if (left.current) return;
    if (empty) { left.current = true; toast(NO_STEPS); onLeave(null); return; }
    if (at !== null && !steps.some((s) => s.id === at)) setAt(steps[steps.length - 1].id);
    else if (at === null && mode === "tour") setAt(steps[0].id);
  }, [steps, empty]); // eslint-disable-line react-hooks/exhaustive-deps

  // The hint stays until the slide first changes.
  const opened = useRef(index);
  useEffect(() => { if (index !== opened.current) setMoved(true); }, [index]);

  // Focus moves to the layer; presenting asks for full screen, and a refusal leaves the layer filling the window.
  useLayoutEffect(() => { layer.current?.focus(); }, []);
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    let was = false;
    const change = () => {
      const now = document.fullscreenElement === el;
      setFull(now);
      if (now) was = true;
      else if (was) leave.current();
    };
    document.addEventListener("fullscreenchange", change);
    if (mode === "present" && typeof el.requestFullscreen === "function") {
      try { el.requestFullscreen().catch(() => {}); } catch { /* unsupported: the layer stays, filling the window */ }
    }
    return () => {
      document.removeEventListener("fullscreenchange", change);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    };
  }, [mode]);

  const go = (i: number) => {
    if (empty || i < firstIndex(mode) || i > steps.length || i === index) return;
    setAt(atOf(steps, i));
  };

  // Every key while the layer is open is the layer's: the editor's own listeners never see it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const el = layer.current;
      if (!el) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((b) => b.offsetParent !== null || b.getClientRects().length > 0);
        if (!all.length) { el.focus(); return; }
        const i = all.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : (i < 0 || i === all.length - 1 ? 0 : i + 1);
        all[next].focus();
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); leave.current(); return; }
      // Space and Enter on a focused button activate it; no other key acts on a focused button.
      if (e.target instanceof Element && e.target.closest("button")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (NEXT.has(e.key)) { e.preventDefault(); go(index + 1); }
      else if (PREV.has(e.key)) { e.preventDefault(); go(index - 1); }
      else if (e.key === "Home") { e.preventDefault(); go(firstIndex(mode)); }
      else if (e.key === "End") { e.preventDefault(); go(steps.length); }
      else if ((e.key === "n" || e.key === "N") && mode === "present" && index > 0) { e.preventDefault(); setNoteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const svg = useMemo(() => {
    if (empty) return "";
    try { return renderSlide(doc, index, { theme: doc.theme, ...SLIDE_SWITCHES }).svg; } catch { return ""; }
  }, [doc, index, empty]);
  if (empty) return null;

  const step = index > 0 ? steps[index - 1] : null;
  const note = step ? noteLines(step.note) : null;
  const exit = <button className="btn small present-exit" data-testid="present-exit" onClick={() => leave.current()}>Exit</button>;

  return (
    <div className="present" data-testid="present" role="dialog" aria-modal="true" aria-label={mode === "tour" ? "Tour" : "Presentation"}
      data-mode={mode} data-index={index} data-fullscreen={full ? "true" : "false"} data-theme={doc.theme} tabIndex={-1} ref={layer}>
      <div className="sr-only" data-testid="present-status" role="status" aria-live="polite">{statusOf(doc, index)}</div>
      <div className="present-body">
        <div className="present-slide" data-testid="present-slide" onClick={() => go(index + 1)} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {mode === "present" && (
        <>
          <div className="present-top">{exit}</div>
          {!moved && <div className="present-hint" data-testid="present-hint">← → to move · Esc to exit</div>}
          {step && (
            <div className="present-notes">
              {noteOpen && (
                <div className="present-note" data-testid="present-note" id="present-note">
                  {note ? note.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>) : NO_NOTE}
                </div>
              )}
              <button className="btn small present-note-toggle" data-testid="present-note-toggle" aria-expanded={noteOpen} aria-controls="present-note"
                onClick={() => setNoteOpen((o) => !o)}>Speaker note</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The header buttons' icons (24-unit line icons, as the chrome's). */
const ICONS = {
  present: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5V20M8.5 20h7"/><path d="m10.5 8.5 4 2-4 2z"/>',
  tour: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
} as const;
export function PresentIcon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}
