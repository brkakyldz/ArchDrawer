import { describe, expect, it } from "vitest";
import { detailAt, zoomPercent } from "./viewport";

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
