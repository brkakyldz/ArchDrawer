import { describe, expect, it } from "vitest";
import { detailAt, reveal, rectToScreen, zoomPercent } from "./viewport";

describe("reveal moves the view only for a part that is off screen", () => {
  const inset = { top: 60, side: 20, bottom: 20 };
  it("keeps the viewport when the part is wholly on the stage, even inside the margins", () => {
    const v = { x: -100, y: -50, k: 0.8 };
    expect(reveal(v, { x: 200, y: 200, w: 160, h: 60 }, 1000, 700, inset)).toBe(v);
    const atEdge = { x: 0, y: 0, k: 1 };
    expect(reveal(atEdge, { x: 2, y: 4, w: 160, h: 60 }, 1000, 700, inset)).toBe(atEdge);
  });
  it("centres a part that is off screen, or partly off it, at the same zoom in the stage less the inset", () => {
    const v = { x: 0, y: 0, k: 1.5 };
    for (const r of [{ x: 2000, y: 100, w: 160, h: 60 }, { x: 100, y: -10, w: 160, h: 60 }, { x: -80, y: 300, w: 160, h: 60 }]) {
      const next = reveal(v, r, 1000, 700, inset);
      expect(next.k).toBe(1.5);
      const s = rectToScreen(next, r);
      expect(s.x + s.w / 2).toBeCloseTo(500);
      expect(s.y + s.h / 2).toBeCloseTo((60 + 680) / 2);
    }
  });
  it("moves a part that is on the stage but under a panel to the area below the panel", () => {
    const v = { x: 0, y: 0, k: 1 };
    const panel = { x: 300, y: 14, w: 400, h: 180 };
    const r = { x: 400, y: 100, w: 160, h: 60 };
    const next = reveal(v, r, 1000, 700, inset, panel);
    const s = rectToScreen(next, r);
    expect(s.y).toBeGreaterThanOrEqual(panel.y + panel.h);
    expect(s.y + s.h / 2).toBeCloseTo((14 + 180 + 16 + 680) / 2);
    expect(reveal(v, { x: 750, y: 100, w: 160, h: 60 }, 1000, 700, inset, panel)).toBe(v); // beside the panel: stays
  });
});

describe("semantic zoom follows the zoom the toolbar shows", () => {
  it("is full whenever the toolbar shows 75 % or more, outline from 50 %, overview below", () => {
    // A fit of 0.5207 zoomed in twice by 1.2 is 0.7498: shown as 75 %, so full.
    expect(zoomPercent(0.5207 * 1.2 * 1.2)).toBe(75);
    expect(detailAt(0.5207 * 1.2 * 1.2)).toBe("full");
    expect(detailAt(0.7449)).toBe("outline");
    expect(detailAt(0.4996)).toBe("outline");
    expect(detailAt(0.4949)).toBe("overview");
    for (let k = 0.15; k <= 3; k += 0.0007) {
      const p = zoomPercent(k);
      expect(detailAt(k)).toBe(p >= 75 ? "full" : p >= 50 ? "outline" : "overview");
    }
  });
});
