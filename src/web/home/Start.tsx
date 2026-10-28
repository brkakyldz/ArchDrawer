import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError, type Activity, type DrawChannel, type DrawChoiceState, type DrawFocus, type FocusOption, type FolderCheck, type Job, type PickAnswer, type RepoCard, type RunRecord, type ScanRecord, type ScanTarget, type Sources } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { DrawProgress } from "./Draw";
import type { EngineState } from "./Engine";
import { CHANNELS, channelOf, mergeChoice, mergeRows, openUrl, rowOf, type Row } from "./jobs";
import { afterPaint, paced } from "./pace";
import { SourceRow } from "./Source";

/**
 * The `Draw a project` panel (ui contract, Home: *Choosing a repository*, *The scan and the repository card*,
 * *Choosing what to draw*, *Following a job*): the folder, its scan, the choices as cards, where it will go and
 * the bar, then the draw. The panel follows one job at a time: the scan or draw it started or joined, or the job
 * last pressed in Activity; the job goes on on the server when the panel leaves it (api contract, Folders, Scans,
 * The draw run, Joining a running draw, Trying again, Activity).
 */

const TYPES: Record<RepoCard["type"], string> = { agent: "AI agent project", backend: "Backend service", fullstack: "Full-stack app", other: "Other project" };
/** Sections take the kind hues in turn (DESIGN.md, Home screen, Choice cards). */
const SECTION_LOOKS = [
  { k: "client", icon: "window" }, { k: "service", icon: "server" }, { k: "llm", icon: "spark" },
  { k: "data", icon: "db" }, { k: "api", icon: "inbox" }, { k: "ops", icon: "timer" },
] as const;
const LANGUAGE_HUES = ["api", "gate", "service", "data", "llm", "ops"] as const;
export const STEPS = ["Folder", "Focus", "Destination", "Draw"] as const;
export type Step = (typeof STEPS)[number];
const SHOWN_FILES = 3;
const UNREACHABLE = "Could not reach the archdrawer server";

/** The server's folder refusal in one plain sentence. */
export function folderSentence(message: string): string {
  if (/^Not found: /.test(message)) return "This folder does not exist.";
  if (/^Not a folder: /.test(message)) return "This is a file, not a folder.";
  if (/must be absolute|Give the absolute path/.test(message)) return "Give the whole path, starting from the drive or from /.";
  return message;
}

type Ticked = { whole: boolean; options: string[]; typed: boolean };
const NONE: Ticked = { whole: false, options: [], typed: false };
export interface Scan { id: string; target: ScanTarget; folder: string; root: string; card: RepoCard; options: FocusOption[]; cached: boolean; commit: string | null; link: string | null }
/** Where the repository comes from (ui contract, `start-source`). */
export type SourceTab = "local" | "link";
/** The latest check of the link field's text: its answer, or the server's refusal. */
type LinkCheck = { text: string; answer: FolderCheck | null; error: string | null };
/**
 * A draw the panel follows: its rows (each choice's record and what its stream said of it), its latest line, and
 * how it ended; `lost` while its server cannot be reached.
 */
export interface Draw {
  runId: string | null; status: RunRecord["status"]; rows: Row[]; line: string; writing: boolean; error: string | null; lost: boolean;
  channel: string | null; name: string | null; link: string | null; diagramId: string | null; choice: string | null;
}
/** A draw that has ended and may be opened, for the notice (ui contract, `job-notice`). */
export interface Ready { runId: string; name: string; url: string }
type End = { status: RunRecord["status"]; error: string | null; diagramId?: string | null; choice?: string | null; channel?: string | null; choices?: DrawChoiceState[] | null };
type Progress = { message: string; stage?: string | null; choice?: string | null; at?: string; source?: string };
type DrawJob = Extract<Job, { type: "draw" }>;

/**
 * Follow a scan's event stream until it is done. When the stream drops, its record is read instead until it has
 * finished; three failed reads in a row mean the server is gone. Each progress line is rendered and painted before
 * the next (`paced`), so a burst never shows only its last line.
 */
