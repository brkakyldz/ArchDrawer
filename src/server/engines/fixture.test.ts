import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureEngine } from "./fixture";
import type { EngineRunRequest } from "./types";

// The fixture's own markers that no draw test reaches through a server (testing contract, Draw).
describe("fixture engine", () => {
  afterEach(() => vi.useRealTimers());

  it("[fixture:quiet] sends no line for 45 s after the read's Reading the code line, then goes on", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const req = {
      cwd: ".", folderName: "shop", instruction: "Quiet one [fixture:quiet]", view: "overview", model: null, scope: { kind: "all" }, parts: [], base: null,
      signal: new AbortController().signal, timeoutMs: 600_000, progress: (m: string) => lines.push(m),
      task: { kind: "draw", data: { draw: "read", choiceIndex: 1, listing: ["src/a.ts"] } },
    } as unknown as EngineRunRequest;
    const answer = new FixtureEngine(10).run(req).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(25);
    expect(lines).toEqual(["Reading the drawing", "Reading the code"]);
    await vi.advanceTimersByTimeAsync(44_900);
    expect(lines.at(-1), "quiet for 45 s").toBe("Reading the code");
    await vi.advanceTimersByTimeAsync(200);
    expect(lines.at(-1)).toBe("Updating the drawing");
    await vi.runAllTimersAsync();
    await answer;
  });
});
