"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearActiveSession,
  getActiveSession,
  migrateLegacyNapOutbox,
  newClientId,
  setActiveSession,
} from "./active-session-store";
import { LockScreenPrompt } from "./lock-screen-prompt";
import { formatAgo, formatDuration, toDateTimeLocal } from "./nap-utils";
import { enqueueNap, useLastNapEnd } from "./use-nap-sync";
import { useLockScreen, type SwSessionMessage } from "./use-lock-screen";

const STORAGE_KEY = "baby_app.activeNapStart";
// When the display is "paused" we remember the moment the user paused at. The
// nap's real start time is untouched, so the recorded duration is unaffected —
// pausing only freezes what's shown on screen (see README of this component).
const PAUSED_KEY = "baby_app.activeNapPausedAt";

/** Read the persisted start time (ms) from localStorage, if a nap is running. */
function readStoredStart(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Read the persisted "paused at" instant (ms), or null when not paused. */
function readStoredPausedAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PAUSED_KEY);
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function NapTimer() {
  // The running nap's start time (ms since epoch), or null when idle.
  // Persisted in localStorage so a refresh / phone-lock recovers it.
  const [startMs, setStartMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // When non-null, the display is "paused": the big timer is frozen at this
  // instant. The real elapsed is still startMs→now, so the recorded nap
  // duration is never affected — this is a display-only pause.
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  // The end time of the most recent completed nap (null if none yet).
  const lastNapEnd = useLastNapEnd();

  // Lock-screen integration. When a nap is stopped from the lock screen the SW
  // posts "session-stopped"; we re-read IndexedDB and sync the local UI.
  const onSwMessage = useCallback((msg: SwSessionMessage) => {
    if (msg.kind !== "nap") return;
    if (msg.type === "session-stopped") {
      // The SW already enqueued the completed nap to the IDB outbox and cleared
      // the active session. Clear the in-app running state to match.
      persistStartRef.current?.(null);
    }
  }, []);
  const lockScreen = useLockScreen(onSwMessage);
  // Stable id for the currently running nap, carried into the SW/outbox.
  const clientIdRef = useRef<string | null>(null);
  // Indirection so the SW-message callback can clear state without depending
  // on persistStart (declared below).
  const persistStartRef = useRef<((ms: number | null) => void) | null>(null);

  // Migrate any legacy localStorage nap outbox into IndexedDB once on mount, so
  // the service worker can see/flush pending items.
  useEffect(() => {
    void migrateLegacyNapOutbox();
  }, []);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setStartMs(readStoredStart());
    setPausedAt(readStoredPausedAt());
  }, []);

  // Reconcile with IndexedDB when the app regains focus — e.g. after a Stop was
  // performed from the lock screen while the phone was locked.
  useEffect(() => {
    const reconcile = async () => {
      const active = await getActiveSession();
      if (active?.kind !== "nap") {
        // No active nap in the shared store: ensure the UI is idle too.
        if (readStoredStart() !== null) persistStartRef.current?.(null);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Tick every second. While a nap is running this drives the elapsed timer;
  // while idle it keeps the "time since last nap ended" label fresh.
  useEffect(() => {
    if (startMs === null && lastNapEnd === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs, lastNapEnd]);

  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const startInputRef = useRef<HTMLInputElement>(null);

  const isActive = startMs !== null;
  const isPaused = pausedAt !== null;
  // Display elapsed. While paused we freeze the shown value at the pause
  // instant; the underlying start time is never touched, so stopping records
  // the full wall-clock duration regardless of any pauses.
  const elapsedMs =
    startMs !== null ? (pausedAt ?? now) - startMs : 0;

  const persistStart = (ms: number | null) => {
    setStartMs(ms);
    if (typeof window === "undefined") return;
    if (ms === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      // A cleared nap can never be "paused". Also clears when a Stop happened
      // from the lock screen and we're just reconciling the UI.
      window.localStorage.removeItem(PAUSED_KEY);
      setPausedAt(null);
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(ms));
    }
  };
  // Expose persistStart to the mount-time effects/callbacks above.
  persistStartRef.current = persistStart;

  const persistPausedAt = (ms: number | null) => {
    setPausedAt(ms);
    if (typeof window === "undefined") return;
    if (ms === null) window.localStorage.removeItem(PAUSED_KEY);
    else window.localStorage.setItem(PAUSED_KEY, String(ms));
  };

  const togglePause = () => {
    if (startMs === null) return;
    if (pausedAt === null) {
      // Freeze the display at the current instant.
      persistPausedAt(Date.now());
    } else {
      // Resume: the display jumps forward to real elapsed (time kept running).
      persistPausedAt(null);
      setNow(Date.now());
    }
  };

  const startNap = () => {
    const start = Date.now();
    persistStart(start);
    persistPausedAt(null);
    setNow(start);
    // Mirror the active session into IndexedDB and raise the lock-screen
    // notification (Stop + Refresh). All best-effort / no-op when unsupported.
    const clientId = newClientId();
    clientIdRef.current = clientId;
    void (async () => {
      await setActiveSession({
        kind: "nap",
        clientId,
        startMs: start,
        note: null,
        splits: [],
      });
      await lockScreen.showNotification();
    })();
  };

  const stopNap = () => {
    if (startMs === null) return;
    const start = new Date(startMs);
    const end = new Date();
    persistStart(null); // also clears any paused display state
    setEditingStart(false);
    // Local-first: queue the completed nap. The sync engine persists it to the
    // server now (if online) or later (on reconnect). Works fully offline.
    enqueueNap({
      clientId: clientIdRef.current ?? newClientId(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: null,
    });
    clientIdRef.current = null;
    // Tear down the shared active session + lock-screen notification.
    void (async () => {
      await clearActiveSession();
      await lockScreen.clearNotification();
    })();
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
      // Keep the shared active session + lock-screen notification in sync with
      // the adjusted start time.
      if (clientIdRef.current) {
        const clientId = clientIdRef.current;
        void (async () => {
          await setActiveSession({
            kind: "nap",
            clientId,
            startMs: edited,
            note: null,
            splits: [],
          });
          await lockScreen.showNotification();
        })();
      }
    }
    setEditingStart(false);
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
                // If granted while a nap is already running, raise the
                // notification immediately.
                if (result === "granted" && startMs !== null) {
                  await lockScreen.showNotification();
                }
              })();
            }}
          />
        )}
        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-white/60">
            {isActive
              ? isPaused
                ? "Nap paused"
                : "Nap in progress"
              : "No nap running"}
          </p>
          {isActive && (
            <p
              className={`mt-2 font-mono text-3xl font-bold tabular-nums ${
                isPaused ? "text-white/50" : "text-white"
              }`}
              aria-live="polite"
            >
              {formatDuration(elapsedMs)}
            </p>
          )}
          {!isActive &&
            (lastNapEnd !== null ? (
              <div className="mt-2" aria-live="polite">
                <p className="text-xs uppercase tracking-widest text-white/50">
                  Awake for
                </p>
                <p className="mt-1 font-mono text-5xl font-bold tabular-nums text-white">
                  {formatAgo(now - lastNapEnd).replace(/ ago$/, "")}
                </p>
                <p className="mt-2 text-xs text-white/40">
                  last nap ended{" "}
                  {new Date(lastNapEnd).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ) : (
              <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-white/60">
                0s
              </p>
            ))}
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
                  className="rounded-md border border-emerald-300/40 bg-emerald-400/5 px-3 py-1 font-medium text-emerald-200/90 hover:border-emerald-300/70 hover:bg-emerald-400/10"
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
          <div className="flex w-full gap-3">
            <button
              onClick={togglePause}
              className="flex-1 rounded-full border border-slate-300/40 bg-slate-400/5 px-6 py-4 text-lg font-semibold text-slate-200/90 transition hover:border-slate-300/70 hover:bg-slate-400/10"
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={stopNap}
              className="flex-1 rounded-full border border-rose-300/40 bg-rose-400/5 px-6 py-4 text-lg font-semibold text-rose-200/90 transition hover:border-rose-300/70 hover:bg-rose-400/10"
            >
              Stop nap
            </button>
          </div>
        ) : (
          <button
            onClick={startNap}
            className="w-full rounded-full border border-emerald-300/40 bg-emerald-400/5 px-8 py-4 text-lg font-semibold text-emerald-200/90 transition hover:border-emerald-300/70 hover:bg-emerald-400/10"
          >
            Start nap
          </button>
        )}
      </div>
    </section>
  );
}
