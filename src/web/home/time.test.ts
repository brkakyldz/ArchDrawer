import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

describe("relativeTime", () => {
  const now = at(2026, 10, 27, 15, 30);

  it("counts minutes and hours under a day", () => {
    expect(relativeTime(ago(now, 20_000), now)).toBe("just now");
    expect(relativeTime(ago(now, -5_000), now)).toBe("just now"); // a clock a little ahead
    expect(relativeTime(ago(now, 60_000), now)).toBe("1 min ago");
    expect(relativeTime(ago(now, 59 * 60_000), now)).toBe("59 min ago");
    expect(relativeTime(ago(now, 60 * 60_000), now)).toBe("1 h ago");
    expect(relativeTime(ago(now, 23.9 * 3_600_000), now)).toBe("23 h ago");
  });

  it("reads the local calendar from a day on", () => {
    expect(relativeTime(at(2026, 10, 26, 9).toISOString(), now)).toBe("Yesterday");
    expect(relativeTime(at(2026, 10, 25, 23).toISOString(), now)).toBe("2 days ago");
    expect(relativeTime(at(2026, 10, 21, 8).toISOString(), now)).toBe("6 days ago");
    expect(relativeTime(at(2026, 10, 20, 8).toISOString(), now)).toBe("20 Oct");
    expect(relativeTime(at(2026, 1, 3).toISOString(), now)).toBe("3 Jan");
    expect(relativeTime(at(2025, 12, 31).toISOString(), now)).toBe("31 Dec 2025");
  });

  it("is empty for no time or a broken one", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
  });
});
