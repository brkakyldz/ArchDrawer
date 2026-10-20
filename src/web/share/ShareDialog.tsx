import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { makeLinkedInView, rearrangeForFeed } from "../../core/export/feed";
import { layoutView } from "../../core/layout";
import { FORMATS, renderShare, startSwitches, type FormatId, type ShareOptions, type ShareSwitches } from "../../core/export/share";
import { isLinkedInView, LIMITS, slugify, type DiagramDocument, type DiagramView, type Theme } from "../../core/model";
import type { Runner } from "../editor/runner";
import { Icon } from "../ui/Icon";
import { LayoutReportLine } from "../ui/LayoutReport";
import { reportOf } from "../../core/report";
import sansUrl from "../fonts/Geist-Variable.woff2?url";
import monoUrl from "../fonts/GeistMono-Variable.woff2?url";

/** `Where will you share it?` (ui contract, Share); the landscape LinkedIn post sits under Advanced. */
const WHERE: { id: FormatId; label: string }[] = [
  { id: "feed", label: "LinkedIn" },
  { id: "readme", label: "README" },
  { id: "slide", label: "Slide" },
  { id: "square", label: "Square post" },
];
type Show = ShareSwitches;
const SHOW: { key: keyof Show; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "lede", label: "Description" },
  { key: "items", label: "What each part holds" },
  { key: "steps", label: "Numbered main path" },
  { key: "labels", label: "Connection labels" },
  { key: "legend", label: "Colour key" },
  { key: "texts", label: "Texts" },
];
/** The toggles a choice starts with: Detailed for README, Slide and the landscape post, Simple for Square. */
const startFor = startSwitches;
const SAVED = "Saved in the file for your next archdrawer session";
const REWRITE = "Rewrite this post in plain words for someone who has never seen the project";

/** A view placed by lanes can be placed again for either orientation. */
const hasLanes = (v: DiagramView) => v.nodes.some((n) => n.lane);
const place = (v: DiagramView, portrait: boolean): DiagramView =>
  ({ ...v, ...layoutView({ ...v, nodes: v.nodes.map((n) => ({ ...n, x: undefined, y: undefined })) }, { portrait, post: true }) });
const samePlaces = (a: DiagramView, b: DiagramView) => a.nodes.every((n, i) => n.x === b.nodes[i]?.x && n.y === b.nodes[i]?.y);
/** The post as the chosen orientation shows it: re-placed only when it sits as the other one does (edits by hand stay). */
function orient(v: DiagramView, portrait: boolean): DiagramView {
  if (!hasLanes(v)) return v;
  const want = place(v, portrait);
  return !samePlaces(v, want) && samePlaces(v, place(v, !portrait)) ? want : v;
}

let fontCache: Promise<{ sans: string; mono: string }> | null = null;
const b64 = async (url: string) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Geist and Geist Mono as base64, embedded only in downloads so they render the same anywhere. */
const fonts = () => (fontCache ??= Promise.all([b64(sansUrl), b64(monoUrl)]).then(([sans, mono]) => ({ sans, mono })));

async function toPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("The image could not be drawn")); img.src = url; });
    const c = document.createElement("canvas");
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext("2d")!;
    g.scale(2, 2);
    g.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  doc: DiagramDocument;
  /** The view the editor shows: the one the dialog shares, or whose LinkedIn version it prepares. */
  view: DiagramView;
  runner: Runner;
  /** The engine and model a rewrite uses (ui contract, Choosing the engine). */
  engine: string | null;
  /** How the engine is named (the fixture is `Test engine (no AI)`). */
  engineLabel?: string | null;
  model: string;
  apply: (fn: (d: DiagramDocument) => DiagramDocument, opts?: { coalesce?: string }) => void;
  /** Close and go to a view (`linkedin-edit`). */
  goView: (vid: string, next?: DiagramDocument) => void;
  onClose: () => void;
  toast: (m: string) => void;
}

/**
 * The share dialog (ui contract, Share): where the image goes, then what that place needs — the LinkedIn
 * flow from drawing to download, the theme, and an honest readability line beside the download. It
 * packages what is ready; it does not simplify the drawing. Modal: focus stays inside it.
 */
