import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Activity, type Job } from "../api";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { useNow } from "./Draw";
import { jobQuiet, jobState, jobStatus, jobTime, openUrl, orderJobs } from "./jobs";
import type { Ready } from "./Start";
import { setServerNow } from "./time";

/**
 * Activity (ui contract, *Activity*): the jobs `GET /api/activity` lists, asked when the page loads, every 2 s
 * while a listed job runs, every 15 s otherwise, and at once after the page starts, joins or cancels a job (`bump`).
 * An answer from another server process than the last one (`instance`) means the server restarted: the jobs it
 * listed running stopped, and the page says so once (JOB-9).
 */
export function useActivity() {
  const [data, setData] = useState<Activity | null>(null);
  const [restarted, setRestarted] = useState<number | null>(null);
  const last = useRef<Activity | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const ask = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const running = (a: Activity | null) => !!a?.jobs.some((j) => j.status === "running");
    api.activity().then(
      (a) => {
        if (!alive.current) return;
        const before = last.current;
        if (before && before.instance !== a.instance) {
          const stopped = before.jobs.filter((j) => j.status === "running").length;
          if (stopped > 0) setRestarted(stopped);
        }
        last.current = a;
        setServerNow(a.now); setData(a);
        timer.current = setTimeout(ask, running(a) ? 2_000 : 15_000);
      },
      // While jobs ran, a server that went away is asked again soon: it may be restarting.
      () => { if (alive.current) timer.current = setTimeout(ask, running(last.current) ? 2_000 : 15_000); },
    );
  }, []);
  useEffect(() => {
    alive.current = true; ask();
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [ask]);
  return { data, restarted, bump: ask };
}

/** A job waiting for a free slot. */
const waits = (j: Job) => j.waiting === true;
/** The jobs running and not waiting for a slot (`activity-count`, `activity-toggle`). */
export const runningCount = (a: Activity | null) => (a ? a.jobs.filter((j) => j.status === "running" && !waits(j)).length : 0);
const nameOf = (j: Job) => j.name ?? j.link ?? (j.folder ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";

function JobRow({ j, current, now, onFollow }: { j: Job; current: boolean; now: number; onFollow: (j: Job) => void }) {
  const state = jobState(j);
  const quiet = jobQuiet(j, now);
  const open = j.status !== "succeeded" ? null : j.type === "draw"
    ? (j.diagramId ? <button type="button" className="btn primary small" data-testid="activity-open" onClick={() => navigate(openUrl(j.diagramId!, j.choice, j.channel))}>Open</button> : null)
    : <button type="button" className="btn primary small" data-testid="activity-open" onClick={() => onFollow(j)}>Choose</button>;
  return (
    <div className="hm-job" data-testid="activity-job" data-job={j.id} data-type={j.type} data-state={state} data-quiet={quiet || undefined} aria-current={current ? "true" : undefined}>
      <button type="button" className="main" onClick={() => onFollow(j)}>
        <i className="dot" aria-hidden="true" />
        <span className="t">
          <b data-testid="activity-job-name">{nameOf(j)}</b>
          <span data-testid="activity-job-status">{jobStatus(j, now)}</span>
        </span>
      </button>
      {j.status === "running" ? <span className="time" data-testid="activity-job-time">{jobTime(j, now)}</span> : open}
    </div>
  );
}

export function ActivityPanel({ data, restarted, followed, onFollow }: {
  data: Activity | null; restarted: number | null; followed: string | null; onFollow: (j: Job) => void;
}) {
  const n = runningCount(data);
  const { running, done } = orderJobs(data?.jobs ?? []);
  const now = useNow(running.length > 0);
  const row = (j: Job) => <JobRow key={j.id} j={j} current={j.id === followed} now={now} onFollow={onFollow} />;
  return (
    <section className="hm-panel hm-act" data-testid="activity" aria-label="Activity">
      <header>Activity{n > 0 && <span className="hm-run-n" data-testid="activity-count"><span className="hm-pulse" aria-hidden="true" />{n} running</span>}</header>
      <div className="pad">
        {restarted !== null && (
          <p className="hm-restarted" data-testid="jobs-restarted" role="status">The server restarted; {restarted} {restarted === 1 ? "job" : "jobs"} stopped</p>
        )}
        {running.map(row)}
        {!running.length && <p className="none" data-testid="activity-none">Nothing is running.</p>}
        {done.length > 0 && <><h4 className="hm-done">Done</h4>{done.map(row)}</>}
        {data && <p className="keep" data-testid="activity-keep">Keeps going if you reload. Up to {data.slots.total} at once.</p>}
      </div>
    </section>
  );
}

/** `activity-toggle`, in the top bar at 1240 px wide or less: `<n> running`, scrolling Activity into view. */
export function ActivityToggle({ data }: { data: Activity | null }) {
  const n = runningCount(data);
  if (n === 0) return null;
  return (
    <button type="button" className="hm-run-chip" data-testid="activity-toggle"
      onClick={() => document.querySelector('[data-testid="activity"]')?.scrollIntoView({ block: "start", behavior: "smooth" })}>
      <span className="hm-pulse" aria-hidden="true" />{n} running
    </button>
  );
}

/** `job-notice`: a draw the page saw running is ready; it leaves after 8 s. */
export function JobNotice({ ready, onClose }: { ready: Ready; onClose: () => void }) {
  useEffect(() => { const id = setTimeout(onClose, 8_000); return () => clearTimeout(id); }, [ready.runId]);
  return (
    <div className="hm-notice" data-testid="job-notice" role="status">
      <i className="dot" aria-hidden="true" />
      <span><b>{ready.name}</b> is ready</span>
      <button type="button" className="btn primary small" data-testid="job-notice-open" onClick={() => navigate(ready.url)}>Open</button>
      <button type="button" className="btn icon-btn small" data-testid="job-notice-dismiss" aria-label="Dismiss" onClick={onClose}><Icon name="close" size={14} /></button>
    </div>
  );
}
