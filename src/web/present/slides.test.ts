import { describe, expect, it } from "vitest";
import { startSwitches } from "../../core/export/share";
import type { Step } from "../../core/file3";
import type { DiagramDocument } from "../../core/model";
import { atOf, firstIndex, indexOf, noteLines, SLIDE_SWITCHES, statusOf } from "./slides";

const steps: Step[] = [
  { id: "s1", parts: ["a"], text: "One", note: "Line one\nLine two" },
  { id: "s2", parts: ["b"], text: "Two", note: "" },
  { id: "s3", parts: ["a", "b"], text: "Three", note: "  \n" },
];
const doc = (caption: string, s = steps) =>
  ({ title: "The doc", steps: s, views: [{ caption: { title: caption, lede: "" } }] }) as unknown as Pick<DiagramDocument, "views" | "steps" | "title">;

describe("the slide shown, followed by its step", () => {
  it("is the opening slide for null and the step's place otherwise", () => {
    expect(indexOf(steps, null)).toBe(0);
    expect(indexOf(steps, "s2")).toBe(2);
  });
  it("follows a step that moved, and shows the last step when it is gone", () => {
    expect(indexOf([steps[1], steps[0], steps[2]], "s2")).toBe(1);
    expect(indexOf([steps[0], steps[2]], "s2")).toBe(2);
  });
  it("names the step at an index, and null for the opening slide", () => {
    expect(atOf(steps, 0)).toBeNull();
    expect(atOf(steps, 3)).toBe("s3");
    expect(atOf(steps, 4)).toBeNull();
  });
  it("starts the tour at the first step and presenting at the opening slide", () => {
    expect(firstIndex("present")).toBe(0);
    expect(firstIndex("tour")).toBe(1);
  });
});

describe("present-status", () => {
  it("says the step, its place and its text, independent of the toggles", () => {
    expect(statusOf(doc("Cap"), 2)).toBe("Step 2 of 3: Two");
  });
  it("says the caption title on the opening slide, the document title when it is empty", () => {
    expect(statusOf(doc("Cap"), 0)).toBe("Cap");
    expect(statusOf(doc(""), 0)).toBe("The doc");
  });
});

describe("the speaker note", () => {
  it("keeps its newlines, and an empty or blank note is none", () => {
    expect(noteLines(steps[0].note)).toEqual(["Line one", "Line two"]);
    expect(noteLines("")).toBeNull();
    expect(noteLines(steps[2].note)).toBeNull();
  });
});

describe("the toggles a presented slide uses", () => {
  it("are the slide format's starting toggles, with title and lede on for the opening slide", () => {
    expect(SLIDE_SWITCHES).toEqual({ ...startSwitches("slide", false), title: true, lede: true });
  });
});
