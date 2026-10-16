"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";
import {
  formatDay,
  formatDuration,
  formatTime,
  isOnLocalDay,
  toDateInputValue,
  toDateTimeLocal,
} from "./nap-utils";
import { useNapSync } from "./use-nap-sync";

/** A unified row for the grid, from either the server or the local outbox. */
interface Row {
  key: string;
  id: number | null; // server id, or null while pending
  startTime: Date;
  endTime: Date;
  note: string | null;
  pending: boolean;
}

export function NapHistory() {
  const utils = api.useUtils();

  // Mount the sync engine here so the outbox flushes while this view is shown.
  const { pending, online, pendingCount } = useNapSync();

  // Offline-tolerant: a plain query (not suspense) so a failed fetch while
  // offline still renders the local/pending naps instead of crashing. Fetch a
  // larger window than we display so the date filter has history to work with.
  const historyQuery = api.nap.getHistory.useQuery(
    { limit: 100 },
    { retry: false },
  );

  const refresh = async () => {
    await utils.nap.getHistory.invalidate();
  };

  const update = api.nap.update.useMutation({ onSuccess: refresh });
  const remove = api.nap.delete.useMutation({ onSuccess: refresh });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  // Date filter. Defaults to today (local). An empty string means "all dates".
  // Resolve "today" after mount to avoid any SSR/client timezone or midnight
  // boundary hydration mismatch on the date input.
  const [filterDay, setFilterDay] = useState<string>("");
  const [today, setToday] = useState<string>("");
  useEffect(() => {
    const t = toDateInputValue(new Date());
    setToday(t);
    setFilterDay(t);
  }, []);

  // Build the merged, de-duplicated, newest-first list.
  const serverRows: Row[] = (historyQuery.data ?? []).map((nap) => ({
    key: `s-${nap.id}`,
    id: nap.id,
    startTime: new Date(nap.startTime),
    endTime: new Date(nap.endTime ?? nap.startTime),
    note: nap.note,
    pending: false,
  }));

  // Only show outbox naps that haven't synced yet (synced ones appear from the
  // server query once it refetches).
  const pendingRows: Row[] = pending
    .filter((n) => !n.synced)
    .map((n) => ({
      key: `p-${n.clientId}`,
      id: null,
      startTime: new Date(n.startTime),
      endTime: new Date(n.endTime),
      note: n.note ?? null,
      pending: true,
    }));

  const rows = [...pendingRows, ...serverRows].sort(
    (a, b) => b.startTime.getTime() - a.startTime.getTime(),
  );

  // Apply the date filter (by the nap's local start day). Empty filter => all.
  const visibleRows = useMemo(
    () =>
      filterDay
        ? rows.filter((r) => isOnLocalDay(r.startTime, filterDay))
        : rows,
    [rows, filterDay],
  );

  const beginEdit = (row: Row) => {
    if (row.id === null) return; // pending rows aren't editable until synced
    setEditingId(row.id);
    setStartDraft(toDateTimeLocal(row.startTime));
    setEndDraft(toDateTimeLocal(row.endTime));
    setNoteDraft(row.note ?? "");
  };

  const saveEdit = (id: number) => {
    if (!startDraft || !endDraft) return;
    update.mutate({
      id,
      startTime: new Date(startDraft),
      endTime: new Date(endDraft),
      note: noteDraft.trim() ? noteDraft.trim() : null,
    });
    setEditingId(null);
  };

  return (
    <section className="w-full max-w-md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white/80">Latest naps</h2>
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

      {/* Date filter — defaults to today; clear to show all dates. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="date"
          value={filterDay}
          max={today}
          onChange={(e) => setFilterDay(e.target.value)}
          aria-label="Filter naps by date"
          className="rounded-md bg-white/10 px-2 py-1 text-white"
        />
        <button
          onClick={() => setFilterDay(today)}
          disabled={filterDay === today}
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          Today
        </button>
        <button
          onClick={() => setFilterDay("")}
          disabled={filterDay === ""}
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          All dates
        </button>
        {filterDay !== "" && (
          <span className="ml-auto text-xs text-white/40">
            {visibleRows.length} nap{visibleRows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {visibleRows.length === 0 ? (
        <p className="text-center text-white/60">
          {rows.length === 0
            ? "No naps recorded yet. Start the timer above to log one."
            : filterDay === today
              ? "No naps recorded for today yet."
              : "No naps on this date."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full border-collapse text-left text-sm text-white/90">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                <th className="px-3 py-2 font-medium">Start</th>
                <th className="px-3 py-2 font-medium">End</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const durationMs =
                  row.endTime.getTime() - row.startTime.getTime();
                const isEditing = row.id !== null && editingId === row.id;

                if (isEditing) {
                  return (
                    <tr
                      key={row.key}
                      className="border-t border-white/10 bg-white/5"
                    >
                      <td colSpan={5} className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center justify-between gap-2 text-xs text-white/60">
                            Start
                            <input
                              type="datetime-local"
                              value={startDraft}
                              onChange={(e) => setStartDraft(e.target.value)}
                              className="rounded-md bg-white/10 px-2 py-1 text-white"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-2 text-xs text-white/60">
                            End
                            <input
                              type="datetime-local"
                              value={endDraft}
                              onChange={(e) => setEndDraft(e.target.value)}
                              className="rounded-md bg-white/10 px-2 py-1 text-white"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-2 text-xs text-white/60">
                            Note
                            <input
                              type="text"
                              value={noteDraft}
                              maxLength={256}
                              placeholder="optional"
                              onChange={(e) => setNoteDraft(e.target.value)}
                              className="w-40 rounded-md bg-white/10 px-2 py-1 text-white"
                            />
                          </label>
                          <div className="mt-1 flex justify-end gap-2">
                            <button
                              onClick={() => saveEdit(row.id!)}
                              disabled={update.isPending || !startDraft || !endDraft}
                              className="rounded-md bg-emerald-500/80 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={row.key} className="border-t border-white/10">
                    <td className="px-3 py-2">{formatDay(row.startTime)}</td>
                    <td className="px-3 py-2">{formatTime(row.startTime)}</td>
                    <td className="px-3 py-2">{formatTime(row.endTime)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDuration(durationMs)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.pending ? (
                        <span className="text-xs text-sky-300/80">pending</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => beginEdit(row)}
                            className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("Delete this nap?") && row.id !== null)
                                remove.mutate({ id: row.id });
                            }}
                            className="text-xs text-rose-300 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
