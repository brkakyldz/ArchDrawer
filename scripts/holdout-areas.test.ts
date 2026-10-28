import { describe, expect, it } from "vitest";
import { holdoutSelection } from "./holdout-areas.mjs";

describe("which held-out scenarios a pull request runs", () => {
  it("runs none for paths no scenario observes", () => {
    expect(holdoutSelection(["README.md", "docs/decisions/0018-x.md", "tests/e2e/ai.spec.ts", "src/core/layout.test.ts", ""])).toBe("NONE");
  });

  it("runs the areas of the changed paths and the smoke journeys", () => {
    const grep = holdoutSelection(["src/web/present/Present.tsx", "src\\web\\share\\image.ts"]);
    expect(grep).toBe("@smoke|\\b(PRES|SHARE)-[0-9]");
    const re = new RegExp(grep);
    expect(re.test("H126 [STORY-4, PRES-1] draw the presentation")).toBe(true);
    expect(re.test("H190 [SCAN-2] the scan proposes options")).toBe(false);
    expect(re.test("H12 [EDIT-1] @smoke rename a part")).toBe(true);
  });

  it("runs all for a path no rule names or one every area depends on", () => {
    expect(holdoutSelection(["src/web/present/Present.tsx", "src/core/model.ts"])).toBe("ALL");
    expect(holdoutSelection(["docs/contracts/ui.md"])).toBe("ALL");
    expect(holdoutSelection(["tests/acceptance/holdout/H84_x.spec.ts"])).toBe("ALL");
    expect(holdoutSelection(["package.json"])).toBe("ALL");
  });
});