function follow(url: string, record: () => Promise<End>, onProgress: (data: Progress) => void, live: Set<() => void>): Promise<End> {
  return new Promise((done) => {
    let over = false, timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(url);
    // The end goes through the same queue as the lines, so every earlier line is painted before it shows.
    const lines = paced((item: Progress | { end: End }) => { if ("end" in item) finish(item.end); else flushSync(() => onProgress(item)); }, afterPaint);
    const stop = () => { over = true; es.close(); lines.stop(); if (timer) clearTimeout(timer); live.delete(stop); };
    live.add(stop);
    const finish = (e: End) => { if (!over) { stop(); done(e); } };
    es.addEventListener("progress", (ev) => lines.push(JSON.parse((ev as MessageEvent).data)));
    let ended = false;
    es.addEventListener("done", (ev) => { ended = true; es.close(); lines.push({ end: JSON.parse((ev as MessageEvent).data) as End }); });
    let misses = 0;
    const poll = () => {
      if (over) return;
      record().then((r) => { misses = 0; if (r.status !== "running") finish(r); else timer = setTimeout(poll, 1000); },
        (e: unknown) => {
          // The server answered: a scan it no longer knows (it restarted) ends the wait now.
          if (e instanceof ApiError && e.status !== 0) return finish({ status: "failed", error: e.status === 404 ? "The server restarted; scan again" : e.message });
          if (++misses >= 3) finish({ status: "failed", error: UNREACHABLE }); else timer = setTimeout(poll, 1000);
        });
    };
    // The stream closing after its end is no drop.
    es.onerror = () => { if (over || ended) return; es.close(); if (!timer) poll(); };
  });
}

/** The same options, in the same order: a scan whose choices can join a draw of another scan (api contract, Joining). */
const sameOptions = (a: FocusOption[] | null | undefined, b: FocusOption[]) =>
  JSON.stringify((a ?? []).map((o) => [o.id, o.kind, o.title, o.sentence, o.files])) === JSON.stringify(b.map((o) => [o.id, o.kind, o.title, o.sentence, o.files]));

export type StartState = ReturnType<typeof useStart>;

