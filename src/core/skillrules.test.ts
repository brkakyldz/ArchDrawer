import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFile3 } from "./file3";

// The plugin skill writes the first drawing; its rules show the file it must write (FILE-2).
describe("the skill's example file", () => {
  const rules = () => readFileSync("skills/archdrawer/rules.md", "utf8").replace(/\r\n/g, "\n");
  const example = () => /\n## The file\n\n```json\n([\s\S]*?)\n```/.exec(rules())?.[1];

  it("is a valid archdraw/diagram@3 file", () => {
    const block = example();
    expect(block).toBeTruthy();
    expect(validateFile3(JSON.parse(block!)).errors).toEqual([]);
  });

  it("gives every component a one-line sub-line, the default description (LOOK-3)", () => {
    const file = JSON.parse(example()!) as { facts: { components: { id: string; sub: string }[] } };
    for (const c of file.facts.components) expect(c.sub.trim(), c.id).not.toBe("");
    expect(rules()).toMatch(/Every part says what it does in one line/);
  });
});
