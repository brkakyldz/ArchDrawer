import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeFolder } from "./testkit";

// A volume without links (FAT, exFAT on Windows answers EISDIR): the draw claims the name by creating
// it exclusively instead (api contract, The draw run). Its own file: `node:fs` is replaced here.
vi.mock("node:fs", async (load) => {
  const fs = await load<typeof import("node:fs")>();
  const linkSync = () => { throw Object.assign(new Error("EISDIR: illegal operation on a directory, link"), { code: "EISDIR" }); };
  return { ...fs, default: { ...fs, linkSync }, linkSync };
});

const { writeNewDrawing } = await import("./draw");

describe("a new drawing where links fail", () => {
  it("is written by an exclusive copy under the first free name, never replacing one, and leaves no temporary file", () => {
    const folder = makeFolder({ "docs/architecture.archdraw.json": "mine" });
    const path = writeNewDrawing(folder, '{"new":true}');
    expect(path).toBe(join(folder, "docs", "architecture-2.archdraw.json"));
    expect(readFileSync(path, "utf8")).toBe('{"new":true}');
    expect(readFileSync(join(folder, "docs", "architecture.archdraw.json"), "utf8")).toBe("mine");
    expect(readdirSync(join(folder, "docs")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