export function useStart({ engine: eng, activity, onJob, onDrawn }: {
  engine: EngineState; activity: Activity | null; onJob: () => void; onDrawn: (ready: Ready | null) => void;
}) {
  const { engine, model } = eng;
  const [source, setSource] = useState<SourceTab>("local");
  const [folder, setFolder] = useState("");
  const [link, setLink] = useState("");
  const [linkCheck, setLinkCheck] = useState<LinkCheck | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickGone, setPickGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ drawing: string; target: ScanTarget } | null>(null);
  const [scanning, setScanning] = useState<{ id: string | null; line: string; link: string | null } | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [ticked, setTicked] = useState<Ticked>(NONE);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<DrawChannel | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [focusAsk, setFocusAsk] = useState<{ el: "folder" | "scan"; n: number } | null>(null);
  // A draw a 409 named as running for this folder, and whether a refused join waits for the ticks to change.
  const [joinRun, setJoinRun] = useState<string | null>(null);
  const [joinRefused, setJoinRefused] = useState(false);
  // Open streams, closed when the panel stops following or the screen goes; a job that ends after that changes nothing.
  const live = useRef(new Set<() => void>());
  const epoch = useRef(0);
  const mounted = useRef(true);
  // Every job id Activity has listed: a followed job that was listed and is no longer is gone.
  const listed = useRef(new Set<string>());
  // Set again on mount: StrictMode mounts twice in development, and a ref left false would drop every finished scan.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const stop of [...live.current]) stop(); }; }, []);

  const following = scanning !== null || scan !== null || draw !== null;
  const followed = draw?.runId ?? scan?.id ?? scanning?.id ?? null;
  const busy = scanning !== null || draw?.status === "running";
  const sections = scan?.options.filter((o) => o.kind === "section") ?? [];
  const flows = scan?.options.filter((o) => o.kind === "flow") ?? [];
  const linkOk = !!linkCheck?.answer && linkCheck.text === link;
  // The field shows the followed job's folder, a copy by its link.
  const followedLink = draw?.link ?? scan?.link ?? scanning?.link ?? null;
  const fieldText = following && followedLink ? followedLink : folder;
  const current = () => epoch.current;
  const still = (at: number) => mounted.current && epoch.current === at;

  /**
   * Joining (ui contract, *Joining a running draw*): a draw Activity lists as running and not writing, of the
   * followed scan's folder, started from that scan or from a listed scan at the same commit with the same options.
   */
  const jobs = activity?.jobs ?? [];
  const joinable = !scan ? null : (jobs.find((j): j is DrawJob => j.type === "draw" && j.status === "running" && !j.writing && (j.id === joinRun || (
    j.folder === scan.folder && j.root === scan.root && (j.scan === scan.id || jobs.some((x) => x.type === "scan" && x.id === j.scan && x.commit !== null && x.commit === scan.commit && sameOptions(x.options, scan.options)))
  ))) ?? null);
  const held = joinable?.choices ?? [];
  const holds = {
    whole: held.some((c) => c.kind === "system"),
    option: (o: FocusOption) => held.some((c) => c.kind === o.kind && c.title === o.title),
    typed: held.some((c) => c.kind === "custom"),
  };
  // The new choices: ticked and not already in the draw that is joined.
  const isNew = { whole: ticked.whole && !holds.whole, options: [...sections, ...flows].filter((o) => ticked.options.includes(o.id) && !holds.option(o)), typed: ticked.typed && !holds.typed };
  const count = (isNew.whole ? 1 : 0) + isNew.options.length + (isNew.typed ? 1 : 0);
  const step: Step = draw ? "Draw" : scan ? (count > 0 ? "Destination" : "Focus") : "Folder";
  useEffect(() => setJoinRefused(false), [ticked, text]);

  /** The panel follows nothing any more: fields enabled, on the Folder step; the job goes on on the server. */
  const leave = (emptied: boolean) => {
    epoch.current++;
    for (const stop of [...live.current]) stop();
    setScanning(null); setScan(null); setDraw(null); setTicked(NONE); setChannel(null); setText("");
    setError(null); setExisting(null); setJoinRun(null); setJoinRefused(false);
    if (emptied) { setFolder(""); setLink(""); }
  };
  const askFocus = (el: "folder" | "scan") => setFocusAsk((f) => ({ el, n: (f?.n ?? 0) + 1 }));

  // A followed job that Activity listed and lists no more (it expired, or the server restarted) is left.
  useEffect(() => {
    if (!activity) return;
    const ids = new Set(activity.jobs.map((j) => j.id));
    if (followed && listed.current.has(followed) && !ids.has(followed)) leave(false);
    for (const id of ids) listed.current.add(id);
  }, [activity]);

  // The link is checked 300 ms after its last change; an answer for an older text is dropped.
  useEffect(() => {
    if (!link.trim()) { setLinkCheck(null); return; }
    let gone = false;
    const timer = setTimeout(() => {
      api.checkFolder({ link }).then((answer) => { if (!gone) setLinkCheck({ text: link, answer, error: null }); },
        (e: Error) => { if (!gone) setLinkCheck({ text: link, answer: null, error: e.message }); });
    }, 300);
    return () => { gone = true; clearTimeout(timer); };
  }, [link]);

  /** Follow a scan until it ends: a succeeded one shows its choosing step, a failed or cancelled one ends the following. */
  const followScan = async (id: string, target: ScanTarget, at: number) => {
    const end = await follow(`/api/scans/${id}/events`, () => api.scan(id), (p) => setScanning((s) => (s ? { ...s, line: p.message } : s)), live.current);
    // Its row in Activity ends with it, not at Activity's next answer.
    onJob();
    if (!still(at)) return;
    setScanning(null);
    if (end.status !== "succeeded") { setError(end.status === "cancelled" ? "Cancelled" : end.error ?? "The scan failed"); return; }
    let r: ScanRecord;
    try { r = await api.scan(id); } catch (e) { if (still(at)) setError((e as Error).message); return; }
    if (!still(at)) return;
    setScan(scanOf(r, target));
  };
  const scanOf = (r: ScanRecord, target: ScanTarget): Scan =>
    ({ id: r.id, target, folder: r.folder, root: r.root, card: r.card!, options: r.options ?? [], cached: r.cached, commit: r.commit, link: r.link ?? null });

  const runScan = async (target: ScanTarget, refresh: boolean) => {
    if (!engine) return;
    leave(false);
    const at = current();
    setScanning({ id: null, line: "Starting", link: "link" in target ? target.link : null });
    let id: string;
    try { id = await api.startScan(target, { engine: engine.id, model: model || null, refresh }); }
    catch (e) {
      // A scan of this folder already running: the panel follows that one.
      const running = e instanceof ApiError && e.status === 409 && typeof e.body?.scanId === "string" ? (e.body.scanId as string) : null;
      if (!running) { if (still(at)) { setScanning(null); setError(folderSentence((e as Error).message)); } return; }
      id = running;
    }
    onJob();
    if (!still(at)) return;
    setScanning((s) => (s ? { ...s, id } : s));
    await followScan(id, target, at);
  };

  /**
   * Follow a draw: its record gives the rows as they are, its stream moves them on (choice events) and says the
   * latest line of each (progress events). A dropped stream is read again from the record and opened again, its
   * past events replayed over the rows without taking any back; a draw the server no longer knows (404) is left,
   * and while the server cannot be reached the panel says so and keeps asking.
   */
  const followDraw = (runId: string, at: number, seed: Partial<Draw>, fromStart = false) => {
    setDraw({ runId, status: "running", rows: [], line: "Starting", writing: false, error: null, lost: false, channel: null, name: null, link: null, diagramId: null, choice: null, ...seed });
    let over = false, ended = false, misses = 0, timer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null, lines: { stop: () => void } | null = null;
    // Whether the page saw this draw running (a notice is for those only), and its name for the notice.
    let seen = false, name = seed.name ?? null;
    const stop = () => { over = true; es?.close(); lines?.stop(); if (timer) clearTimeout(timer); live.current.delete(stop); };
    live.current.add(stop);
    const update = (f: (d: Draw) => Draw) => { if (still(at)) setDraw((d) => (d && d.runId === runId ? f(d) : d)); };
    const finish = (end: End) => {
      stop();
      if (!still(at)) return;
      update((d) => ({
        ...d, status: end.status, rows: end.choices ? mergeRows(d.rows, end.choices) : d.rows, writing: false, lost: false,
        error: end.status === "cancelled" ? "Cancelled" : end.status === "failed" ? end.error ?? "The drawing failed" : null,
        diagramId: end.diagramId ?? null, choice: end.choice ?? null, channel: end.channel ?? d.channel,
      }));
      onJob();
      if (end.status === "succeeded" && end.diagramId) onDrawn(seen ? { runId, name: name ?? "The drawing", url: openUrl(end.diagramId, end.choice, end.channel) } : null);
    };
    const record = (r: RunRecord) => { seen ||= r.status === "running"; name = r.name ?? name; update((d) => ({
      ...d, rows: mergeRows(d.rows, r.choices ?? []), channel: r.channel ?? d.channel, name: r.name ?? d.name, link: r.link ?? d.link,
      writing: !!r.writing, line: r.message ?? d.line, lost: false, error: null,
    })); };
    const show = (item: { progress: Progress } | { choice: DrawChoiceState } | { end: End }) => {
      if ("end" in item) return finish(item.end);
      seen = true;
      flushSync(() => update((d) => {
        if ("choice" in item) {
          const c = item.choice, i = d.rows.findIndex((r) => r.id === c.id);
          return { ...d, rows: i < 0 ? [...d.rows, rowOf(c)] : d.rows.map((r, k) => (k === i ? mergeChoice(r, c) : r)) };
        }
        const p = item.progress;
        return {
          ...d, line: p.message, writing: d.writing || (p.message === "Writing the drawing" && !p.choice),
          rows: d.rows.map((r) => (r.id === p.choice ? { ...r, events: r.events + 1, message: p.message, engineAt: p.source === "engine" && p.at ? p.at : r.engineAt } : r)),
        };
      }));
    };
    const open = () => {
      if (over) return;
      // The stream replays every past event: the counts of this one start again.
      update((d) => ({ ...d, rows: d.rows.map((r) => ({ ...r, events: 0 })) }));
      const stream = new EventSource(`/api/runs/${runId}/events`);
      const queue = paced(show, afterPaint);
      es = stream; lines = queue;
      const data = (ev: Event) => JSON.parse((ev as MessageEvent).data);
      stream.addEventListener("progress", (ev) => queue.push({ progress: data(ev) }));
      stream.addEventListener("choice", (ev) => queue.push({ choice: data(ev) }));
      stream.addEventListener("done", (ev) => { ended = true; stream.close(); queue.push({ end: data(ev) }); });
      // The stream closing after its end is no drop.
      stream.onerror = () => { if (over || ended) return; stream.close(); queue.stop(); if (!timer) poll(); };
    };
    const poll = () => {
      timer = null;
      if (over) return;
      api.run(runId).then((r) => {
        if (over) return;
        misses = 0; record(r);
        if (r.status !== "running") finish(r as End); else open();
      }, (e: unknown) => {
        if (over) return;
        if (e instanceof ApiError && e.status === 404) { stop(); if (still(at)) leave(false); return; }
        if (++misses >= 3) update((d) => ({ ...d, lost: true, error: e instanceof ApiError && e.status !== 0 ? e.message : UNREACHABLE }));
        timer = setTimeout(poll, misses >= 3 ? 2000 : 1000);
      });
    };
    // A draw the page has just started is followed from its first event, so every state it goes through shows;
    // one found later starts from its record, as it is now.
    if (fromStart) open(); else poll();
  };

  /**
   * Scan: a folder is checked first, a link was checked as it was typed; one that holds a drawing is offered
   * before anything is scanned.
   */
  const onScan = async () => {
    if (!engine || following) return;
    if (source === "link") {
      const answer = linkOk ? linkCheck!.answer! : null;
      if (!answer) return;
      setError(null); setExisting(null);
      if (answer.drawing) { setExisting({ drawing: answer.drawing, target: { link } }); return; }
      await runScan({ link }, false);
      return;
    }
    setError(null); setExisting(null);
    if (!folder.trim()) { setError("Give the whole path, starting from the drive or from /."); return; }
    const at = current();
    let check;
    try { check = await api.checkFolder({ folder }); } catch (e) { if (still(at)) setError(folderSentence((e as Error).message)); return; }
    if (!still(at)) return;
    if (check.drawing) { setExisting({ drawing: check.drawing, target: { folder: check.folder } }); return; }
    await runScan({ folder: check.folder }, false);
  };

  /** `start-pick`: the system's folder dialog; a picked folder goes into the field and Scan takes the focus. */
  const pick = async () => {
    if (picking || following) return;
    const at = current();
    setPicking(true);
    let r: PickAnswer;
    try { r = await api.pickFolder(); }
    catch (e) {
      if (mounted.current) setPicking(false);
      if (still(at)) setError(e instanceof ApiError && e.status === 400 ? folderSentence(e.message) : (e as Error).message);
      return;
    }
    if (!mounted.current) return;
    setPicking(false);
    if (!still(at)) return;
    if (r.status === "unavailable") { setPickGone(true); return; }
    if (r.status !== "picked") return;
    setError(null); setFolder(r.folder);
    setExisting(r.drawing ? { drawing: r.drawing, target: { folder: r.folder } } : null);
    askFocus("scan");
  };

  const openExisting = async () => {
    if (!existing) return;
    try { const id = await api.openFile(existing.drawing); navigate(`/d/${id}`); } catch (e) { setError((e as Error).message); }
  };

  /** The new choices in the order of `focus-list`: the whole system, the sections, the flows, then the typed text. */
  const drawChoices = (): DrawFocus[] | null => {
    if (isNew.typed && !text.trim()) return null;
    const picked: DrawFocus[] = [
      ...(isNew.whole ? [{ kind: "whole" } as const] : []),
      ...isNew.options.map((o) => ({ kind: "option", option: o.id }) as const),
      ...(isNew.typed ? [{ kind: "typed", text: text.trim() } as const] : []),
    ];
    return picked.length ? picked : null;
  };
  const canDraw = !!scan && !!drawChoices() && !busy && (joinable ? !joinRefused : !!channel && !!engine);

  /** The draw button: a new draw, or the new choices added to the draw that is joined. */
  const onDraw = async () => {
    const choices = drawChoices();
    if (!canDraw || !choices || !scan) return;
    const at = current();
    setError(null);
    const seed = { name: scan.card.name, link: scan.link };
    if (joinable) {
      try { await api.joinDraw(joinable.id, { scan: scan.id, choices }); }
      catch (e) { if (still(at)) { setError((e as Error).message); setJoinRefused(true); } return; }
      onJob();
      if (!still(at)) return;
      setScan(null); setTicked(NONE); setText(""); setChannel(null);
      followDraw(joinable.id, at, { ...seed, channel: joinable.channel });
      return;
    }
    if (!channel || !engine) return;
    let runId: string;
    try { runId = await api.startDraw({ scan: scan.id, choices, channel, engine: engine.id, model: model || null }); }
    catch (e) {
      if (!still(at)) return;
      // A draw of this folder is running: the step joins it, the ticks kept.
      if (e instanceof ApiError && e.status === 409 && typeof e.body?.runId === "string") { setJoinRun(e.body.runId as string); onJob(); return; }
      setError((e as Error).message); return;
    }
    onJob();
    if (!still(at)) return;
    setScan(null); setTicked(NONE); setText(""); setChannel(null);
    followDraw(runId, at, { ...seed, channel }, true);
  };

  /** `draw-retry`: the retry endpoint of the followed draw; the panel follows the new run. */
  const retry = async () => {
    if (!draw?.runId || (draw.status === "running" && !draw.lost)) return;
    const at = current(), wasReady = draw.status === "succeeded", seed = { name: draw.name, link: draw.link, channel: draw.channel };
    setError(null);
    let runId: string;
    try { runId = await api.retryDraw(draw.runId); }
    catch (e) {
      if (!still(at)) return;
      if (wasReady) setError((e as Error).message); else setDraw((d) => (d ? { ...d, error: (e as Error).message } : d));
      return;
    }
    onJob();
    if (!still(at)) return;
    for (const stop of [...live.current]) stop();
    followDraw(runId, at, seed, true);
  };

  /** A job pressed in Activity: the panel follows it from where it is. */
  const followJob = (j: Job) => {
    if (j.id === followed) return;
    leave(false);
    const at = current();
    setSource("local"); setFolder(j.folder);
    if (j.type === "draw") { followDraw(j.id, at, { name: j.name, link: j.link, channel: j.channel }); return; }
    const target: ScanTarget = j.link ? { link: j.link } : { folder: j.folder };
    if (j.status === "succeeded" && j.card) { setScan(scanOf(j, target)); return; }
    if (j.status === "running") { setScanning({ id: j.id, line: j.message ?? "Scanning", link: j.link }); void followScan(j.id, target, at); return; }
    setError(j.status === "cancelled" ? "Cancelled" : j.error ?? "The scan failed");
  };

  return {
    source, folder, setFolder, fieldText, link, setLink, linkCheck, linkOk, picking, pickGone, pick,
    error, setError, existing, scanning, scan, ticked, setTicked, text, setText, channel, setChannel, draw,
    following, followed, busy, sections, flows, count, step, canDraw, focusAsk, engine, noEngine: eng.none,
    joinable, holds, onScan, runScan, openExisting, onDraw, retry, followJob, leave, askFocus,
    /** `start-source-local` / `start-source-link`; off while the panel follows a job. */
    chooseSource: (t: SourceTab) => { if (following || t === source) return; setSource(t); setError(null); setExisting(null); },
    cancelScan: () => { if (scanning?.id) void api.cancelScan(scanning.id).then(onJob, (e: Error) => setError(e.message)); },
    cancelDraw: () => { if (draw?.runId) void api.cancelRun(draw.runId).then(onJob, (e: Error) => setError(e.message)); },
    /** `start-change-folder`: back to the Folder step, the folder kept, the ticks and the channel cleared. */
    changeFolder: () => leave(false),
    /** `Ctrl K`: This computer and the folder field focused, after freeing the panel (as `draw-another`) when it follows a job. */
    fresh: () => { if (following) leave(true); setSource("local"); askFocus("folder"); },
    /** `home-nav-new`: as `draw-another` (the fields emptied), then This computer and the folder field focused. */
    newDrawing: () => { leave(true); setSource("local"); askFocus("folder"); },
  };
}

