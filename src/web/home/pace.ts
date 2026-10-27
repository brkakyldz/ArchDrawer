/**
 * Progress lines on screen one at a time (ui contract, `draw-progress` and `draw-error`): every
 * line a run sends is shown, in order, none skipped. A stream can hand several lines over at once —
 * a run's past lines are replayed back to back when its stream opens, and a draw that reuses its
 * read sends `Using the facts already read`, `Checking the facts` and `Drawing the overview` with no
 * engine call between — and a renderer that batches updates would show only the last of them.
 *
 * `paced` hands each item to `show` in order: the first at once, each later one only after `next`
 * calls back, which in the browser is after the screen has been painted (`afterPaint`).
 */
export function paced<T>(show: (item: T) => void, next: (go: () => void) => void): { push: (item: T) => void; stop: () => void } {
  const queue: T[] = [];
  let waiting = false, stopped = false;
  const flush = () => {
    if (stopped || !queue.length) return;
    show(queue.shift()!);
    waiting = true;
    next(() => { waiting = false; flush(); });
  };
  return {
    push: (item) => { if (stopped) return; queue.push(item); if (!waiting) flush(); },
    stop: () => { stopped = true; queue.length = 0; },
  };
}

/**
 * Calls `go` once the frame that shows the latest change has been painted: the task after the next
 * animation frame. A hidden page paints nothing and pauses animation frames, so a short timer
 * stands in for the frame there.
 */
export function afterPaint(go: () => void): void {
  let ran = false;
  const once = () => { if (!ran) { ran = true; go(); } };
  const fallback = setTimeout(once, 100);
  requestAnimationFrame(() => { clearTimeout(fallback); setTimeout(once, 0); });
}
