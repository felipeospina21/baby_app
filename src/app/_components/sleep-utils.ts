/** Derived metrics + formatting for night-sleep sessions and their splits. */

import type { SplitInterval } from "./active-session-store";

export interface SleepMetrics {
  /** Total session span (end - start), ms. */
  totalMs: number;
  /** Number of wake-up intervals. */
  wakeCount: number;
  /** Sum of wake-interval durations (closed intervals only), ms. */
  awakeMs: number;
  /** totalMs - awakeMs, ms. */
  asleepMs: number;
  /** True if a wake interval is currently open (baby awake now). */
  awakeNow: boolean;
}

/** Compute sleep metrics from the session span and its splits. */
export function sleepMetrics(
  startMs: number,
  endMs: number,
  splits: SplitInterval[],
): SleepMetrics {
  const totalMs = Math.max(0, endMs - startMs);
  let awakeMs = 0;
  let awakeNow = false;
  for (const s of splits) {
    if (s.endMs === null) {
      awakeNow = true;
      // Count the currently-open wake up to `endMs` (usually "now").
      awakeMs += Math.max(0, endMs - s.startMs);
    } else {
      awakeMs += Math.max(0, s.endMs - s.startMs);
    }
  }
  awakeMs = Math.min(awakeMs, totalMs);
  return {
    totalMs,
    wakeCount: splits.length,
    awakeMs,
    asleepMs: Math.max(0, totalMs - awakeMs),
    awakeNow,
  };
}
