import { describe, expect, it } from "vitest";
import { layoutRects } from "../geometry";
import { shapeGeometry, shapeOf, type PartShape } from "../shapes";
import { fillDefaults, type DiagramView } from "../model";
import { node } from "../testkit";
import { PALETTES } from "../theme";
import { drawView } from "./svg";

// NAV-1 (diagram contract, The open mark): a part with an inside draws a 20 px circle in its kind colour holding the layers icon.
const view = (): DiagramView => fillDefaults({ version: 2, title: "marks", views: [{ id: "v", title: "V", caption: { what: "", how: "", notice: "" }, nodes: [
  node("card", { x: 0, y: 0, detail: "v2", kind: "service" }), node("cmp", { x: 400, y: 0, detail: "v2", form: "compact", kind: "data" }),
  node("zone", { x: 0, y: 300, detail: "v2", form: "group" }), node("in", { x: 40, y: 380, parent: "zone" }), node("plain", { x: 800, y: 0 }),
], edges: [] }, { id: "v2", title: "V2", caption: { what: "", how: "", notice: "" }, nodes: [node("x", { x: 0, y: 0 })], edges: [] }] } as never).views[0] as DiagramView;

const circleIn = (body: string, id: string, head = false) => {
  const at = body.indexOf(head ? `<g data-group-head="${id}"` : `<g data-node-id="${id}"`);
  const g = body.slice(at, body.indexOf("</g>", body.indexOf('class="open-mark"', at)) + 4);
  const m = /class="open-mark"><circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="([^"]+)"\/>/.exec(g);
  return m ? { cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]), fill: m[4], g } : null;
};

describe("the open mark (#184)", () => {
  it("sits 8 px inside a card's top-right, 12 px inside a compact part's right end, at the right of a group's header; none on a plain part", () => {
    const v = view(), rects = layoutRects(v), P = PALETTES.light, body = drawView(v, P).body;
    const front = (id: string) => shapeGeometry(shapeOf(v.nodes.find((n) => n.id === id)!) as PartShape, id === "cmp", false, rects.get(id)!).front;
    const card = circleIn(body, "card")!, f = front("card");
    expect([card.r, card.fill]).toEqual([10, P.kinds.service]);
    expect([card.cx + 10, card.cy - 10]).toEqual([f.x + f.w - 8, f.y + 8]);
    expect(card.g).toContain('fill="none"'); // the layers icon is stroked
    expect(card.g).toContain(`stroke="${P.canvas}"`);
    const cmp = circleIn(body, "cmp")!, fc = front("cmp");
    expect([cmp.cx + 10, cmp.cy]).toEqual([fc.x + fc.w - 12, fc.y + fc.h / 2]);
    const zone = circleIn(body, "zone", true)!, z = rects.get("zone")!;
    expect(zone.cx + 10).toBeLessThanOrEqual(z.x + z.w);
    expect(body).toMatch(/<g data-node-id="card" [^>]*data-open="true"/);
    expect(body).toMatch(/<g data-node-id="zone" [^>]*data-open="true"/);
    expect(body).not.toMatch(/<g data-node-id="plain" [^>]*data-open/);
    expect(circleIn(body, "plain")).toBeNull();
  });
});
