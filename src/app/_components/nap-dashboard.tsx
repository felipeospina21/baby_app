"use client";

/**
 * Client-side container for the nap dashboard: fetches nap history, aggregates
 * it per local day over a selectable trailing window, and renders the nap
 * charts + timeline. Mirrors the query used by `NapHistory` so the prefetched
 * cache is reused.
 */

import { useState } from "react";

import { api } from "~/trpc/react";
import {
  NapAvgChart,
  NapBetweenChart,
  NapTimeline,
  NapTotalsChart,
} from "./nap-charts";
import { toNapDayPoints } from "./nap-analytics";

const WINDOWS = [7, 14, 30] as const;
type Window = (typeof WINDOWS)[number];

export function NapDashboard() {
  const [windowDays, setWindowDays] = useState<Window>(7);

  const historyQuery = api.nap.getHistory.useQuery(
    { limit: 100 },
    { retry: false },
  );

  const points = toNapDayPoints(historyQuery.data ?? [], windowDays);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Trailing-window selector. */}
      <div className="flex w-full items-center justify-end gap-2 text-xs">
        <span className="text-white/50">Last</span>
        <div className="flex gap-1 rounded-full bg-white/5 p-1">
          {WINDOWS.map((w) => {
            const active = windowDays === w;
            return (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {w}d
              </button>
            );
          })}
        </div>
      </div>

      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          Total nap time per day
        </h2>
        <NapTotalsChart data={points} />
      </section>

      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          Average nap length &amp; count per day
        </h2>
        <NapAvgChart data={points} />
      </section>

      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          Average time between naps per day
        </h2>
        <NapBetweenChart data={points} />
      </section>

      <section className="w-full rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
        <h2 className="mb-3 text-base font-semibold text-white/80">
          When naps happen
        </h2>
        <NapTimeline data={points} />
      </section>

      {historyQuery.isLoading && (
        <p className="text-center text-sm text-white/50">Loading…</p>
      )}
    </div>
  );
}