export function ShareDialog({ doc, view, runner, engine, engineLabel, model, apply, goView, onClose, toast }: Props) {
  // The version is found by its association, never by its name (diagram contract, Post-view identity).
  const current = doc.views.find((v) => v.id === view.id) ?? view;
  const own = current.postOf ? current : doc.views.find((v) => v.postOf === current.id) ?? null;
  const [format, setFormat] = useState<FormatId>(current.postOf || isLinkedInView(view.id) ? "feed" : "readme");
  const postFormat = format === "feed" || format === "linkedin";
  // On LinkedIn the preview is the LinkedIn version when there is one; elsewhere the view itself.
  const pvId = current.postOf ? current.id : postFormat && own ? own.id : view.id;
  const stored = doc.views.find((v) => v.id === pvId) ?? view;
  const onVersion = !!stored.postOf;
  // Portrait and wide place the same lanes; the other orientation is only previewed (ui contract).
  const pv = useMemo(() => (onVersion && postFormat ? orient(stored, format === "feed") : stored), [stored, onVersion, postFormat, format]);
  const shown = pv === stored ? doc : { ...doc, views: doc.views.map((v) => (v.id === pv.id ? pv : v)) };
  const [theme, setTheme] = useState<Theme>(doc.theme);
  const [show, setShow] = useState<Show>(() => startFor(format, onVersion));
  const [advanced, setAdvanced] = useState(false);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const [wellSize, setWellSize] = useState({ w: 800, h: 600 });

  // A new choice of place (or the version appearing) starts from that place's toggles.
  const startKey = `${format}:${onVersion}`;
  const lastStart = useRef(startKey);
  useEffect(() => { if (lastStart.current !== startKey) { lastStart.current = startKey; setShow(startFor(format, onVersion)); } }, [startKey, format, onVersion]);

  const opts: ShareOptions = { format, theme, ...show };
  const img = useMemo(() => renderShare(shown, pv.id, opts), [shown, pv.id, format, theme, show]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => reportOf(img, shown, pv.id, opts), [img]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => {
    const n = pv.nodes.find((x) => x.id === id), e = pv.edges.find((x) => x.id === id);
    const label = (nid: string) => pv.nodes.find((x) => x.id === nid)?.label ?? nid;
    return n ? n.label : e ? `${label(e.from)} → ${label(e.to)}` : id === pv.id ? "The post" : id;
  };
  const f = FORMATS[format];
  const name = (ext: string) => `${slugify(doc.title) || "diagram"}-${pv.id}-${format}.${ext}`;

  /* ---------- modal: Escape, focus in, focus trapped, focus back ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { (document.querySelector<HTMLElement>("[data-testid=share-button]") ?? before)?.focus(); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== "Tab" || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
    else if (!e.shiftKey && i === all.length - 1) { e.preventDefault(); all[0].focus(); }
  };
  useEffect(() => {
    const el = well.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWellSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min((wellSize.w - 64) / f.w, (wellSize.h - 72) / f.h);
  const preview = img.svg.replace("<svg ", `<svg data-testid="share-preview" data-view="${pv.id}" data-width="${img.width}" data-height="${img.height}" style="width:${Math.round(f.w * scale)}px;height:${Math.round(f.h * scale)}px" `);

  const act = async (what: "png" | "svg" | "copy") => {
    setBusy(true);
    try {
      const svg = renderShare(shown, pv.id, { ...opts, fonts: await fonts() }).svg;
      if (what === "svg") download(new Blob([svg], { type: "image/svg+xml" }), name("svg"));
      else {
        const png = await toPng(svg, img.width, img.height);
        if (what === "png") download(png, name("png"));
        else {
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            toast("Copied the image");
          } catch {
            toast("Copying images is not allowed here — use Download PNG");
          }
        }
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ---------- the LinkedIn version ---------- */
  const prepare = () => {
    try { apply((d) => makeLinkedInView(d, view.id).doc); setFormat("feed"); }
    catch (e) { toast((e as Error).message); }
  };
  // Re-arrange places the parts again by their lanes for the chosen orientation (an undoable edit).
  const rearrange = (vid: string) => (d: DiagramDocument): DiagramDocument =>
    ({ ...d, views: d.views.map((v) => (v.id !== vid ? v : hasLanes(v) ? place(v, format !== "linkedin") : rearrangeForFeed(v))) });
  const setCaption = (key: "title" | "lede", value: string) =>
    apply((d) => ({ ...d, views: d.views.map((v) => (v.id === pv.id ? { ...v, caption: { ...v.caption, [key]: value } } : v)) }), { coalesce: `caption-${pv.id}-${key}` });
  const { state } = runner;
  const mine = state.req?.origin === "share";
  const running = state.status === "running";
  const postFmt = format === "linkedin" ? "linkedin" : "feed";
  // A post run: the engine designs the story; the server converts, places and saves it.
  const design = () => {
    void runner.start({ instruction: "", engine, model: model || null, scope: { kind: "view" }, view: onVersion ? pv.id : current.id, origin: "share", kind: "post", format: postFmt });
  };
  const rewrite = () => {
    void runner.start({ instruction: REWRITE, engine, model: model || null, scope: { kind: "view" }, view: pv.id, origin: "share", kind: "post", format: postFmt });
  };

  const r = img.readability;

  return (
    <div className="share-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="share" data-testid="share-dialog" role="dialog" aria-modal="true" aria-label="Share image" data-theme={doc.theme} onKeyDown={trap}>
        <div className="preview" ref={well}>
          <div className="frame" dangerouslySetInnerHTML={{ __html: preview }} />
          <span className="size" data-testid="share-size">{f.w} × {f.h}</span>
        </div>
        <div className="side">
          <div className="top">
            <div><h2>Share image</h2><p className="hint">Laid out for where it will be seen.</p></div>
            <button className="x" data-testid="share-close" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
          </div>
          <div className="scroll">
            <section>
              <h3 id="share-where">Where will you share it?</h3>
              <div className="opts" role="group" aria-labelledby="share-where">
                {WHERE.map((w) => (
                  <button key={w.id} className="opt" data-testid={`format-${w.id}`} aria-pressed={format === w.id || (w.id === "feed" && format === "linkedin")} onClick={() => setFormat(w.id)}>
                    {w.label}<span className="px">{FORMATS[w.id].w}×{FORMATS[w.id].h}</span>
                  </button>
                ))}
              </div>
            </section>

            {postFormat && (
              <section className="li-flow" data-testid="linkedin-flow">
                <h3>LinkedIn version</h3>
                {!onVersion ? (
                  engine ? (
                    <>
                      <p className="hint">The engine designs one image for the post from this drawing and the code: the story, the main path and what sits beside it. Code places it and checks it. This drawing stays as it is.</p>
                      <button className="btn primary wide" data-testid="design-post" disabled={running} onClick={design}>
                        <Icon name="spark" size={15} /> Design the post
                      </button>
                      {engineLabel && <p className="hint">With {engineLabel}</p>}
                    </>
                  ) : (
                    <>
                      <p className="hint">A view of its own for a tall post: the parts that explain the system open, the rest small. This drawing stays as it is.</p>
                      <button className="btn primary wide" data-testid="linkedin-prepare" onClick={prepare}>Prepare the simple version</button>
                      <p className="hint" data-testid="post-engine-note">No engine available — prepared without AI</p>
                    </>
                  )
                ) : (
                  <>
                    <label className="field">Title
                      <input data-testid="share-caption-title" value={pv.caption.title} maxLength={LIMITS.captionTitle} disabled={running} onChange={(e) => setCaption("title", e.target.value)} />
                    </label>
                    <label className="field">Description
                      <textarea data-testid="share-caption-lede" value={pv.caption.lede} maxLength={LIMITS.lede} rows={3} disabled={running} onChange={(e) => setCaption("lede", e.target.value)} />
                    </label>
                    <div className="flow-actions">
                      <button className="btn" data-testid="linkedin-edit" onClick={() => { onClose(); goView(pv.id); }}>Edit on the canvas</button>
                      <button className="btn" data-testid="arrange-feed" disabled={running} onClick={() => apply(rearrange(pv.id))}>Re-arrange</button>
                      {engine && <button className="btn" data-testid="design-post" disabled={running} onClick={design}>Design the post</button>}
                      <button className="btn primary wide" data-testid="explain-feed" disabled={running} onClick={rewrite}>
                        <Icon name="spark" size={15} /> Rewrite it in plain words
                      </button>
                    </div>
                    {!engine && <p className="hint" data-testid="post-engine-note">No engine available — prepared without AI</p>}
                  </>
                )}
                {running && mine && (
                  <div className="run" data-testid="share-run" role="status">
                    <span className="spinner" /><span className="line">{state.lines[state.lines.length - 1] ?? "Starting"}</span>
                    <button className="btn small" data-testid="share-run-cancel" onClick={runner.cancel}>Cancel</button>
                  </div>
                )}
                {mine && !running && state.error && (
                  <div className="run err" data-testid="share-run-error" role="alert">
                    <span className="line">{state.error}</span>
                    <button className="btn small" data-testid="share-run-retry" onClick={runner.retry}>Try again</button>
                  </div>
                )}
                {mine && state.status === "saved" && <div className="run" data-testid="share-run-saved">{SAVED}</div>}
              </section>
            )}

            <section>
              <h3>Theme</h3>
              <div className="seg2">
                {(["light", "dark"] as const).map((t) => (
                  <button key={t} className="opt" data-testid={`share-theme-${t}`} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === "light" ? "Light" : "Dark"}</button>
                ))}
              </div>
            </section>

            <section>
              <button className="disclose" data-testid="share-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
                <Icon name={advanced ? "down" : "send"} size={13} /> Advanced options
              </button>
              {advanced && (
                <div className="advanced" data-testid="share-advanced">
                  <button className="opt" data-testid="format-linkedin" aria-pressed={format === "linkedin"} onClick={() => setFormat("linkedin")}>
                    Landscape LinkedIn post<span className="px">{FORMATS.linkedin.w}×{FORMATS.linkedin.h}</span>
                  </button>
                  {SHOW.map((s) => (
                    <label key={s.key} className="toggle">{s.label}
                      <input type="checkbox" data-testid={`show-${s.key}`} checked={show[s.key]} onChange={(e) => setShow({ ...show, [s.key]: e.target.checked })} />
                    </label>
                  ))}
                </div>
              )}
            </section>

            {img.shortened.length > 0 && (
              <section className="clipped" data-testid="share-clipped">
                <h3>Shortened in this image:</h3>
                <ul>{img.shortened.map((c, i) => <li key={`${c.id}-${i}`} data-testid="share-clipped-item">{`${c.label}: ${c.text}`}</li>)}</ul>
              </section>
            )}
          </div>

        </div>
        <div className="actions" data-testid="share-actions">
          {/* One plain sentence for the destination; the numbers behind it on request (SHARE-3). */}
          <div className="meter" data-testid="readability" data-level={r.level}>
            <p className="say"><i data-level={r.level} />{r.text}</p>
            <button className="disclose" data-testid="readability-details-toggle" aria-expanded={details} onClick={() => setDetails(!details)}>
              <Icon name={details ? "down" : "send"} size={12} /> Details
            </button>
            {details && <p className="detail" data-testid="readability-details">{r.detail}</p>}
          </div>
          <LayoutReportLine report={report} nameOf={nameOf} />
          <button className="btn primary dl" data-testid="download-png" disabled={busy} onClick={() => void act("png")}><Icon name="download" size={16} /> Download PNG</button>
          <button className="btn" data-testid="download-svg" disabled={busy} onClick={() => void act("svg")}>Download SVG</button>
          <button className="btn" data-testid="copy-image" disabled={busy} onClick={() => void act("copy")}><Icon name="copy" size={16} /> Copy image</button>
        </div>
      </div>
    </div>
  );
}
