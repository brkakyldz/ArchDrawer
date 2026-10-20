import { describe, expect, it } from "vitest";
import { countText, findParts, stepMatch } from "./Find";

describe("search", () => {
  const doc = {
    views: [
      { id: "a", title: "A", nodes: [{ id: "db", label: "Orders DB" }, { id: "api", label: "Order API" }, { id: "web", label: "Web" }] },
      { id: "b", title: "B", nodes: [{ id: "q", label: "orders queue" }] },
    ],
  } as unknown as Parameters<typeof findParts>[0];

  it("finds labels in every view, case-insensitively, in file order", () => {
    expect(findParts(doc, "  ORDER ").map((h) => `${h.view}/${h.id}`)).toEqual(["a/db", "a/api", "b/q"]);
    expect(findParts(doc, "   ")).toEqual([]);
  });

  it("steps forward and back through the matches, wrapping, starting at the first or the last", () => {
    const ids = ["db", "api", "q"];
    expect(stepMatch(ids, null)).toBe("db");
    expect(stepMatch(ids, null, true)).toBe("q");
    expect(stepMatch(ids, "db")).toBe("api");
    expect(stepMatch(ids, "q")).toBe("db");
    expect(stepMatch(ids, "db", true)).toBe("q");
    expect(stepMatch(ids, "gone")).toBe("db");
    expect(stepMatch([], null)).toBeNull();
  });

  it("counts the matches in this view, and says which one is current", () => {
    expect(countText(0, -1)).toBe("No match in this view");
    expect(countText(1, -1)).toBe("1 match");
    expect(countText(3, -1)).toBe("3 matches");
    expect(countText(3, 1)).toBe("2 of 3");
  });
});
