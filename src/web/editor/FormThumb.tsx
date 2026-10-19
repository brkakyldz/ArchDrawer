import type { Form } from "../../core/model";

/** A small picture of a form (ui contract `form-thumb`): what a card, compact, panel or group looks like. */
export function FormThumb({ form }: { form: Form }) {
  const box = { fill: "var(--surface)", stroke: "currentColor", strokeWidth: 1.2 } as const;
  const ink = { fill: "currentColor", opacity: 0.55 } as const;
  return (
    <svg className="form-thumb" data-testid="form-thumb" viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
      {form === "card" && (
        <>
          <rect x="9" y="3" width="30" height="26" rx="4" {...box} />
          <circle cx="24" cy="11" r="3" {...ink} />
          <rect x="16" y="17" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="18.5" y="22" width="11" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "compact" && (
        <>
          <rect x="3" y="10" width="42" height="12" rx="4" {...box} />
          <circle cx="10" cy="16" r="2.4" {...ink} />
          <rect x="15" y="14.7" width="16" height="2.6" rx="1.3" {...ink} />
          <rect x="34" y="15" width="7" height="2" rx="1" {...ink} opacity={0.3} />
        </>
      )}
      {form === "panel" && (
        <>
          <rect x="7" y="2" width="34" height="28" rx="4" {...box} />
          <circle cx="13" cy="8" r="2.2" {...ink} />
          <rect x="17.5" y="6.7" width="14" height="2.6" rx="1.3" {...ink} />
          <rect x="11" y="13" width="26" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5} />
          <rect x="11" y="21" width="26" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5} />
        </>
      )}
      {form === "group" && (
        <>
          <rect x="2" y="2" width="44" height="28" rx="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
          <rect x="7" y="5.5" width="12" height="2.4" rx="1.2" {...ink} />
          <rect x="7" y="12" width="15" height="13" rx="2.5" {...box} />
          <rect x="26" y="12" width="15" height="13" rx="2.5" {...box} />
        </>
      )}
    </svg>
  );
}
