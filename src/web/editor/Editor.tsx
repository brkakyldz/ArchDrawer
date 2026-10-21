import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyDrawing, joinDrawing } from "../../core/drawing";
import { clearOutdated } from "../../core/channels";
import { prepareLinkedIn } from "../../core/export/feed";
import { channelOfView, isChannel, type ChannelId, type Document3 } from "../../core/file3";
import { layoutRects, routeEdges, viewBounds } from "../../core/geometry";
import { LIMITS, TEXT_SIZE, viewById, type DiagramDocument, type DiagramView, type Form, type Kind } from "../../core/model";
import { PALETTES } from "../../core/theme";
import { summarize, touched, type Changes } from "../../core/diff";
import { api, ApiError, type EngineInfo } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { Logo } from "../ui/Logo";
import { AiPanel, type ScopeChoice } from "./AiPanel";
import { AskBox } from "./AskBox";
import { Search, type Found, type Hit } from "./Find";
import { ViewsMenu } from "./Views";
import { ChannelTabs, EmptyStage, OutdatedBanner } from "./Channels";
import { drawFromFacts, LinkedInPanel, LinkedInStart } from "./LinkedIn";
import { LoadError } from "./LoadError";
import { Callout } from "./Callout";
import { Canvas } from "./Canvas";
import { addNode, addText, crumbsTo, deleteEdges, deleteNodes, deleteTexts, setNode, setText, viewOf } from "./ops";
import { EdgeCallout, InlineInput, Picker, TextEditor, TextToolbar, Warnings } from "./Panels";
import { ShareDialog } from "../share/ShareDialog";
import type { Ctl, Editing, Selection, Tool } from "./types";
import { NOTHING } from "./types";
import { chooseEngine, ENGINE_KEY, engineName, modelKey, rememberedModel, useRunner, type RunRequest } from "./runner";
import { useAutosave } from "./useAutosave";
import { useDocHistory, type ApplyOptions } from "./useDocHistory";
import { FIT, fitView, reveal, zoomAt, zoomPercent, type Viewport } from "./viewport";

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "select", icon: "select", label: "Select", key: "V" },
  { id: "pan", icon: "pan", label: "Pan", key: "H" },
  { id: "component", icon: "component", label: "Component", key: "C" },
  { id: "connect", icon: "connect", label: "Connect", key: "E" },
  { id: "text", icon: "text", label: "Text", key: "T" },
];
/** What to do next with each tool but select (ui contract tool-hint). */
const HINTS: Partial<Record<Tool, string>> = {
  component: "Click an empty spot to add a component",
  connect: "Drag from one component to another to connect them",
  text: "Click anywhere to type text",
  pan: "Drag to move around",
};
declare const __ARCHDRAW_BUILD__: string;
/** The callout is pinned to the side for every component until unpinned (ui contract, callout-pin). */
const PIN_KEY = "archdraw-callout-pinned";
const PAUSED = "Edits are paused while the instruction runs";

