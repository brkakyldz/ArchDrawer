import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Activity } from "../api";
import { setServerNow } from "./time";

/**
 * Activity (ui contract, *Activity*): the jobs `GET /api/activity` lists, asked when the page loads, every 2 s
 * while a listed job runs, every 15 s otherwise, and at once after the page starts or cancels a job (`bump`).
 * This is the panel's frame and its idle state; the rows of each job come with the Activity rail.
 */
export function useActivity() {
  const [data, setData] = useState<Activity | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const ask = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    api.activity().then(
      (a) => {
        if (!alive.current) return;
        setServerNow(a.now); setData(a);
        timer.current = setTimeout(ask, a.jobs.some((j) => j.status === "running") ? 2_000 : 15_000);
      },
      () => { if (alive.current) timer.current = setTimeout(ask, 15_000); },
    );
  }, []);
  useEffect(() => {
    alive.current = true; ask();
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [ask]);
  return { data, bump: ask };
}

/** A job waiting for a free slot (its record's `waiting`, which a record may not carry yet). */
const waits = (j: object) => (j as { waiting?: unknown }).waiting === true;
/** The jobs running and not waiting for a slot (`activity-count`, `activity-toggle`). */
export const runningCount = (a: Activity | null) => (a ? a.jobs.filter((j) => j.status === "running" && !waits(j)).length : 0);

export function ActivityPanel({ data }: { data: Activity | null }) {
  const n = runningCount(data);
  const anyRunning = !!data?.jobs.some((j) => j.status === "running");
  return (
    <section className="hm-panel hm-act" data-testid="activity" aria-label="Activity">
      <header>Activity{n > 0 && <span className="hm-run-n" data-testid="activity-count"><span className="hm-pulse" aria-hidden="true" />{n} running</span>}</header>
      <div className="pad">
        {!anyRunning && <p className="none" data-testid="activity-none">Nothing is running.</p>}
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
