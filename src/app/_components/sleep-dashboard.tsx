"use client";

/**
 * Client-side container for the night-sleep dashboard: fetches the session
 * history, derives per-night points, and renders the SVG charts. Mirrors the
 * query used by `SleepHistory` so the prefetched cache is reused.
 */

import { api } from "~/trpc/react";
import { NightAwakesChart, NightDurationChart } from "./sleep-charts";
import { toNightPoints } from "./sleep-analytics";

export function SleepDashboard() {
  const historyQuery = api.sleep.getHistory.useQuery(
    { limit: 30 },
    { retry: false },
  );

  const points = toNightPoints(historyQuery.data ?? []);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          Sleep time &amp; wake-ups per night
        </h2>
        <NightDurationChart data={points} />
      </section>

      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          Time between awakes &amp; total awakes per night
        </h2>
        <NightAwakesChart data={points} />
      </section>

      {historyQuery.isLoading && (
        <p className="text-center text-sm text-white/50">Loading…</p>
      )}
    </div>
  );
}
