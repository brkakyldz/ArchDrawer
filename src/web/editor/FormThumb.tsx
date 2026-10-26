import { shapeGeometry, shapeOf, type PartShape } from "../../core/shapes";
import type { Form, Kind } from "../../core/model";

/**
 * A small picture of a form (ui contract `form-thumb`): what a card, compact, panel or group looks like, a card,
 * compact or panel drawn in the outline of the kind (diagram contract, Geometry, Shapes) — the drawing's own outline,
 * scaled down; without a `kind`, the plain card.
 */
export function FormThumb({ form, kind }: { form: Form; kind?: Kind }) {
  const shape = shapeOf({ form, kind: kind ?? "service" });
  const box = { fill: "var(--surface)", stroke: "currentColor" } as const;
  const ink = { fill: "currentColor", opacity: 0.55 } as const;
  // The outline at its drawn size in a virtual box, scaled into the thumb.
  const outline = (x: number, y: number, w: number, h: number, compact: boolean) => {
    const k = 0.15, g = shapeGeometry(shape as PartShape, compact, false, { x: 0, y: 0, w: w / k, h: h / k });
    return (
      <g transform={`translate(${x} ${y}) scale(${k})`}>
        {g.back.map((d) => <path key={d} d={d} {...box} strokeWidth={1.2 / k} opacity={0.6} />)}
        <path className="body" data-shape={shape} d={g.d} {...box} strokeWidth={1.2 / k} strokeLinejoin="round" strokeDasharray={shape === "external" ? `${2.5 / k} ${1.8 / k}` : undefined} />
      </g>
    );
  };
  return (
    <svg className="form-thumb" data-testid="form-thumb" data-shape={shape} viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
      {form === "card" && (
        <>
          {outline(9, 3, 30, 26, false)}
          <circle cx="24" cy="11" r="3" {...ink} />
          <rect x="16" y="17" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="18.5" y="22" width="11" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "compact" && (
        <>
          {outline(3, 9, 42, 14, true)}
          <circle cx="10" cy="16" r="2.4" {...ink} />
          <rect x="15" y="14.7" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="34" y="15" width="7" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "panel" && (
        <>
          {/* A panel is drawn as a card of its kind; the stacked lines say it holds rows, listed in its callout. */}
          {outline(9, 3, 30, 26, false)}
          <circle cx="24" cy="10" r="2.6" {...ink} />
          <rect x="16" y="15" width="16" height="2.4" rx="1.2" {...ink} />
          <rect x="17" y="20" width="14" height="1.6" rx="0.8" {...ink} opacity={0.35} />
          <rect x="17" y="23" width="14" height="1.6" rx="0.8" {...ink} opacity={0.35} />
        </>
      )}
      {form === "group" && (
        <>
          <rect className="body" data-shape="group" x="2" y="2" width="44" height="28" rx="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
          <rect x="7" y="5.5" width="12" height="2.4" rx="1.2" {...ink} />
          <rect x="7" y="12" width="15" height="13" rx="2.5" {...box} strokeWidth={1.2} />
          <rect x="26" y="12" width="15" height="13" rx="2.5" {...box} strokeWidth={1.2} />
        </>
      )}
    </svg>
  );
}
