import { describe, expect, it } from "vitest";
import { paced } from "./pace";

// Progress lines on screen one at a time (ui contract, draw-error: a reused stage shows `running`
// with its `Using …` line, then `done` once the next stage starts). The browser's frame is replaced
// by a callback the test fires by hand.

const READ_REUSED = [
  { message: "Using the facts already read", stage: "read" },
  { message: "Checking the facts", stage: "read" },
  { message: "Drawing the overview", stage: "overview" },
];

function harness() {
  const shown: unknown[] = [];
  const frames: (() => void)[] = [];
  const p = paced((item: unknown) => shown.push(item), (go) => frames.push(go));
  const frame = () => frames.shift()?.();
  return { p, shown, frames, frame };
}

describe("paced progress", () => {
  it("shows every line of a burst, in order, one per painted frame", () => {
    const { p, shown, frame } = harness();
    for (const e of READ_REUSED) p.push(e);
    // The replayed burst arrives at once: only the first is shown before the screen is painted.
    expect(shown).toEqual([READ_REUSED[0]]);
    frame();
    expect(shown).toEqual(READ_REUSED.slice(0, 2));
    frame();
    expect(shown).toEqual(READ_REUSED);
    frame();
    expect(shown).toEqual(READ_REUSED);
  });

  it("shows a line at once when the one before it has been painted", () => {
    const { p, shown, frames, frame } = harness();
    p.push("a");
    frame();
    expect(frames).toHaveLength(0);
    p.push("b");
    expect(shown).toEqual(["a", "b"]);
  });

  it("shows nothing more once stopped", () => {
    const { p, shown, frame } = harness();
    p.push("a"); p.push("b");
    p.stop();
    frame();
    p.push("c");
    expect(shown).toEqual(["a"]);
  });
});
