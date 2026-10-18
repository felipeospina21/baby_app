"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearActiveSession,
  getActiveSession,
  migrateLegacyNapOutbox,
  newClientId,
  setActiveSession,
  toggleSplit,
  type SplitInterval,
} from "./active-session-store";
import { LockScreenPrompt } from "./lock-screen-prompt";
import { formatDuration, formatTime } from "./nap-utils";
import { sleepMetrics } from "./sleep-utils";
import { enqueueSleep } from "./use-sleep-sync";
import { useLockScreen, type SwSessionMessage } from "./use-lock-screen";

/**
 * Night-sleep timer. Unlike naps, the clock is meant to run all night and is
 * only ever stopped from inside the app. Wake-ups are recorded as "splits"
 * (paired intervals) without stopping the clock, and can also be marked from
 * the lock screen (the SW appends them to the same IndexedDB session).
 */
export function SleepTimer() {
  // Running session state (null when idle), hydrated from IndexedDB.
  const [startMs, setStartMs] = useState<number | null>(null);
  const [splits, setSplits] = useState<SplitInterval[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const clientIdRef = useRef<string | null>(null);

  const isActive = startMs !== null;

  // Re-read the active session from IndexedDB (shared with the service worker).
  const reload = useCallback(async () => {
    const active = await getActiveSession();
    if (active?.kind === "sleep") {
      setStartMs(active.startMs);
      setSplits(active.splits);
      setNote(active.note);
      clientIdRef.current = active.clientId;
    } else {
      setStartMs(null);
      setSplits([]);
      setNote(null);
      clientIdRef.current = null;
    }
  }, []);

  // Lock-screen integration. A split made from the lock screen posts
  // "session-updated"; re-read IndexedDB to reflect it.
  const onSwMessage = useCallback(
    (msg: SwSessionMessage) => {
      if (msg.kind === "sleep") void reload();
    },
    [reload],
  );
  const lockScreen = useLockScreen(onSwMessage);

  // Hydrate once on mount; migrate any legacy nap outbox to IDB too.
  useEffect(() => {
    void migrateLegacyNapOutbox();
    void reload();
  }, [reload]);

  // Reconcile with IndexedDB whenever the app regains focus (splits/stop may
  // have happened on the lock screen while away).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload]);

  // Tick every second while running to drive the elapsed clock.
  useEffect(() => {
    if (!isActive) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const metrics = sleepMetrics(startMs ?? now, now, splits);
  const openWake = splits.find((s) => s.endMs === null) ?? null;

  // The "current stretch" drives the primary timer:
  //  - awake: counts up from the open wake's start.
  //  - asleep: counts up from the last wake's end (or the session start if the
  //    baby hasn't woken yet).
  const lastClosedEnd = splits.reduce<number | null>(
    (latest, s) =>
      s.endMs !== null && (latest === null || s.endMs > latest)
        ? s.endMs
        : latest,
    null,
  );
  const stretchAwake = openWake !== null;
  const stretchStartMs = stretchAwake
    ? openWake.startMs
    : (lastClosedEnd ?? startMs ?? now);
  const stretchMs = Math.max(0, now - stretchStartMs);

  const startSleep = () => {
    const start = Date.now();
    const clientId = newClientId();
    clientIdRef.current = clientId;
    setStartMs(start);
    setSplits([]);
    setNote(null);
    setNow(start);
    void (async () => {
      await setActiveSession({
        kind: "sleep",
        clientId,
        startMs: start,
        note: null,
        splits: [],
      });
      await lockScreen.showNotification();
    })();
  };

  // Toggle the current wake interval (open => "woke", close => "resettled").
  const markSplit = () => {
    void (async () => {
      const updated = await toggleSplit(Date.now());
      if (updated?.kind === "sleep") setSplits(updated.splits);
      await lockScreen.showNotification();
    })();
  };

  const stopSleep = () => {
    if (startMs === null) return;
    const end = Date.now();
    // Close any still-open wake interval at stop time.
    const finalSplits = splits.map((s) =>
      s.endMs === null ? { ...s, endMs: end } : s,
    );
    const clientId = clientIdRef.current ?? newClientId();

    // Reset local UI immediately.
    setStartMs(null);
    setSplits([]);
    setNote(null);
    clientIdRef.current = null;

    void (async () => {
      await enqueueSleep({
        clientId,
        startMs,
        endMs: end,
        note,
        splits: finalSplits,
      });
      await clearActiveSession();
      await lockScreen.clearNotification();
    })();
  };

  return (
    <section className="w-full max-w-md rounded-2xl bg-white/10 p-6 shadow-lg backdrop-blur">
      <div className="flex flex-col items-center gap-5">
        {lockScreen.isSupported && (
          <LockScreenPrompt
            permission={lockScreen.permission}
            onEnable={() => {
              void (async () => {
                const result = await lockScreen.requestPermission();
                if (result === "granted" && startMs !== null) {
                  await lockScreen.showNotification();
                }
              })();
            }}
          />
        )}

        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-white/60">
            {isActive ? "Night sleep in progress" : "No sleep running"}
          </p>
          {isActive ? (
            <>
              <p className="mt-2 text-xs uppercase tracking-widest text-white/50">
                {stretchAwake ? "Awake for" : "Asleep for"}
              </p>
              <p
                className={`mt-1 font-mono text-5xl font-bold tabular-nums ${
                  stretchAwake ? "text-amber-300" : "text-white"
                }`}
                aria-live="polite"
              >
                {formatDuration(stretchMs)}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {stretchAwake
                  ? `woke at ${formatTime(new Date(stretchStartMs))}`
                  : lastClosedEnd !== null
                    ? `resettled at ${formatTime(new Date(stretchStartMs))}`
                    : `fell asleep at ${formatTime(new Date(stretchStartMs))}`}
              </p>
              {/* Secondary: total accumulated night time. */}
              <div className="mt-3 inline-flex items-baseline gap-2 rounded-full bg-white/5 px-3 py-1">
                <span className="text-xs text-white/50">Total night</span>
                <span className="font-mono text-sm font-semibold tabular-nums text-white/80">
                  {formatDuration(metrics.totalMs)}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/40">
                started {formatTime(new Date(startMs))}
              </p>
            </>
          ) : (
            <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-white/60">
              Ready
            </p>
          )}
        </div>

        {/* Summary stats while running. */}
        {isActive && (
          <div className="grid w-full grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-white/50">Wake-ups</p>
              <p className="mt-0.5 font-semibold tabular-nums text-white">
                {metrics.wakeCount}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-white/50">Awake</p>
              <p className="mt-0.5 font-semibold tabular-nums text-white">
                {formatDuration(metrics.awakeMs)}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-white/50">Asleep</p>
              <p className="mt-0.5 font-semibold tabular-nums text-white">
                {formatDuration(metrics.asleepMs)}
              </p>
            </div>
          </div>
        )}

        {/* The prominent split button — the primary night-time action. */}
        {isActive && (
          <button
            onClick={markSplit}
            className={`w-full rounded-full px-8 py-4 text-lg font-semibold text-white transition ${
              openWake
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-sky-500 hover:bg-sky-600"
            }`}
          >
            {openWake ? "Mark resettled" : "Mark wake-up"}
          </button>
        )}

        {/* Live list of wake-ups. */}
        {isActive && splits.length > 0 && (
          <ul className="w-full divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 text-sm">
            {splits.map((s, i) => (
              <li
                key={`${s.startMs}-${i}`}
                className="flex items-center justify-between px-3 py-2 text-white/80"
              >
                <span>
                  Wake #{i + 1} · {formatTime(new Date(s.startMs))}
                </span>
                <span className="tabular-nums text-white/60">
                  {s.endMs === null
                    ? "ongoing"
                    : formatDuration(s.endMs - s.startMs)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Start / Stop — only available in-app (never on the lock screen). */}
        {isActive ? (
          <button
            onClick={() => {
              if (confirm("End the night sleep session?")) stopSleep();
            }}
            className="w-full rounded-full bg-rose-500 px-8 py-3 text-base font-semibold text-white transition hover:bg-rose-600"
          >
            Stop sleep
          </button>
        ) : (
          <button
            onClick={startSleep}
            className="w-full rounded-full bg-emerald-500 px-8 py-4 text-lg font-semibold text-white transition hover:bg-emerald-600"
          >
            Start night sleep
          </button>
        )}
      </div>
    </section>
  );
}
