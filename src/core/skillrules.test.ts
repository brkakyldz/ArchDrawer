import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFile3 } from "./file3";

// The plugin skill writes the first drawing; its rules show the file it must write (FILE-2).
describe("the skill's example file", () => {
  it("is a valid archdraw/diagram@3 file", () => {
    const rules = readFileSync("skills/archdrawer/rules.md", "utf8").replace(/\r\n/g, "\n");
    const block = /\n## The file\n\n```json\n([\s\S]*?)\n```/.exec(rules)?.[1];
    expect(block).toBeTruthy();
    expect(validateFile3(JSON.parse(block!)).errors).toEqual([]);
  });
});
