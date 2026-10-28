import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RENAME_WAITS, writeAtomic } from "./files";
import { tempDir } from "./testkit";

describe("writeAtomic", () => {
  it("writes through a temporary file", () => {
    const dir = tempDir();
    writeAtomic(join(dir, "a.json"), "{}\n");
    expect(readFileSync(join(dir, "a.json"), "utf8")).toBe("{}\n");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  it("gives up on a target it cannot replace quickly and leaves no temporary file", () => {
    const dir = tempDir();
    // A folder in the way: Windows refuses the rename with EPERM (retried), others with EISDIR.
    mkdirSync(join(dir, "taken"));
    expect(() => writeAtomic(join(dir, "taken"), "{}\n")).toThrow();
    // The waits between retries block the event loop, so together they stay short (issue #125).
    expect(RENAME_WAITS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    expect(readdirSync(dir)).toEqual(["taken"]);
  });
});
