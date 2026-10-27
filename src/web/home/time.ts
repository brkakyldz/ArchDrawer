/**
 * The home screen's times (ui contract, Home, *Times*). A relative time reads the first that fits: `just now`
 * under a minute, `<n> min ago` under an hour, `<n> h ago` under a day, `Yesterday` on the day before in the
 * local calendar, `<n> days ago` up to six days, then `26 Oct` within the year and `26 Oct 2025` before.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Whole local calendar days from `a` to `b`. */
function calendarDays(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / DAY);
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const ago = now.getTime() - at.getTime();
  if (ago < MIN) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MIN)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  const days = calendarDays(at, now);
  if (days <= 1) return "Yesterday";
  if (days <= 6) return `${days} days ago`;
  const text = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? text : `${text} ${at.getFullYear()}`;
}

/**
 * The server's clock as the page knows it: the page's own clock plus the difference between `now` of the
 * latest `GET /api/activity` and the moment that answer arrived (zero until one arrived).
 */
let skew = 0;
export function setServerNow(serverNow: string, arrived = Date.now()): void {
  const t = new Date(serverNow).getTime();
  if (!Number.isNaN(t)) skew = t - arrived;
}
export const serverNow = (): Date => new Date(Date.now() + skew);
