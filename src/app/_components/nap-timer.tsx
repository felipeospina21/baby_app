"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration, toDateTimeLocal } from "./nap-utils";
import { enqueueNap } from "./use-nap-sync";

const STORAGE_KEY = "baby_app.activeNapStart";

/** Read the persisted start time (ms) from localStorage, if a nap is running. */
function readStoredStart(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function NapTimer() {
  // The running nap's start time (ms since epoch), or null when idle.
  // Persisted in localStorage so a refresh / phone-lock recovers it.
  const [startMs, setStartMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setStartMs(readStoredStart());
  }, []);

  // Tick every second while a nap is running.
  useEffect(() => {
    if (startMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);

  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const startInputRef = useRef<HTMLInputElement>(null);

  const isActive = startMs !== null;
  const elapsedMs = startMs !== null ? now - startMs : 0;

  const persistStart = (ms: number | null) => {
    setStartMs(ms);
    if (typeof window === "undefined") return;
    if (ms === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(ms));
  };

  const startNap = () => {
    persistStart(Date.now());
    setNow(Date.now());
  };

  const stopNap = () => {
    if (startMs === null) return;
    const start = new Date(startMs);
    const end = new Date();
    persistStart(null);
    setEditingStart(false);
    // Local-first: queue the completed nap. The sync engine persists it to the
    // server now (if online) or later (on reconnect). Works fully offline.
    enqueueNap({
      clientId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: null,
    });
  };

  const beginEditStart = () => {
    if (startMs === null) return;
    setStartDraft(toDateTimeLocal(new Date(startMs)));
    setEditingStart(true);
    requestAnimationFrame(() => startInputRef.current?.focus());
  };

  const saveStart = () => {
    if (startMs === null || !startDraft) {
      setEditingStart(false);
      return;
    }
    const edited = new Date(startDraft).getTime();
    if (Number.isFinite(edited)) {
      persistStart(edited);
      setNow(Date.now());
    }
    setEditingStart(false);
  };

  return (
    <section className="w-full max-w-md rounded-2xl bg-white/10 p-6 shadow-lg backdrop-blur">
      <div className="flex flex-col items-center gap-5">
        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-white/60">
            {isActive ? "Nap in progress" : "No nap running"}
          </p>
          <p
            className="mt-2 font-mono text-5xl font-bold tabular-nums text-white"
            aria-live="polite"
          >
            {isActive ? formatDuration(elapsedMs) : "0s"}
          </p>
        </div>

        {isActive && startMs !== null && (
          <div className="flex flex-col items-center gap-1 text-sm text-white/70">
            {editingStart ? (
              <div className="flex items-center gap-2">
                <input
                  ref={startInputRef}
                  type="datetime-local"
                  value={startDraft}
                  onChange={(e) => setStartDraft(e.target.value)}
                  className="rounded-md bg-white/10 px-2 py-1 text-white"
                />
                <button
                  onClick={saveStart}
                  className="rounded-md bg-emerald-500/80 px-3 py-1 font-medium text-white hover:bg-emerald-500"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingStart(false)}
                  className="rounded-md bg-white/10 px-3 py-1 text-white hover:bg-white/20"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={beginEditStart}
                className="underline decoration-dotted underline-offset-4 hover:text-white"
                title="Edit start time"
              >
                Started{" "}
                {new Date(startMs).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                — tap to adjust
              </button>
            )}
          </div>
        )}

        {isActive ? (
          <button
            onClick={stopNap}
            className="w-full rounded-full bg-rose-500 px-8 py-4 text-lg font-semibold text-white transition hover:bg-rose-600"
          >
            Stop nap
          </button>
        ) : (
          <button
            onClick={startNap}
            className="w-full rounded-full bg-emerald-500 px-8 py-4 text-lg font-semibold text-white transition hover:bg-emerald-600"
          >
            Start nap
          </button>
        )}
      </div>
    </section>
  );
}
