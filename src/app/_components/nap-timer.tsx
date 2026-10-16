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
  const elapsedMs = startMs !== null ? now - startMs : 0;

  const persistStart = (ms: number | null) => {
    setStartMs(ms);
    if (typeof window === "undefined") return;
    if (ms === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(ms));
  };
  // Expose persistStart to the mount-time effects/callbacks above.
  persistStartRef.current = persistStart;

  const startNap = () => {
    const start = Date.now();
    persistStart(start);
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
    persistStart(null);
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
            {isActive ? "Nap in progress" : "No nap running"}
          </p>
          {isActive && (
            <p
              className="mt-2 font-mono text-3xl font-bold tabular-nums text-white"
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
