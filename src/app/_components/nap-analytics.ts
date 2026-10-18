/**
 * Per-day nap analytics derived from the `nap.getHistory` output, for the
 * dashboard charts. Naps have no splits — each is just a start/end — but
 * several happen per day, so the natural unit of analysis is the *local day*.
 *
 * Keeps all aggregation/duration math in one place so the charts stay pure
 * presentation.
 */

import { toDateInputValue } from "./nap-utils";
import type { RouterOutputs } from "~/trpc/react";

/** One nap as returned by the API. */
type Nap = RouterOutputs["nap"]["getHistory"][number];

/** A single nap reduced to the fields the charts/timeline need. */
export interface NapEntry {
  id: number;
  start: Date;
  end: Date;
  durationMs: number;
}

export interface NapDayPoint {
  /** Local `YYYY-MM-DD` key for the day. */
  day: string;
  /** Midday Date for the day, for axis labels. */
  date: Date;
  /** The day's naps, ordered by start time. */
  naps: NapEntry[];
  /** Sum of nap durations that day, ms. */
  totalMs: number;
  /** Number of naps that day. */
  napCount: number;
  /** Average nap duration that day, ms (0 when no naps). */
  avgMs: number;
  /**
   * Average awake gap *between* consecutive naps that day, ms — from one nap's
   * end to the next nap's start. Requires ≥2 naps; 0 otherwise (no gap to
   * measure). With N naps there are N-1 gaps.
   */
  avgBetweenMs: number;
}

const nonNeg = (ms: number) => (ms > 0 ? ms : 0);

/** Parse a `YYYY-MM-DD` key into a local midday Date (stable for labels). */
function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Shift a `YYYY-MM-DD` key by `delta` days (local). */
function addDays(day: string, delta: number): string {
  const base = dayToDate(day);
  base.setDate(base.getDate() + delta);
  return toDateInputValue(base);
}

/**
 * Build per-day nap points for the trailing `windowDays` ending today (local).
 * Every day in the window is represented — days with no naps produce an empty
 * point so gaps are visible in the charts. Days read left-to-right
 * oldest-to-newest.
 */
export function toNapDayPoints(naps: Nap[], windowDays = 14): NapDayPoint[] {
  // Finished naps only; an unfinished nap has no duration.
  const entries: NapEntry[] = naps
    .filter((n) => n.endTime != null)
    .map((n) => {
      const start = new Date(n.startTime);
      const end = new Date(n.endTime!);
      return {
        id: n.id,
        start,
        end,
        durationMs: nonNeg(end.getTime() - start.getTime()),
      };
    });

  // Bucket naps by their local start day.
  const byDay = new Map<string, NapEntry[]>();
  for (const e of entries) {
    const key = toDateInputValue(e.start);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }

  // Materialize a contiguous window ending today so empty days still show.
  const today = toDateInputValue(new Date());
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) days.push(addDays(today, -i));

  return days.map((day) => {
    const dayNaps = (byDay.get(day) ?? []).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    const totalMs = dayNaps.reduce((sum, n) => sum + n.durationMs, 0);
    const napCount = dayNaps.length;

    // Awake gaps between consecutive naps (end[i] -> start[i+1]).
    let betweenSum = 0;
    for (let i = 1; i < dayNaps.length; i++) {
      betweenSum += nonNeg(
        dayNaps[i]!.start.getTime() - dayNaps[i - 1]!.end.getTime(),
      );
    }
    const gapCount = Math.max(0, napCount - 1);

    return {
      day,
      date: dayToDate(day),
      naps: dayNaps,
      totalMs,
      napCount,
      avgMs: napCount > 0 ? totalMs / napCount : 0,
      avgBetweenMs: gapCount > 0 ? betweenSum / gapCount : 0,
    };
  });
}

/** Short weekday+day label for axes, e.g. "Mon 14". */
export function formatDayShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
  });
}
