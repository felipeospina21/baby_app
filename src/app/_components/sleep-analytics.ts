/**
 * Per-night analytics derived from the `sleep.getHistory` output, for the
 * dashboard charts. Keeps all duration math in one place so the charts stay
 * pure presentation.
 *
 * "Time between awakes" is modelled as the set of *asleep stretches* within a
 * night: the gap from the session start to the first wake, each gap between a
 * wake's end and the next wake's start, and the gap from the last wake's end to
 * the session end. A night with N wakes therefore has N+1 asleep stretches
 * (and a night with 0 wakes has a single stretch equal to the whole night).
 */

import type { RouterOutputs } from "~/trpc/react";

/** One night-sleep session with its wake-up splits, as returned by the API. */
type SleepSession = RouterOutputs["sleep"]["getHistory"][number];

export interface NightPoint {
  /** Session id (stable key for chart elements). */
  id: number;
  /** Session start, used for ordering and axis labels. */
  start: Date;
  /** Total night span (end - start), ms. */
  totalMs: number;
  /** Time asleep = total - awake, ms. */
  asleepMs: number;
  /** Sum of closed wake-interval durations, ms. */
  awakeMs: number;
  /** Number of wake-ups (splits) that night. */
  wakeCount: number;
  /**
   * Average asleep stretch between state changes, ms. Averaged over the N+1
   * asleep stretches described in the file header. 0 when the night has no
   * measurable span.
   */
  avgBetweenAwakesMs: number;
}

/** Clamp to a non-negative number (guards against inverted timestamps). */
const nonNeg = (ms: number) => (ms > 0 ? ms : 0);

/** Derive the chart data point for a single night. */
export function nightPoint(session: SleepSession): NightPoint {
  const start = new Date(session.startTime);
  const end = new Date(session.endTime ?? session.startTime);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const totalMs = nonNeg(endMs - startMs);

  // Wake intervals sorted by start; an open split is treated as closing at the
  // session end so historical (completed) sessions still produce sane numbers.
  const wakes = [...session.splits]
    .map((s) => ({
      startMs: new Date(s.startTime).getTime(),
      endMs: s.endTime ? new Date(s.endTime).getTime() : endMs,
    }))
    .sort((a, b) => a.startMs - b.startMs);

  let awakeMs = 0;
  for (const w of wakes) awakeMs += nonNeg(w.endMs - w.startMs);
  awakeMs = Math.min(awakeMs, totalMs);

  // Asleep stretches: start -> first wake, between wakes, last wake -> end.
  const stretches: number[] = [];
  let cursor = startMs;
  for (const w of wakes) {
    stretches.push(nonNeg(w.startMs - cursor));
    cursor = w.endMs;
  }
  stretches.push(nonNeg(endMs - cursor));

  const avgBetweenAwakesMs =
    stretches.length > 0
      ? stretches.reduce((sum, s) => sum + s, 0) / stretches.length
      : 0;

  return {
    id: session.id,
    start,
    totalMs,
    asleepMs: nonNeg(totalMs - awakeMs),
    awakeMs,
    wakeCount: session.splits.length,
    avgBetweenAwakesMs,
  };
}

/**
 * Build chart data from the history list. The API returns sessions newest
 * first; charts read left-to-right oldest-to-newest, so we reverse. Sessions
 * still running (no endTime) are skipped — an unfinished night has no total.
 */
export function toNightPoints(sessions: SleepSession[]): NightPoint[] {
  return sessions
    .filter((s) => s.endTime != null)
    .map(nightPoint)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
