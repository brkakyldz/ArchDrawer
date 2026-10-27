import { EngineError } from "./engines/types";

/**
 * The engine slots of the whole server (api contract, *Engine slots*; JOB-1, ADR 0016): at most `total`
 * engine processes at a time. A scan that starts an engine, each choice of a draw and each run of another
 * kind asks for one; what finds none free waits in one queue, first come first served, and a freed slot
 * goes to the oldest waiting request at once. Detecting engines takes none.
 */
export interface SlotTicket {
  /** True when a slot was free at once: the request never waited. */
  readonly granted: boolean;
  /** Resolves once the slot is held; rejects (`Cancelled`) when the request leaves the queue first. */
  readonly ready: Promise<void>;
  /** Frees a held slot, or takes a waiting request out of the queue. Idempotent. */
  release(): void;
}

/** The line a request that finds no free slot gets (api contract, Engine slots). */
export const WAITING = "Waiting for a free engine";

export interface SlotStats { total: number; busy: number; waiting: number }

export class EngineSlots {
  private busy = 0;
  private readonly queue: { grant: () => void }[] = [];

  constructor(readonly total: number) {}

  /** `{total, busy, waiting}`, as `GET /api/activity` lists them. */
  stats(): SlotStats {
    return { total: this.total, busy: this.busy, waiting: this.queue.length };
  }

  request(): SlotTicket {
    let state: "waiting" | "held" | "done" = "waiting";
    let resolve!: () => void, reject!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    // A rejection nobody awaits (a request released before anyone asked) is no error.
    ready.catch(() => {});
    const entry = { grant: () => { state = "held"; this.busy++; resolve(); } };
    const granted = this.busy < this.total && this.queue.length === 0;
    if (granted) entry.grant();
    else this.queue.push(entry);
    return {
      granted,
      ready,
      release: () => {
        if (state === "held") {
          state = "done";
          this.busy--;
          this.next();
        } else if (state === "waiting") {
          state = "done";
          const at = this.queue.indexOf(entry);
          if (at >= 0) this.queue.splice(at, 1);
          reject(new EngineError("Cancelled"));
        }
      },
    };
  }

  /**
   * Waits for a slot unless `signal` aborts first: then the request leaves the queue and this rejects
   * with `Cancelled`. `onWait` is called, synchronously, when the request has to wait.
   */
  async take(signal: AbortSignal, onWait?: () => void): Promise<SlotTicket> {
    const ticket = this.request();
    if (!ticket.granted) onWait?.();
    const abort = () => ticket.release();
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) ticket.release();
      await ticket.ready;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    // A slot granted in the same moment the request was cancelled goes back at once.
    if (signal.aborted) { ticket.release(); throw new EngineError("Cancelled"); }
    return ticket;
  }

  /** Hands freed slots to the oldest waiting requests. */
  private next(): void {
    while (this.busy < this.total && this.queue.length) this.queue.shift()!.grant();
  }
}

/** `ARCHDRAW_ENGINE_SLOTS`: an integer from 1 to 8; anything else gives 3 (testing contract). */
export function slotCount(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 3;
}
