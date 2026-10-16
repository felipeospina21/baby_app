"use client";

import { useState } from "react";
import { Fragment } from "react";

import { api } from "~/trpc/react";
import { formatDay, formatDuration, formatTime } from "./nap-utils";
import { useSleepSync } from "./use-sleep-sync";

/** Count a session's wake-ups and total asleep time from its splits. */
function summarize(
  startTime: Date,
  endTime: Date,
  splits: { startTime: string | Date; endTime: string | Date | null }[],
) {
  const totalMs = endTime.getTime() - startTime.getTime();
  let awakeMs = 0;
  for (const s of splits) {
    const start = new Date(s.startTime).getTime();
    const end = s.endTime ? new Date(s.endTime).getTime() : endTime.getTime();
    awakeMs += Math.max(0, end - start);
  }
  awakeMs = Math.min(awakeMs, totalMs);
  return {
    wakeCount: splits.length,
    totalMs,
    asleepMs: Math.max(0, totalMs - awakeMs),
  };
}

export function SleepHistory() {
  const utils = api.useUtils();

  // Mount the sync engine so the outbox flushes while this view is shown.
  const { pending, online, pendingCount } = useSleepSync();

  const historyQuery = api.sleep.getHistory.useQuery(
    { limit: 30 },
    { retry: false },
  );

  const remove = api.sleep.delete.useMutation({
    onSuccess: async () => {
      await utils.sleep.getHistory.invalidate();
    },
  });

  const [expanded, setExpanded] = useState<number | null>(null);

  const serverSessions = historyQuery.data ?? [];

  return (
    <section className="w-full max-w-md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white/80">Latest nights</h2>
        <div className="flex items-center gap-2 text-xs">
          {!online && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
              Offline
            </span>
          )}
          {pendingCount > 0 && (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-sky-300">
              {pendingCount} pending sync
            </span>
          )}
        </div>
      </div>

      {/* Pending (unsynced) sessions captured locally. */}
      {pending
        .filter((p) => !p.synced)
        .map((p) => {
          const start = new Date(p.startTime);
          const end = new Date(p.endTime);
          const s = summarize(start, end, p.splits);
          return (
            <div
              key={`p-${p.clientId}`}
              className="mb-2 rounded-xl border border-sky-400/20 bg-sky-500/5 p-3 text-sm text-white/80"
            >
              <div className="flex items-center justify-between">
                <span>
                  {formatDay(start)} · {formatTime(start)} – {formatTime(end)}
                </span>
                <span className="text-xs text-sky-300/80">pending</span>
              </div>
              <div className="mt-1 text-xs text-white/50">
                {formatDuration(s.totalMs)} · {s.wakeCount} wake-up
                {s.wakeCount === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}

      {serverSessions.length === 0 && pending.length === 0 ? (
        <p className="text-center text-white/60">
          No sleep sessions recorded yet. Start the timer above to log one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full border-collapse text-left text-sm text-white/90">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="px-3 py-2 font-medium">Night</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Wake-ups</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {serverSessions.map((session) => {
                const start = new Date(session.startTime);
                const end = new Date(session.endTime ?? session.startTime);
                const s = summarize(start, end, session.splits);
                const isOpen = expanded === session.id;
                return (
                  <Fragment key={session.id}>
                    <tr className="border-t border-white/10">
                      <td className="px-3 py-2">
                        {formatDay(start)}
                        <span className="block text-xs text-white/40">
                          {formatTime(start)} – {formatTime(end)}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDuration(s.totalMs)}
                        <span className="block text-xs text-white/40">
                          {formatDuration(s.asleepMs)} asleep
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{s.wakeCount}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {session.splits.length > 0 && (
                            <button
                              onClick={() =>
                                setExpanded(isOpen ? null : session.id)
                              }
                              className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
                            >
                              {isOpen ? "Hide" : "Details"}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (confirm("Delete this sleep session?"))
                                remove.mutate({ id: session.id });
                            }}
                            className="text-xs text-rose-300 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr
                        key={`${session.id}-detail`}
                        className="border-t border-white/5 bg-white/5"
                      >
                        <td colSpan={4} className="px-3 py-2">
                          <ul className="flex flex-col gap-1 text-xs text-white/70">
                            {session.splits.map((split, i) => {
                              const ss = new Date(split.startTime);
                              const se = split.endTime
                                ? new Date(split.endTime)
                                : null;
                              return (
                                <li
                                  key={split.id}
                                  className="flex justify-between"
                                >
                                  <span>
                                    Wake #{i + 1} · {formatTime(ss)}
                                  </span>
                                  <span className="tabular-nums text-white/50">
                                    {se
                                      ? formatDuration(
                                          se.getTime() - ss.getTime(),
                                        )
                                      : "—"}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
