import { describe, expect, it } from "vitest";
import { COMPACT, measureNode, T } from "./geometry";
import { MONO_ADVANCE } from "./metrics.generated";
import { monoWidth, textWidth } from "./text";
import { node } from "./testkit";

const em = (text: string, weight: 400 | 500 | 600 = 400) => textWidth(text, 100, weight) / 102;

describe("text outside Latin is measured as wide as it is drawn (#134)", () => {
  it("measures Cyrillic at Geist's own advances", () => {
    expect(em("Ш", 600)).toBeCloseTo(0.98, 3);
    expect(em("Щ", 600)).toBeCloseTo(1.033, 3);
    expect(em("Ж", 600)).toBeCloseTo(0.974, 3);
    expect(em("ШЛЮЗ ПЛАТЕЖЕЙ", 600)).toBeCloseTo(9.304, 3);
  });

  it("counts a capital Geist lacks (Greek) at 0.85 em, other unknown letters at 0.62 em", () => {
    expect(em("Ψ")).toBeCloseTo(0.85, 6);
    expect(em("ΣΦΔ")).toBeCloseTo(2.55, 6);
    expect(em("ψ")).toBeCloseTo(0.62, 6);
    // The few Greek letters Geist has are measured from it.
    expect(em("Ω", 600)).toBeCloseTo(0.755, 3);
  });

  it("counts an emoji at 1.4 em and CJK at 1 em; joiners and variation selectors take no room", () => {
    expect(em("📦📦📦📦📦")).toBeCloseTo(7, 6);
    expect(em("✅")).toBeCloseTo(1.4, 6);
    expect(em("❤️")).toBeCloseTo(1.4, 6);
    expect(em("订单数据库缓存")).toBeCloseTo(7, 6);
  });

  it("counts characters Geist Mono lacks at their fallback width", () => {
    expect(monoWidth("src/io.ts", 10)).toBeCloseTo(9 * MONO_ADVANCE * 10, 6);
    expect(monoWidth("ЗАКАЗ", 10)).toBeCloseTo(5 * MONO_ADVANCE * 10, 6);
    expect(monoWidth("订单数据库缓存", 10)).toBeCloseTo(70, 6);
    expect(monoWidth("📦📦📦📦📦", 10)).toBeCloseTo(70, 6);
  });

  it("makes a compact part wide enough for a CJK or emoji sub-line beside its label", () => {
    const label = textWidth("Order database", T.compactTitle.size, 600, T.compactTitle.tracking);
    // As Chromium draws them with the fallback fonts: CJK 1 em, emoji 1.37 em (Segoe UI Emoji).
    for (const [sub, drawn] of [["订单数据库缓存", 7 * 1.0], ["📦📦📦📦📦", 5 * 1.37]] as const) {
      const box = measureNode(node("db", { form: "compact", label: "Order database", sub }));
      // The room the sub-line has right of the label, as svg.ts lays it out.
      const room = box.w - (COMPACT.padX * 2 + COMPACT.icon + COMPACT.gap) - label - COMPACT.gap;
      expect(box.sub, sub).toBe(sub);
      expect(room, sub).toBeGreaterThanOrEqual(drawn * T.subMono.size);
    }
  });
});
