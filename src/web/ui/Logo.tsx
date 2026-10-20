/** The archdrawer mark: an arch whose left leg breaks into the crossbar of an "a". Filled, so it stays crisp at 16 px. */
const MARK_PATHS = "M0 11A11 11 0 0 1 11 0h2a11 11 0 0 1 11 11v13h-6V11a5 5 0 0 0-5-5h-2a5 5 0 0 0-5 5zM0 13.5h15.5v5H6V24H0z";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={MARK_PATHS} fill="currentColor" />
    </svg>
  );
}

/** Mark and wordmark. The wordmark is lower case, as the product name is written everywhere. */
export function Logo({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="brand">
      <Mark size={size} />
      {wordmark && <span className="brand-word">archdrawer</span>}
    </span>
  );
}