/** Below 900 px the header keeps only the tools; the rest moves into `header-menu` (ui contract). */
function useNarrow() {
  const q = "(max-width: 899.98px)";
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * An edit of the drawn view list, split back into the stored document's facts and channels
 * (diagram contract, Edits: facts or channel). A refused edit leaves the document as it was.
 */
function splitEdit(d: Document3, fn: (d: DiagramDocument) => DiagramDocument, toast: (m: string) => void): Document3 {
  const before = joinDrawing(d);
  const next = fn(before);
  if (next === before) return d;
  const r = applyDrawing(d, next);
  if (!r.ok) { toast(r.error); return d; }
  return r.doc;
}

/**
 * Where an address opens (ui contract, Routes): a named channel at the named view or its first; an
 * older `?view=` at the channel holding that view; anything unknown at the overview.
 */
function startOf(stored: Document3, channel: string | null, view: string | null): { channel: ChannelId; view: string | null } {
  if (isChannel(channel)) {
    const views = stored.channels[channel].views;
    if (!views.length) return { channel, view: null };
    return { channel, view: view && views.some((v) => v.id === view) ? view : views[0].id };
  }
  const holding = view ? channelOfView(stored, view) : null;
  if (view && holding) return { channel: holding, view };
  return { channel: "overview", view: stored.channels.overview.views[0].id };
}

/** `/d/<id>`: the editor (ui contract). */
export function Editor({ id, channel: wantedChannel, view: wantedView }: { id: string; channel: string | null; view: string | null }) {
  // The history holds the stored @3 document; the editor draws and edits the overview and the post as
  // one view list (`joinDrawing`), and every edit is split back into facts and channels.
  const hist = useDocHistory<Document3>();
  const stored = hist.doc;
  const doc = useMemo(() => (stored ? joinDrawing(stored) : null), [stored]);
  const save = useAutosave(stored);
  const [missing, setMissing] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRound, setLoadRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [vid, setVid] = useState<string | null>(null);
  /** The current channel; a channel with no drawing shows its own stage instead of the canvas. */
  const [chan, setChan] = useState<ChannelId>("overview");
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [stage, setStage] = useState({ w: 1200, h: 800 });
  const [sel, setSel] = useState<Selection>(NOTHING);
  const [callout, setCallout] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [editing, setEditing] = useState<Editing>(null);
  const textSize = useRef<number>(TEXT_SIZE.default);
  const [picker, setPicker] = useState<Ctl["picker"]>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const stageEl = useRef<HTMLElement>(null);
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => { try { return localStorage.getItem(ENGINE_KEY); } catch { return null; } });
  const [models, setModels] = useState<Record<string, string>>({});
  const [ai, setAi] = useState<{ text: string; scope: ScopeChoice; at: number } | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searchRound, setSearchRound] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  /** Opens search, or focuses its input again when it is already open. */
  const openSearch = () => { setSearching(true); setSearchRound((n) => n + 1); };
  const [pinned, setPinnedState] = useState(() => { try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; } });
  const setPinned = (on: boolean) => { try { if (on) localStorage.setItem(PIN_KEY, "1"); else localStorage.removeItem(PIN_KEY); } catch { /* private mode */ } setPinnedState(on); };
  const narrow = useNarrow();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuEl = useRef<HTMLDivElement>(null);
  const changedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  /** A fit asked for by a run or a view change; applied before the frame showing that change is painted. */
  const pendingFit = useRef<{ view: string; focus?: string } | null>(null);
  const [, fitRound] = useState(0);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  /* ---------- load, outside changes ---------- */
  const adopt = useCallback((d: Document3, message: string | null, fresh = false) => {
    save.markSaved(d);
    if (fresh) hist.reset(d); else hist.apply(d);
    if (message) toast(message);
  }, [hist, save, toast]);

  /** Resolves true once every edit is in the file (before an instruction runs on it). */
  const settle = useCallback(async () => {
    for (let i = 0; i < 60; i++) {
      if (save.clean()) return true;
      if (save.status === "error" || save.status === "conflict") return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return save.clean();
  }, [save]);

  /* ---------- the engine, the model and the instruction run ---------- */
  useEffect(() => { api.engines().then(setEngines, () => setEngines([])); }, []);
  const engine = engines && doc ? chooseEngine(engines, doc, chosen) : null;
  const model = engine ? models[engine.id] ?? rememberedModel(engine) : "";
  const pickEngine = (id: string) => { try { localStorage.setItem(ENGINE_KEY, id); } catch { /* private mode */ } setChosen(id); };
  const pickModel = (m: string) => {
    if (!engine) return;
    try { localStorage.setItem(modelKey(engine.id), m); } catch { /* private mode */ }
    setModels((x) => ({ ...x, [engine.id]: m }));
  };
  const mark = useCallback((c: Changes | null) => {
    if (changedTimer.current) clearTimeout(changedTimer.current);
    setChanged(new Set(c ? touched(c) : []));
    changedTimer.current = setTimeout(() => setChanged(new Set()), 3000);
  }, []);
  const runner = useRunner({
    doc, vid: vid ?? doc?.views[0].id ?? null, settle,
    onUpdated: (d: Document3, c: Changes | null, req: RunRequest) => {
      // One undo step: the stored result and the edit made after it (a re-arrangement) together.
      save.markSaved(d);
      hist.apply(req.after ? splitEdit(d, req.after, toast) : d);
      toast(c ? `The drawing was updated: ${summarize(c)}` : "The drawing was updated");
      mark(c);
      if (req.after && req.view === vid) pendingFit.current = { view: req.view! };
    },
    onSaved: () => { if (doc) api.get(doc.id).then((d) => adopt(d, null), () => {}); },
  });
  // A run's own write is announced before the run ends; the run hands its result over itself.
  const running = useRef(false);
  running.current = runner.state.status === "running";

  // Never a blank page (ui contract, Routes): an older server, or a drawing that cannot be read, says so.
  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const h = await api.health().catch(() => null);
      if (h && h.build && h.build !== __ARCHDRAW_BUILD__) {
        throw new Error("The editor server is older than this page. Stop it with `archdrawer stop`, then open the drawing again with `archdrawer open <file>`.");
      }
      return api.get(id);
    })().then(
      (d) => { if (!live) return; setLoading(false); setLoadError(null); adopt(d, null, true); document.title = `${d.title} · archdrawer`; },
      (e: unknown) => {
        if (!live) return;
        setLoading(false);
        if (e instanceof ApiError && e.status === 404) setMissing("This drawing is not in the library.");
        else setLoadError((e as Error).message || "The drawing could not be loaded");
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadRound]);

  // One stream per drawing: `adopt` changes on every render, so it is read through a ref.
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;
  const clean = save.clean;
  useEffect(() => {
    const es = new EventSource(`/api/diagrams/${encodeURIComponent(id)}/events`);
    es.addEventListener("changed", (ev) => {
      const { updatedAt } = JSON.parse((ev as MessageEvent).data) as { updatedAt: string };
      if (running.current || !clean() || docRef.current?.updatedAt === updatedAt) return;
      api.get(id).then((d) => { if (!running.current && clean() && d.updatedAt !== docRef.current?.updatedAt) adoptRef.current(d, "Updated from the file"); }, () => {});
    });
    return () => es.close();
  }, [id, clean]);

  /* ---------- views and viewport ---------- */
  const view = doc ? viewById(doc, vid ?? "") ?? doc.views[0] : null;
  const fitOf = useCallback((v: DiagramView) => {
    const rects = layoutRects(v);
    const routes = routeEdges(v, rects);
    const b = viewBounds(v, rects, routes, true, doc?.showSteps);
    const s = stageEl.current?.getBoundingClientRect();
    return fitView(b.w > 0 ? b : { x: 0, y: 0, w: 400, h: 300 }, s?.width ?? stage.w, s?.height ?? stage.h);
  }, [stage, doc?.showSteps]);
  const fitTo = useCallback((v = view) => { if (v) setVp(fitOf(v)); }, [view, fitOf]);
  /** The viewport that shows component `id` of view `v`: `from` itself unless the part is off screen or under the search panel. */
  const revealIn = (v: DiagramView, id: string, from: Viewport) => {
    const r = layoutRects(v).get(id);
    const st = stageEl.current?.getBoundingClientRect();
    if (!r || !st) return from;
    const panel = stageEl.current?.querySelector("[data-testid=search]")?.getBoundingClientRect();
    const cover = panel ? { x: panel.left - st.left, y: panel.top - st.top, w: panel.width, h: panel.height } : undefined;
    return reveal(from, r, st.width, st.height, { top: FIT.top, side: FIT.side, bottom: FIT.bottom }, cover);
  };

  // Fitted before the first paint: the toolbar never shows a provisional 100 % (and `full`) the fit then
  // takes back a frame later.
  useLayoutEffect(() => {
    if (!doc || !stored || vid) return;
    const s = startOf(stored, wantedChannel, wantedView);
    const start = s.view && viewById(doc, s.view) ? s.view : doc.views[0].id;
    setChan(s.channel);
    setVid(start);
    fitTo(viewOf(doc, start));
  }, [doc, stored, vid, wantedChannel, wantedView, fitTo]);

  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    // A side panel opening or the window narrowing keeps the drawing's centre where it was.
    let last = el.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dx = (r.width - last.width) / 2, dy = (r.height - last.height) / 2;
      last = r;
      setStage({ w: r.width, h: r.height });
      if (dx || dy) setVp((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc !== null]);

  /** Go to a view, fitted; with `focus`, select that component and move the view further only if it is still off screen. */
  const goView = useCallback((v: string, next?: DiagramDocument, focus?: string) => {
    const d = next ?? docRef.current;
    if (!d || !viewById(d, v)) return;
    // In the drawn view list the post is the LinkedIn channel's view; every other view is the overview's.
    const c: ChannelId = viewById(d, v)!.postOf ? "linkedin" : "overview";
    setChan(c); setVid(v); setSel(focus ? { ...NOTHING, nodes: [focus] } : NOTHING); setCallout(null); setEditing(null); setPicker(null);
    const url = c === "overview" && v === d.views.find((x) => !x.postOf)?.id ? `/d/${d.id}` : `/d/${d.id}?channel=${c}&view=${encodeURIComponent(v)}`;
    history.replaceState({}, "", url);
    pendingFit.current = { view: v, focus };
    fitRound((n) => n + 1);
  }, []);

  // In the same frame as the change it follows: a zoom read once a run or a view change shows is never
  // taken back by a fit a frame later. Runs after every commit; it waits until the view is shown.
  useLayoutEffect(() => {
    const p = pendingFit.current;
    if (!p || !doc || vid !== p.view || !viewById(doc, p.view)) return;
    pendingFit.current = null;
    const target = viewOf(doc, p.view);
    const fitted = fitOf(target);
    setVp(p.focus ? revealIn(target, p.focus, fitted) : fitted);
  });

  // The LinkedIn tab shows the post once there is one (prepared, designed, redone) and its own stage when
  // it is gone (undone); elsewhere a view removed by undo or a run falls back to the first.
  useEffect(() => {
    if (!doc || !vid) return;
    const post = doc.views.find((v) => v.postOf);
    if (chan === "linkedin") {
      if (post && vid !== post.id) goView(post.id);
      else if (!post && !viewById(doc, vid)) { setVid(doc.views[0].id); setSel(NOTHING); setCallout(null); setEditing(null); history.replaceState({}, "", `/d/${doc.id}?channel=linkedin`); }
      return;
    }
    if (!viewById(doc, vid)) goView(doc.views[0].id);
  }, [doc, vid, chan, goView]);

  // A run pauses edits (api contract); an edit saved meanwhile would fail the run's version check and its
  // result would be thrown away. The run's own result goes through `hist.apply`.
  const histApply = hist.apply;
  const apply = useCallback((next: DiagramDocument | ((d: DiagramDocument) => DiagramDocument), opts?: ApplyOptions) => {
    if (running.current) { toast(PAUSED); return; }
    histApply((d) => splitEdit(d, typeof next === "function" ? next : () => next, toast), opts);
  }, [histApply, toast]);
  /** A tab: the channel's first view, or its own stage when it has no drawing (not an edit). */
  const goChannel = useCallback((c: ChannelId) => {
    const d = docRef.current;
    if (!d) return;
    const target = c === "overview" ? d.views.find((v) => !v.postOf) : c === "linkedin" ? d.views.find((v) => v.postOf) : undefined;
    setMenuOpen(false);
    if (target) { goView(target.id); return; }
    setChan(c); setSel(NOTHING); setCallout(null); setEditing(null); setPicker(null); setAi(null); setSearching(false);
    history.replaceState({}, "", `/d/${d.id}?channel=${c}`);
  }, [goView]);
  /** "Keep as it is": the channel's marks go, as one undoable edit (diagram contract, outdated). */
  const keep = () => {
    if (running.current) { toast(PAUSED); return; }
    histApply((d) => clearOutdated(d, chan));
  };
  /** The simple LinkedIn version, drawn by code from the overview (ui contract, The LinkedIn flow): one undoable edit. */
  const prepare = () => {
    if (running.current) { toast(PAUSED); return; }
    histApply((d) => { const r = prepareLinkedIn(d); if (!r.ok) { toast(r.error); return d; } return r.doc; });
  };
  const undo = () => { if (running.current) toast(PAUSED); else hist.undo(); };
  const redo = () => { if (running.current) toast(PAUSED); else hist.redo(); };

  const openAi = (text: string, scope: ScopeChoice = "view") => setAi({ text, scope, at: Date.now() });
  // On the overview only, one line when it misses its targets; nothing changes by itself.
  const ctl: Ctl | null = doc && view ? {
    doc, vid: view.id, view, P: PALETTES[doc.theme], vp, setVp, stage, apply, checkpoint: hist.checkpoint,
    sel, setSel, callout, setCallout, tool, setTool, editing, setEditing, textSize, picker, setPicker,
    toast, goView, changed, pinned, setPinned, found,
    changePart: (nid) => { setSel({ ...NOTHING, nodes: [nid] }); openAi("", "selection"); },
  } : null;

  /* ---------- keyboard ---------- */
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const searchingRef = useRef(searching);
  searchingRef.current = searching;
  // The header menu closes on a click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuEl.current?.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ctlRef.current;
      if (!c) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing(e.target) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        e.preventDefault();
        if (e.key === "y" || e.shiftKey) redo(); else undo();
        return;
      }
      if (e.key === "Escape") {
        if (sharing) return;
        if (menuOpenRef.current) { setMenuOpen(false); return; }
        if (c.picker) { c.setPicker(null); return; }
        if (typing(e.target)) return;
        if (searchingRef.current) { setSearching(false); return; }
        c.setSel(NOTHING); c.setCallout(null); c.setTool("select");
        return;
      }
      if (!typing(e.target) && !sharing && (e.key === "/" || (mod && e.key.toLowerCase() === "k"))) { e.preventDefault(); openSearch(); return; }
      if (typing(e.target) || mod || e.altKey || sharing) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) { c.setTool(t.id); c.setPicker(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && (e.target as HTMLElement)?.closest?.("[data-testid=canvas]")) {
        e.preventDefault();
        const s = c.sel;
        if (!s.nodes.length && !s.edges.length && !s.texts.length) return;
        c.apply((d) => deleteTexts(deleteEdges(deleteNodes(d, c.vid, s.nodes), c.vid, s.edges), c.vid, s.texts));
        c.setSel(NOTHING); c.setCallout(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist, sharing]);

  /* ---------- in-place editing on the canvas ---------- */
  const onDouble = (e: React.MouseEvent) => {
    if (!ctl || ctl.tool !== "select") return;
    // The canvas captures the pointer on press, so the double-click arrives retargeted at the
    // canvas; what was under the pointer is what the user double-clicked.
    const t = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const s = stageEl.current!.getBoundingClientRect();
    const boxOf = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height }; };
    const textId = t.closest("[data-text-id]")?.getAttribute("data-text-id");
    const tx = textId ? ctl?.view.texts.find((x) => x.id === textId) : null;
    if (tx) { setEditing({ kind: "text", id: tx.id, at: { x: tx.x, y: tx.y }, size: tx.size }); return; }
    const nodeEl = t.closest("[data-node-id]");
    if (!nodeEl) return;
    const nid = nodeEl.getAttribute("data-node-id")!;
    const node = ctl.view.nodes.find((n) => n.id === nid)!;
    const nb = boxOf(nodeEl.querySelector(".body") ?? nodeEl);
    const item = t.closest("[data-testid=node-item]");
    if (item) { setEditing({ kind: "item", id: nid, index: Number(item.getAttribute("data-index")), at: boxOf(item) }); return; }
    const sub = t.closest("[data-testid=node-sub]");
    if (sub) { setEditing({ kind: "sub", id: nid, at: { ...boxOf(sub), x: nb.x + 6, w: nb.w - 12 } }); return; }
    const label = nodeEl.querySelector("[data-testid=node-label]");
    const lb = label ? boxOf(label) : nb;
    if (t.closest("[data-testid=node-label]") || node.form === "group" && e.clientY - s.top < lb.y + lb.h) {
      setEditing({ kind: "label", id: nid, at: { x: nb.x + 6, y: lb.y - 3, w: nb.w - 12, h: lb.h + 6 } });
    } else if (!node.sub && e.clientY - s.top > lb.y + lb.h) {
      setEditing({ kind: "sub", id: nid, at: { x: nb.x + 6, y: lb.y + lb.h + 2, w: nb.w - 12, h: 22 * ctl.vp.k } });
    } else {
      setEditing({ kind: "label", id: nid, at: { x: nb.x + 6, y: lb.y - 3, w: nb.w - 12, h: lb.h + 6 } });
    }
  };

  const inline = () => {
    if (!ctl || !editing) return null;
    const close = () => setEditing(null);
    const k = ctl.vp.k;
    if (editing.kind === "text") {
      const text = editing.id ? ctl.view.texts.find((x) => x.id === editing.id) : null;
      if (editing.id && !text) return null;
      return <TextEditor key={`text-${editing.id ?? "new"}`} vp={ctl.vp} P={ctl.P} at={editing.at} size={editing.size} value={text?.text ?? ""}
        onCommit={(v) => {
          close();
          // Trailing blank lines go; an emptied text is deleted, an empty new one never added.
          const t = v.replace(/\s+$/, "");
          if (!text) {
            if (!t.trim()) return;
            let created = "";
            ctl.apply((d) => { const r = addText(d, ctl.vid, editing.at, t, editing.size); created = r.id; return r.doc; });
            ctl.setSel({ ...NOTHING, texts: [created] });
          } else if (t !== text.text) {
            ctl.apply((d) => (t.trim() ? setText(d, ctl.vid, text.id, { text: t }) : deleteTexts(d, ctl.vid, [text.id])));
          }
        }} />;
    }
    const node = ctl.view.nodes.find((x) => x.id === editing.id);
    if (!node) return null;
    if (editing.kind === "item") {
      return <InlineInput key={`item-${node.id}-${editing.index}`} testid="node-item-input" value={node.items[editing.index] ?? ""} at={editing.at} fontSize={12.5 * k}
        onCommit={(v) => {
          close();
          const items = [...node.items]; const t = v.trim().slice(0, LIMITS.item);
          if (!t) items.splice(editing.index, 1); else items[editing.index] = t;
          ctl.apply((d) => setNode(d, ctl.vid, node.id, { items }));
        }} onCancel={close} />;
    }
    if (editing.kind === "sub") {
      return <InlineInput key={`sub-${node.id}`} testid="node-sub-input" value={node.sub} at={editing.at} fontSize={12.5 * k}
        onCommit={(v) => { close(); const t = v.trim().slice(0, LIMITS.sub); if (t !== node.sub) ctl.apply((d) => setNode(d, ctl.vid, node.id, { sub: t })); }} onCancel={close} />;
    }
    return <InlineInput key={`label-${node.id}`} testid="node-label-input" value={node.label} at={editing.at} fontSize={14.5 * k}
      onCommit={(v) => { close(); const t = v.trim(); if (t && t !== node.label) ctl.apply((d) => setNode(d, ctl.vid, node.id, { label: t })); }} onCancel={close} />;
  };

  const addFromPicker = (kind: Kind, form: Form) => {
    if (!ctl || !picker) return;
    let created = "";
    ctl.apply((d) => { const r = addNode(d, ctl.vid, kind, form, picker.world); created = r.id; return r.doc; });
    setPicker(null); setTool("select");
    setSel({ ...NOTHING, nodes: [created] });
    requestAnimationFrame(() => {
      const s = stageEl.current!.getBoundingClientRect();
      const nodeEl = document.querySelector(`[data-node-id="${created}"]`);
      const label = nodeEl?.querySelector("[data-testid=node-label]");
      const body = nodeEl?.querySelector(".body");
      if (!label || !body) return;
      const lb = label.getBoundingClientRect(), nb = body.getBoundingClientRect();
      setEditing({ kind: "label", id: created, select: true, at: { x: nb.left - s.left + 6, y: lb.top - s.top - 3, w: nb.width - 12, h: lb.height + 6 } });
    });
  };


  if (missing) {
    return (
      <div className="not-found" data-testid="not-found">
        <div><p>{missing}</p><a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Back to the drawings</a></div>
      </div>
    );
  }
  if (loadError) return <LoadError message={loadError} busy={loading} onRetry={() => { setLoadError(null); setLoading(true); setLoadRound((r) => r + 1); }} />;
  if (!doc || !stored || !view || !ctl) return <div className="app" />;

  // Until the editor edits each channel on its own (#50, #52, #53), README and presentation keep
  // their empty stage even when the file holds a view for them.
  const blank = stored.channels[chan].views.length === 0 || chan === "readme" || chan === "presentation";
  const outdated = blank ? 0 : stored.channels[chan].outdated.length;
  const crumbs = crumbsTo(doc, view.id);
  const sel1 = sel.edges.length === 1 && !sel.nodes.length && !sel.texts.length ? sel.edges[0] : null;
  const text1 = sel.texts.length === 1 && !sel.nodes.length && !sel.edges.length && !editing ? sel.texts[0] : null;

  const repoEl = <span className="repo" data-testid="repo-name" title={doc.source?.path ?? doc.title}>{doc.title}</span>;
  // The steps switch is the current channel's (diagram contract, Shape).
  const stepsOn = stored.channels[chan].showSteps;
  const toggleSteps = () => {
    if (chan === "overview") { apply((d) => ({ ...d, showSteps: !d.showSteps })); return; }
    if (running.current) { toast(PAUSED); return; }
    histApply((d) => ({ ...d, channels: { ...d.channels, [chan]: { ...d.channels[chan], showSteps: !d.channels[chan].showSteps } } }));
  };
  const tabsEl = <ChannelTabs stored={stored} current={chan} onPick={goChannel} />;
  const crumbsEl = chan !== "overview" ? null : (
    <nav className="crumbs" data-testid="crumbs" aria-label="View">
      {crumbs.map((c, i) => {
        const v = viewOf(doc, c);
        return (
          <span key={c} style={{ display: "contents" }}>
            {i > 0 && <span className="sl">/</span>}
            {i < crumbs.length - 1
              ? <button data-testid={`crumb-${c}`} onClick={() => { setMenuOpen(false); goView(c); }}>{v.title}</button>
              : <b>{v.title}</b>}
          </span>
        );
      })}
    </nav>
  );
  const undoEl = <button className="tb hist" data-testid="tool-undo" aria-label="Undo" disabled={!hist.canUndo || runner.state.status === "running"} onClick={undo}><Icon name="undo" /><span className="tip">Undo<kbd>Ctrl Z</kbd></span></button>;
  const redoEl = <button className="tb hist" data-testid="tool-redo" aria-label="Redo" disabled={!hist.canRedo || runner.state.status === "running"} onClick={redo}><Icon name="redo" /><span className="tip">Redo<kbd>Ctrl ⇧ Z</kbd></span></button>;
  const themeEl = (
    <button className="btn icon-btn" data-testid="tool-theme" aria-label="Switch theme" aria-pressed={doc.theme === "dark"}
      onClick={() => { const theme = doc.theme === "dark" ? "light" : "dark"; localStorage.setItem("archdraw-theme", theme); apply((d) => ({ ...d, theme })); }}>
      <Icon name={doc.theme === "dark" ? "sun" : "moon"} />
    </button>
  );
  const stepsEl = (
    <button className="btn" data-testid="tool-steps" aria-label="Numbered steps" aria-pressed={stepsOn} disabled={blank} onClick={toggleSteps}>
      <Icon name="steps" size={16} /><span className="lbl">Steps</span>
    </button>
  );
  const docked = pinned && callout ? <Callout key={`d-${callout}`} ctl={ctl} id={callout} docked /> : null;
  const post = chan === "linkedin" && !blank && view.postOf ? view : null;
  const engineProps = { runner, engine: engine?.id ?? null, engineLabel: engine ? engineName(engine) : null, model };
  const side = !!docked || !!(ai && engines) || !!post;
  // Stepping selects the match and moves the view only when the match is off screen (ui contract, search).
  const step = (id: string) => { setSel({ ...NOTHING, nodes: [id] }); setCallout(null); setEditing(null); setVp((v) => revealIn(view, id, v)); };
  const openHit = (h: Hit) => goView(h.view, undefined, h.id);

  return (
    <div className={`app${side ? " with-side" : ""}`} data-testid="editor" data-theme={doc.theme} data-channel={chan} data-view={view.id}>
      <header className="bar">
        <div className="where">
          <button className="brand-link" title="All drawings" aria-label="archdrawer: all drawings" onClick={() => navigate("/")}><Logo wordmark={!narrow} /></button>
          <span className="bar-sep" aria-hidden="true" />
          {narrow ? (
            <div className="hmenu" ref={menuEl}>
              <button className="btn icon-btn" data-testid="header-menu-button" aria-label="Drawing, view and history" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                <Icon name="menu" size={16} />
              </button>
              {menuOpen && (
                <div className="menu header-menu" data-testid="header-menu">
                  {repoEl}
                  {tabsEl}
                  {crumbsEl}
                  <div className="row">{undoEl}{redoEl}{themeEl}{stepsEl}</div>
                </div>
              )}
            </div>
          ) : (
            repoEl
          )}
          {narrow && chan === "overview" && <ViewsMenu doc={doc} current={view.id} goView={(v) => goView(v)} />}
          <span className="save" data-testid="save-status" data-state={save.status} role="status">
            <i />{save.status === "saved" ? "Saved" : save.status === "saving" ? "Saving…" : save.error}
            {save.status === "error" && <button className="btn" data-testid="save-retry" onClick={save.retry}>Retry</button>}
            {save.status === "conflict" && <button className="btn" data-testid="save-reload" onClick={() => api.get(doc.id).then((d) => adopt(d, "Loaded the stored version"), (e: Error) => toast(e.message))}>Load the file's version</button>}
          </span>
        </div>
        <div className="tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t, i) => (
            <span key={t.id} style={{ display: "contents" }}>
              {i === 2 && <span className="sep" />}
              <button className="tb" data-testid={`tool-${t.id}`} aria-label={t.label} aria-pressed={tool === t.id} disabled={blank} onClick={() => { setTool(t.id); setPicker(null); }}>
                <Icon name={t.icon} /><span className="tip">{t.label}<kbd>{t.key}</kbd></span>
              </button>
            </span>
          ))}
          {!narrow && <><span className="sep" />{undoEl}{redoEl}</>}
        </div>
        <div className="right">
          <button className="btn icon-btn" data-testid="search-button" aria-label="Find a component" title="Find a component ( / )" onClick={() => setSearching(true)}>
            <Icon name="search" size={16} />
          </button>
          {!narrow && <>{themeEl}{stepsEl}</>}
          <button className="btn" data-testid="ai-button" aria-pressed={!!ai} aria-label="Change with AI" disabled={blank} onClick={() => (ai ? setAi(null) : openAi(""))}>
            <Icon name="spark" size={16} /><span className="lbl">AI</span>
          </button>
          <button className="btn primary" data-testid="share-button" aria-label="Share" disabled={blank} onClick={() => setSharing(true)}><Icon name="share" size={16} /><span className="lbl">Share</span></button>
        </div>
        {!narrow && (
          <div className="nav-row">
            {tabsEl}{crumbsEl}
            {chan === "overview" && <ViewsMenu doc={doc} current={view.id} goView={(v) => goView(v)} />}
          </div>
        )}
      </header>

      <main className="stage" ref={stageEl}>
        {blank ? <EmptyStage channel={chan}>{chan === "linkedin" && <LinkedInStart {...engineProps} onPrepare={prepare} />}</EmptyStage> : <>
        <Canvas ctl={ctl} steps={stepsOn} onDouble={onDouble} />
        {outdated > 0 && <OutdatedBanner count={outdated} onKeep={keep} busy={runner.state.status === "running"}
          onRedraw={chan === "linkedin" ? () => drawFromFacts(engineProps, prepare) : undefined} />}
        {HINTS[tool] && <div className="tool-hint" data-testid="tool-hint" role="status">{HINTS[tool]}</div>}
        <div className="overlay">
          {callout && !editing && !pinned && <Callout key={callout} ctl={ctl} id={callout} />}
          {searching && <Search doc={doc} view={view.id} focusRound={searchRound} onFound={setFound} onStep={step} onOpen={openHit} onClose={() => setSearching(false)} />}
          {sel1 && <EdgeCallout key={sel1} ctl={ctl} id={sel1} />}
          {text1 && <TextToolbar ctl={ctl} id={text1} />}
          {picker && <Picker ctl={ctl} onAdd={addFromPicker} />}
          {inline()}
          {doc.warnings.length > 0 && <Warnings warnings={doc.warnings} onDismiss={() => apply((d) => ({ ...d, warnings: [] }))} />}
        </div>
        <div className="zoom">
          <button className="tb" data-testid="zoom-out" aria-label="Zoom out" onClick={() => setVp(zoomAt(vp, 1 / 1.2, { x: stage.w / 2, y: stage.h / 2 }))}><Icon name="minus" /></button>
          <span className="pct" data-testid="zoom-level">{zoomPercent(vp.k)}%</span>
          <button className="tb" data-testid="zoom-in" aria-label="Zoom in" onClick={() => setVp(zoomAt(vp, 1.2, { x: stage.w / 2, y: stage.h / 2 }))}><Icon name="plus" /></button>
          <button className="tb" data-testid="zoom-fit" aria-label="Fit to screen" onClick={() => fitTo()}><Icon name="fit" /></button>
        </div>
        </>}
        <AskBox runner={runner} engine={engine} model={model} onExpand={(t) => openAi(t)} disabled={blank} />
      </main>
      {side && (
        <div className="side-col">
          {docked}
          {post && <LinkedInPanel {...engineProps} view={post} apply={apply} />}
          {ai && engines && (
            <AiPanel runner={runner} engines={engines} engine={engine} model={model} onEngine={pickEngine} onModel={pickModel}
              selected={sel.nodes} initial={ai} onClose={() => setAi(null)}
              overview={doc.views[0].id} onOverview={() => { if (view?.id !== doc.views[0].id) goView(doc.views[0].id); }}
              nameOf={(id) => view?.nodes.find((n) => n.id === id)?.label ?? id} />
          )}
        </div>
      )}
      {toastMsg && <div className="toast" data-testid="toast" role="status">{toastMsg}</div>}
      {sharing && (
        <ShareDialog doc={doc} view={view} onClose={() => setSharing(false)} toast={toast} />
      )}
    </div>
  );
}

