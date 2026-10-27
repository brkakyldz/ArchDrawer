import { useEffect, useState } from "react";
import { navigate } from "../App";
import { Icon } from "../ui/Icon";
import { choiceTime, endedLine, filesText, openUrl, partsText, quietSeconds, quietText, readyText, STAGES, stageState, stageText, type Row } from "./jobs";
import type { Draw } from "./Start";
import { serverNow } from "./time";

/**
 * `draw-progress` (ui contract, *Following a job*): one row per choice of the followed draw, each with its stages,
 * its time, and its latest line with a pulse on each event; then the draw's line while it runs, `Ready` once it
 * succeeded, or its error once it failed or was cancelled. DESIGN.md, Home screen, *Draw rows*.
 */

/** The server's clock in ms, rendered again every second while `ticking`. */
export function useNow(ticking: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return serverNow().getTime();
}

function ChoiceRow({ r, channel, drawRuns, now, timeoutMs }: { r: Row; channel: string | null; drawRuns: boolean; now: number; timeoutMs: number | null }) {
  const quiet = drawRuns ? quietSeconds(r, now) : null;
  const files = r.filesRead ?? 0;
  return (
    <div className="hm-run" data-testid="draw-choice" data-choice={r.id} data-kind={r.kind} data-state={r.status} data-quiet={quiet !== null || undefined}>
      <b data-testid="draw-choice-title">{r.title}</b>
      <ol className="hm-stages">
        {STAGES.map((s) => <li key={s} className="hm-stage" data-testid="draw-stage" data-stage={s} data-state={stageState(r, s)}><span>{stageText(r, s, channel)}</span><i aria-hidden="true" /></li>)}
      </ol>
      <span className="hm-run-time" data-testid="draw-choice-time">{choiceTime(r, now)}</span>
      <p className="hm-run-line" data-testid="draw-choice-line">
        {r.status === "running" ? (
          <>
            {/* A new element on every event, so the ring goes out once each time. */}
            <i key={r.events} className="hm-beat" data-testid="draw-choice-pulse" data-events={r.events} aria-hidden="true" />
            {quiet !== null ? <span className="q" data-testid="draw-choice-quiet">{quietText(quiet, timeoutMs)}</span> : <span className="msg">{r.message ?? ""}</span>}
            {files > 0 && <>{" "}<span className="n" data-testid="draw-choice-files">{filesText(files)}</span></>}
            {r.parts != null && <>{" "}<span className="n" data-testid="draw-choice-parts">{partsText(r.parts)}</span></>}
          </>
        ) : endedLine(r, drawRuns)}
      </p>
    </div>
  );
}

export function DrawProgress({ d, timeoutMs, onCancel, onAnother, onRetry }: {
  d: Draw; timeoutMs: number | null; onCancel: () => void; onAnother: () => void; onRetry: () => void;
}) {
  const runs = d.status === "running";
  const now = useNow(runs);
  const failed = d.rows.some((r) => r.status === "failed");
  const another = <button type="button" className="btn small hm-ghost" data-testid="draw-another" onClick={onAnother}>Draw another project</button>;
  const retry = <button type="button" className="btn small" data-testid="draw-retry" onClick={onRetry}>Try again</button>;
  return (
    <div className="hm-drawing" data-testid="draw-progress" role="status">
      <div className="hm-runs">
        {d.rows.map((r) => <ChoiceRow key={r.id} r={r} channel={d.channel} drawRuns={runs} now={now} timeoutMs={timeoutMs} />)}
      </div>
      {runs && !d.lost && (
        <div className="hm-log">
          <span className="hm-spin small" aria-hidden="true" />
          <span data-testid="draw-line">{d.writing ? "Writing the drawing" : d.line}</span>
          {another}
          {!d.writing && <button type="button" className="btn small" data-testid="draw-cancel" disabled={!d.runId} onClick={onCancel}>Cancel</button>}
        </div>
      )}
      {d.status === "succeeded" && (
        <div className="hm-ready">
          <p data-testid="draw-ready"><Icon name="check" size={15} stroke={2.4} /><b>Ready</b>{" "}<span>{readyText(d.rows, d.channel)}</span></p>
          <button type="button" className="btn primary small" data-testid="draw-open" disabled={!d.diagramId}
            onClick={() => d.diagramId && navigate(openUrl(d.diagramId, d.choice, d.channel))}>Open</button>
          {another}
          {failed && retry}
        </div>
      )}
      {(d.status === "failed" || d.status === "cancelled" || (runs && d.lost)) && (
        <div className="hm-log bad">
          <span data-testid="draw-error" role="alert">{d.error}</span>
          {retry}
          {another}
        </div>
      )}
    </div>
  );
}
