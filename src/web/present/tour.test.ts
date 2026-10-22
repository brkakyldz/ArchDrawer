import { describe, expect, it } from "vitest";
import type { ComponentFact, Document3 } from "../../core/file3";
import { tourFiles, tourParts } from "./tour";

const fact = (id: string, files: string[], evidence: ComponentFact["evidence"] = []): ComponentFact =>
  ({ id, label: id, kind: "service", sub: "", description: "", files, items: [], evidence }) as ComponentFact;
const part = (id: string, facts: string[], held: string[] = []) => ({ id, facts, held, form: "box", icon: null, parent: null, detail: null, place: null, x: 0, y: 0 });

const doc = {
  facts: {
    components: [
      fact("web", ["src/web.ts"], [{ file: "src/web.ts", lines: [1, 1] }]),
      fact("api", ["src/api.ts"], [{ file: "src/api.ts", lines: [3, 9] }, { file: "src/db.ts", lines: [2, 2] }, { file: "src/api.ts", lines: [20, 24] }, { file: "src/api.ts", lines: [3, 9] }]),
      fact("retry", ["src/extra.ts"], [{ file: "src/extra.ts", lines: [40, 52] }, { file: "src/notes.md", lines: null }]),
      fact("db", []),
      fact("gw1", ["src/db.ts", "src/web.ts"]),
      fact("gw2", ["src/web.ts", "src/extra.ts"]),
    ],
    relations: [],
  },
  channels: {
    presentation: {
      views: [{ nodes: [part("storefront", ["web"]), part("desk", ["api"], ["retry"]), part("ledger", ["db"]), part("gateway", ["gw1", "gw2"])] }],
    },
  },
} as unknown as Pick<Document3, "facts" | "channels">;

describe("tour-file", () => {
  it("lists a fact's files, then its evidence files, then the held facts', each path once with its ranges in order", () => {
    expect(tourFiles(doc, "desk").map((f) => f.text)).toEqual(["src/api.ts:3–9, :20–24", "src/db.ts:2", "src/extra.ts:40–52", "src/notes.md"]);
    expect(tourFiles(doc, "desk").map((f) => f.path)).toEqual(["src/api.ts", "src/db.ts", "src/extra.ts", "src/notes.md"]);
  });
  it("writes a one-line range as its line alone", () => {
    expect(tourFiles(doc, "storefront")).toEqual([{ path: "src/web.ts", text: "src/web.ts:1" }]);
  });
  it("lists a merged part's files once, in the order of its facts", () => {
    expect(tourFiles(doc, "gateway").map((f) => f.text)).toEqual(["src/db.ts", "src/web.ts", "src/extra.ts"]);
  });
  it("is empty for a part with no file, and for a part that is not in the view", () => {
    expect(tourFiles(doc, "ledger")).toEqual([]);
    expect(tourFiles(doc, "nowhere")).toEqual([]);
  });
});

describe("tour-part", () => {
  it("follows the order of the view's parts, not the step's", () => {
    const view = doc.channels.presentation.views[0] as never;
    expect(tourParts(view, { parts: ["desk", "storefront"] }).map((n) => n.id)).toEqual(["storefront", "desk"]);
  });
});