/** `start-steps`: four steps, the one the panel is on `now`, those before it `done`; narrow windows write only the current name. */
export function Stepper({ step, narrow }: { step: Step; narrow: boolean }) {
  const at = STEPS.indexOf(step);
  return (
    <ol className="hm-stepper" data-testid="start-steps" aria-label="Steps">
      {STEPS.map((name, i) => (
        <li key={name} data-state={i === at ? "now" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="b">{i + 1}</span>{(!narrow || i === at) && <span className="l">{name}</span>}
        </li>
      ))}
    </ol>
  );
}

/** `focus-in-draw`: a choice the joined draw already holds. */
const InDraw = () => <span className="hm-in-draw" data-testid="focus-in-draw">In this draw</span>;

function Option({ o, look, checked, inDraw, onToggle }: { o: FocusOption; look: { k: string; icon: string }; checked: boolean; inDraw: boolean; onToggle: () => void }) {
  const [all, setAll] = useState(false);
  const files = all ? o.files : o.files.slice(0, SHOWN_FILES);
  const more = o.files.length - files.length;
  return (
    <label className="hm-opt" data-testid="focus-option" data-option={o.id} data-kind={o.kind} style={{ "--k": `var(--k-${look.k})` } as React.CSSProperties}>
      <input type="checkbox" checked={checked || inDraw} disabled={inDraw} onChange={onToggle} />
      <span className="ico" aria-hidden="true"><Icon name={look.icon} size={18} /></span>
      <span className="tx">
        <b>{o.title}</b>{inDraw && <InDraw />}
        <span className="sentence">{o.sentence}</span>
        {o.files.length > 0 && (
          <span className="files" data-testid="focus-option-files">
            {files.map((f) => <code key={f}>{f}</code>)}
            {more > 0 && <button type="button" className="more" data-testid="focus-option-files-more" onClick={(e) => { e.preventDefault(); setAll(true); }}>+{more} more</button>}
          </span>
        )}
      </span>
      <span className="tick" aria-hidden="true"><Icon name="check" size={12} stroke={2.6} /></span>
    </label>
  );
}

function Tickable({ testId, kind, title, line, icon, hue, checked, inDraw, onToggle }: { testId: string; kind: string; title: string; line?: string; icon: string; hue: string; checked: boolean; inDraw: boolean; onToggle: () => void }) {
  return (
    <label className="hm-opt wide" data-testid={testId} data-kind={kind} style={{ "--k": hue } as React.CSSProperties}>
      <input type="checkbox" checked={checked || inDraw} disabled={inDraw} onChange={onToggle} />
      <span className="ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="tx"><b>{title}</b>{inDraw && <InDraw />}{line && <span className="sentence">{line}</span>}</span>
      <span className="tick" aria-hidden="true"><Icon name="check" size={12} stroke={2.6} /></span>
    </label>
  );
}

export function StartPanel({ s, sources, scanWaits, timeoutMs, narrow, folderRef, scanRef }: {
  s: StartState; sources: Sources | null; scanWaits: boolean; timeoutMs: number | null; narrow: boolean;
  folderRef: React.RefObject<HTMLInputElement | null>; scanRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const textEl = useRef<HTMLInputElement>(null);
  const { scan, draw, ticked, setTicked, joinable, holds } = s;
  // Ticking Something else puts the cursor in its field.
  useEffect(() => { if (ticked.typed) textEl.current?.focus(); }, [ticked.typed]);
  useEffect(() => {
    if (!s.focusAsk) return;
    (s.focusAsk.el === "folder" ? folderRef : scanRef).current?.focus();
  }, [s.focusAsk]);

  const toggleOption = (id: string) => setTicked((t) => ({ ...t, options: t.options.includes(id) ? t.options.filter((x) => x !== id) : [...t.options, id] }));
  // On the choosing step, Enter on a focused choice or destination presses the draw button when it is enabled.
  const enterDraws = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (e.key !== "Enter" || el.tagName !== "INPUT" || (el.type !== "checkbox" && el.type !== "radio")) return;
    e.preventDefault(); void s.onDraw();
  };
  // A joined draw's channel is the one its new choices take.
  const lockedTo = joinable ? channelOf(joinable.channel) : null;
  const chosen = lockedTo ?? CHANNELS.find((c) => c.id === s.channel);
  const looks = new Map(s.sections.map((o, i) => [o.id, SECTION_LOOKS[i % SECTION_LOOKS.length]]));
  const typedShown = ticked.typed && !holds.typed;

  return (
    <section className="hm-start" data-testid="start" id="start" aria-label="Draw a project">
      <div className="deco" aria-hidden="true" />
      <div className="hm-start-head">
        <h1>Draw a project</h1>
        <Stepper step={s.step} narrow={narrow} />
      </div>
      <div className="hm-start-body">
        <SourceRow s={s} sources={sources} folderRef={folderRef} scanRef={scanRef} />
        {s.error && <p className="hm-error" data-testid="start-error" role="alert">{s.error}</p>}
        {s.existing && (
          <div className="hm-existing" data-testid="start-existing">
            <p>This folder already has a drawing.</p>
            <button type="button" className="btn primary small" data-testid="start-open-existing" onClick={() => void s.openExisting()}>Open it</button>
            <button type="button" className="btn small" data-testid="start-again" onClick={() => void s.runScan(s.existing!.target, false)}>Start again</button>
          </div>
        )}
        {s.scanning && (
          <div className="hm-scan-live" data-testid="scan-progress" role="status">
            <span className="hm-spin" aria-hidden="true" />
            <div className="txt"><b>{scanWaits ? "Waiting for a free engine" : "Scanning"}</b><span>{s.scanning.line}</span><div className="hm-track"><i /></div></div>
            <button type="button" className="btn small" data-testid="scan-cancel" disabled={!s.scanning.id} onClick={s.cancelScan}>Cancel</button>
          </div>
        )}
        {draw && <DrawProgress d={draw} timeoutMs={timeoutMs} onCancel={s.cancelDraw} onAnother={() => s.leave(true)} onRetry={() => void s.retry()} />}
        {scan && !draw && (
          <>
            <div className="hm-focus" data-testid="focus-list" role="group" aria-labelledby="focus-heading" onKeyDown={enterDraws}>
            <div className="hm-q"><h2 id="focus-heading">What should it draw?</h2>{s.count > 0 && <span className="cnt" data-testid="focus-count">{s.count} chosen</span>}</div>
            <div className="hm-opts">
              <Tickable testId="focus-whole" kind="system" title="The whole system" line="A map of the main parts; open each one for its inside" icon="layers" hue="var(--accent)"
                checked={ticked.whole} inDraw={holds.whole} onToggle={() => setTicked((t) => ({ ...t, whole: !t.whole }))} />
              {!scan.options.length && <p className="hm-focus-none" data-testid="focus-none">The scan found no sections or flows. Draw the whole system, or say what to draw.</p>}
              {s.sections.length > 0 && (
                <div className="hm-grp" data-testid="focus-sections" role="group" aria-label="Sections">
                  <h3>Sections</h3>
                  {s.sections.map((o) => <Option key={o.id} o={o} look={looks.get(o.id)!} checked={ticked.options.includes(o.id)} inDraw={holds.option(o)} onToggle={() => toggleOption(o.id)} />)}
                </div>
              )}
              {s.flows.length > 0 && (
                <div className="hm-grp" data-testid="focus-flows" role="group" aria-label="Flows">
                  <h3>Flows</h3>
                  {s.flows.map((o) => <Option key={o.id} o={o} look={{ k: "worker", icon: "flow" }} checked={ticked.options.includes(o.id)} inDraw={holds.option(o)} onToggle={() => toggleOption(o.id)} />)}
                </div>
              )}
              <Tickable testId="focus-typed" kind="custom" title="Something else" icon="pen" hue="var(--muted)"
                checked={ticked.typed} inDraw={holds.typed} onToggle={() => setTicked((t) => ({ ...t, typed: !t.typed }))} />
              {typedShown && (
                <div className="hm-typed">
                  <input ref={textEl} type="text" data-testid="focus-text" aria-label="What should the drawing explain?" placeholder="What should the drawing explain?" maxLength={300}
                    value={s.text} onChange={(e) => s.setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void s.onDraw(); } }} />
                </div>
              )}
            </div>
            </div>
            {(s.count > 0 || !!lockedTo) && (
              <>
                <div className="hm-q"><h2>Where will it go?</h2></div>
                {lockedTo && <p className="hm-locked" data-testid="channel-locked">New choices join the draw that is running, so they take its {lockedTo.name}.</p>}
                <div className="hm-dests" role="radiogroup" aria-label="Where will it go?" onKeyDown={enterDraws}>
                  {CHANNELS.map((c) => (
                    <label key={c.id} className="hm-dest">
                      <input type="radio" name="start-channel" data-testid={`channel-choice-${c.id}`} checked={chosen?.id === c.id} disabled={!!lockedTo} onChange={() => s.setChannel(c.id)} />
                      <span className="frame" aria-hidden="true"><i style={{ width: c.page.w, height: c.page.h }} /></span>
                      <span className="row"><span><b>{c.label}</b><small>{c.size}</small></span><span className="tick" aria-hidden="true" /></span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="hm-go">
              <span className="sum" data-testid="draw-summary">
                {s.count === 0 ? "Pick at least one" : <><b>{s.count} {s.count === 1 ? "drawing" : "drawings"}</b>{chosen ? chosen.summary : ": choose where it will go"}</>}
              </span>
              <button type="button" className="btn hm-ghost" data-testid="start-change-folder" onClick={s.changeFolder}>Change folder</button>
              <button type="button" className="btn primary lg" data-testid="draw-start" disabled={!s.canDraw} onClick={() => void s.onDraw()}>
                {joinable ? (s.count > 1 ? `Add all ${s.count} to the draw` : "Add it to the draw") : s.count > 1 ? `Draw all ${s.count}` : "Draw it"} <Icon name="send" size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** `scan-card`: the repository the followed scan read, in the side column in place of `home-continue`. */
export function ScanCard({ s }: { s: StartState }) {
  const scan = s.scan!;
  const { card } = scan;
  return (
    <section className="hm-panel hm-proj" data-testid="scan-card" aria-label="Project">
      <header>Project <button type="button" className="btn small hm-ghost" data-testid="scan-again" disabled={s.busy} onClick={() => void s.runScan(scan.target, true)}>Scan again</button></header>
      <div className="pad">
        <b className="name" data-testid="scan-card-name">{card.name}</b>
        {scan.link && <span className="link" data-testid="scan-card-link">{scan.link}</span>}
        <p data-testid="scan-card-sentence">{card.sentence}</p>
        <div className="hm-tags">
          <span className="hm-tag" data-testid="scan-card-type" data-type={card.type} style={{ "--k": "var(--k-client)" } as React.CSSProperties}><i />{TYPES[card.type]}</span>
          <span className="hm-tags" data-testid="scan-card-languages">
            {card.languages.map((l, i) => <span key={l} className="hm-tag" style={{ "--k": `var(--k-${LANGUAGE_HUES[i % LANGUAGE_HUES.length]})` } as React.CSSProperties}><i />{l}</span>)}
          </span>
        </div>
        <dl className="hm-kv">
          {card.entryPoints.map((p, i) => <div key={p}><dt>{i === 0 ? "Entry" : ""}</dt><dd data-testid="scan-card-entry">{p}</dd></div>)}
          {scan.commit && <div><dt>Commit</dt><dd data-testid="scan-card-commit">{scan.commit.slice(0, 7)}</dd></div>}
        </dl>
        {scan.cached && <p className="cached" data-testid="scan-cached">Scanned before at {(scan.commit ?? "").slice(0, 7)}</p>}
      </div>
    </section>
  );
}
