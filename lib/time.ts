/**
 * Dates are stored as ISO 8601 UTC and always displayed in Europe/London.
 * Passing the time zone explicitly means server and browser render the same
 * text, so there is no hydration mismatch.
 */
export const DISPLAY_TIME_ZONE = "Europe/London";

const formatters = new Map<string, Intl.DateTimeFormat>();

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, ...options });
    formatters.set(key, f);
  }
  return f;
}

function parts(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return {};
  return Object.fromEntries(fmt(options).formatToParts(date).map((p) => [p.type, p.value]));
}

/** "Thursday 9 October 2026" */
export function formatDayHeading(iso: string): string {
  const p = parts(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return p.weekday ? `${p.weekday} ${p.day} ${p.month} ${p.year}` : iso;
}

/** "15:32" */
export function formatTime(iso: string): string {
  const p = parts(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return p.hour ? `${p.hour}:${p.minute}` : "";
}

/** "9 Oct 2026" */
export function formatShortDate(iso: string): string {
  const p = parts(iso, { day: "numeric", month: "short", year: "numeric" });
  return p.day ? `${p.day} ${p.month} ${p.year}` : "";
}

/** "2026-10-09" in London time; groups journal entries by day. */
export function londonDateKey(iso: string): string {
  const p = parts(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
  return p.year ? `${p.year}-${p.month}-${p.day}` : "";
}

/**
 * The UTC instant at which a London calendar day starts, e.g. for jumping
 * to a date chosen in a date picker. `day` is "YYYY-MM-DD".
 */
export function londonDayStartUtc(day: string): string | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // London is UTC+0 or UTC+1; try both and keep the one that maps to midnight.
  for (const offset of [0, 1]) {
    const candidate = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], -offset));
    const iso = candidate.toISOString();
    if (londonDateKey(iso) === day && formatTime(iso) === "00:00") {
      return iso.replace(/\.\d{3}Z$/, "Z");
    }
  }
  return null;
}
