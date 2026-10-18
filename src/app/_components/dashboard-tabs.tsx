"use client";

/**
 * Tabbed container for the analytics dashboard, switching between the Nights
 * and Naps views. Both child dashboards run their own queries (the prefetch on
 * the page warms both caches), so switching tabs is instant.
 */

import { useState } from "react";

import { NapDashboard } from "./nap-dashboard";
import { SleepDashboard } from "./sleep-dashboard";

type Tab = "nights" | "naps";

export function DashboardTabs({ initialTab = "nights" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: { id: Tab; label: string }[] = [
    { id: "nights", label: "Nights" },
    { id: "naps", label: "Naps" },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <nav
        className="flex w-full gap-1 rounded-full bg-white/5 p-1 text-sm"
        role="tablist"
        aria-label="Dashboard view"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-4 py-2 text-center font-medium transition ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "nights" ? <SleepDashboard /> : <NapDashboard />}
    </div>
  );
}
