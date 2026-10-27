import { describe, expect, it } from "vitest";
import { EngineSlots, slotCount } from "./slots";

// The engine slots of the whole server (api contract, Engine slots; JOB-1): first come first served, a freed slot
// goes to the oldest waiting request at once, and a request that leaves the queue never holds one.

const settled = async (p: Promise<unknown>) => {
  let state = "pending";
  p.then(() => (state = "held"), () => (state = "left"));
  await new Promise((r) => setTimeout(r, 0));
  return state;
};

describe("engine slots", () => {
  it("grants up to the total at once, queues the rest in order and hands each freed slot to the oldest waiting", async () => {
    const slots = new EngineSlots(2);
    const [a, b, c, d] = [slots.request(), slots.request(), slots.request(), slots.request()];
    expect([a.granted, b.granted, c.granted, d.granted]).toEqual([true, true, false, false]);
    expect(slots.stats()).toEqual({ total: 2, busy: 2, waiting: 2 });
    expect(await settled(c.ready)).toBe("pending");
    b.release();
    expect([await settled(c.ready), await settled(d.ready)]).toEqual(["held", "pending"]);
    expect(slots.stats()).toEqual({ total: 2, busy: 2, waiting: 1 });
    // Releasing twice frees once.
    b.release();
    expect(slots.stats()).toEqual({ total: 2, busy: 2, waiting: 1 });
    a.release();
    expect(await settled(d.ready)).toBe("held");
    c.release(); d.release();
    expect(slots.stats()).toEqual({ total: 2, busy: 0, waiting: 0 });
  });

  it("a request released while it waits leaves the queue, holds nothing, and the next one moves up", async () => {
    const slots = new EngineSlots(1);
    const a = slots.request(), b = slots.request(), c = slots.request();
    b.release();
    expect(await settled(b.ready)).toBe("left");
    expect(slots.stats()).toEqual({ total: 1, busy: 1, waiting: 1 });
    a.release();
    expect(await settled(c.ready)).toBe("held");
    expect(slots.stats()).toEqual({ total: 1, busy: 1, waiting: 0 });
  });

  it("take: says when it has to wait, and an abort while waiting takes it out of the queue", async () => {
    const slots = new EngineSlots(1);
    const holder = await slots.take(new AbortController().signal);
    let waited = 0;
    const abort = new AbortController();
    const waiting = slots.take(abort.signal, () => waited++);
    const after = slots.take(new AbortController().signal);
    expect([waited, slots.stats()]).toEqual([1, { total: 1, busy: 1, waiting: 2 }]);
    abort.abort();
    await expect(waiting).rejects.toThrow("Cancelled");
    expect(slots.stats()).toEqual({ total: 1, busy: 1, waiting: 1 });
    holder.release();
    const next = await after;
    expect(next.granted).toBe(false);
    expect(slots.stats()).toEqual({ total: 1, busy: 1, waiting: 0 });
    next.release();
    // An aborted signal never gets a slot, even a free one.
    const gone = new AbortController();
    gone.abort();
    await expect(slots.take(gone.signal)).rejects.toThrow("Cancelled");
    expect(slots.stats()).toEqual({ total: 1, busy: 0, waiting: 0 });
  });

  it("reads ARCHDRAW_ENGINE_SLOTS: an integer from 1 to 8, else 3", () => {
    expect(["1", "8", " 4 "].map(slotCount)).toEqual([1, 8, 4]);
    for (const bad of [undefined, "", "0", "9", "2.5", "x", "-1", "3e0"]) expect(slotCount(bad), String(bad)).toBe(3);
  });
});
