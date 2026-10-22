import { outlineOf, shapeOf, type OutlineSize } from "../../core/export/svg";
import type { Form, Kind } from "../../core/model";

/** The thumb's outline measures, the drawing's own scaled to a 48 × 32 picture. */
const THUMB: OutlineSize = { rad: 4, inset: 2, head: 3, headX: 8, ry: 2.5, cut: 4 };

/**
 * A small picture of a form (ui contract `form-thumb`): what a card, compact, panel or group looks like, a card or
 * compact drawn in the shape of the kind (diagram contract, Geometry, Shapes); without a `kind`, the plain card.
 */
export function FormThumb({ form, kind }: { form: Form; kind?: Kind }) {
  const shape = shapeOf({ form, kind: kind ?? "service" });
  const box = { fill: "var(--surface)", stroke: "currentColor", strokeWidth: 1.2 } as const;
  const ink = { fill: "currentColor", opacity: 0.55 } as const;
  const outline = (x: number, y: number, w: number, h: number) => {
    const ol = outlineOf(shape, { x, y, w, h }, THUMB);
    return (
      <>
        <path className="body" data-shape={shape} d={ol.d} {...box} strokeDasharray={ol.dash ? "2.5 1.8" : undefined} />
        {ol.marks.map((d) => <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="0.9" opacity={0.6} />)}
        {ol.dot && <circle cx={ol.dot.cx} cy={ol.dot.cy} r={Math.max(1.2, ol.dot.r)} fill="currentColor" opacity={0.8} />}
      </>
    );
  };
  return (
    <svg className="form-thumb" data-testid="form-thumb" data-shape={shape} viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
      {form === "card" && (
        <>
          {outline(9, 3, 30, 26)}
          <circle cx="24" cy="11" r="3" {...ink} />
          <rect x="16" y="17" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="18.5" y="22" width="11" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "compact" && (
        <>
          {outline(3, 9, 42, 14)}
          <circle cx="10" cy="16" r="2.4" {...ink} />
          <rect x="15" y="14.7" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="34" y="15" width="7" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "panel" && (
        <>
          <rect className="body" data-shape="card" x="7" y="2" width="34" height="28" rx="4" {...box} />
          <circle cx="13" cy="8" r="2.2" {...ink} />
          <rect x="17.5" y="6.7" width="14" height="2.6" rx="1.3" {...ink} />
          <rect x="11" y="13" width="26" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5} />
          <rect x="11" y="21" width="26" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5} />
        </>
      )}
      {form === "group" && (
        <>
          <rect className="body" data-shape="group" x="2" y="2" width="44" height="28" rx="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
          <rect x="7" y="5.5" width="12" height="2.4" rx="1.2" {...ink} />
          <rect x="7" y="12" width="15" height="13" rx="2.5" {...box} />
          <rect x="26" y="12" width="15" height="13" rx="2.5" {...box} />
        </>
      )}
    </svg>
  );
}
