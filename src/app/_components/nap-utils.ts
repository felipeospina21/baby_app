/** Formatting helpers for nap times and durations. */

/** Format a millisecond duration as "1h 23m 45s" (omitting zero leading units). */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Format a millisecond duration as a short "time ago" label, e.g.
 * "1h 23m ago" or "45s ago". Keeps at most the two most-significant units.
 */
export function formatAgo(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  // Only show seconds when under an hour, to keep the label short.
  if (h === 0) parts.push(`${s}s`);

  return `${parts.join(" ")} ago`;
}

/** Convert a Date to the value expected by <input type="datetime-local">. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Human-friendly date label, e.g. "Oct 14". */
export function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human-friendly time label, e.g. "2:36 PM". */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
