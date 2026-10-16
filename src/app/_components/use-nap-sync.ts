"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { api } from "~/trpc/react";
import {
  getOutboxByKind,
  removeOutbox as removeIdbOutbox,
} from "./active-session-store";

/**
 * A completed nap captured on the client. It lives in localStorage until it is
 * successfully written to the server, giving the app local-first behaviour:
 * naps can be recorded with no connection and synced later.
 */
export interface PendingNap {
  /** Stable client-generated id (used for React keys and dedupe). */
  clientId: string;
  startTime: string; // ISO
  endTime: string; // ISO
  note?: string | null;
  /** Set once the server has persisted this nap. */
  synced: boolean;
}

const OUTBOX_KEY = "baby_app.napOutbox";

/* ------------------------------------------------------------------ */
/* Low-level localStorage-backed store with a subscription for React.  */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

const EMPTY: PendingNap[] = [];

function emit() {
  for (const l of listeners) l();
}

function readOutbox(): PendingNap[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingNap[]) : [];
  } catch {
    return [];
  }
}

/**
 * Cached snapshot for useSyncExternalStore. It MUST return a referentially
 * stable value when nothing changed, otherwise React loops ("getSnapshot
 * should be cached"). We cache the parsed array keyed by the raw string and
 * only recompute when the underlying localStorage value actually changes.
 */
let snapshotRaw: string | null = null;
let snapshotValue: PendingNap[] = [];

function getSnapshot(): PendingNap[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(OUTBOX_KEY);
  if (raw === snapshotRaw) return snapshotValue;
  snapshotRaw = raw;
  snapshotValue = readOutbox();
  return snapshotValue;
}

function writeOutbox(naps: PendingNap[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(naps));
  emit();
}

/** Append a completed nap to the outbox. */
export function enqueueNap(nap: Omit<PendingNap, "synced">) {
  const current = readOutbox();
  writeOutbox([...current, { ...nap, synced: false }]);
}

/** Remove a nap from the outbox by client id (after confirmed sync). */
function removeNap(clientId: string) {
  writeOutbox(readOutbox().filter((n) => n.clientId !== clientId));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Cross-tab updates.
  const onStorage = (e: StorageEvent) => {
    if (e.key === OUTBOX_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Subscribe a component to the current outbox contents. */
export function usePendingNaps(): PendingNap[] {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY, // server snapshot (SSR) — outbox is client-only
  );
}

/* ------------------------------------------------------------------ */
/* Sync engine: flush unsynced naps to the server when online.         */
/* ------------------------------------------------------------------ */

/**
 * Returns the current outbox plus helpers. Automatically flushes pending naps
 * to the server on mount, when the browser regains connectivity, and whenever
 * a new nap is enqueued while online.
 */
export function useNapSync() {
  const pending = usePendingNaps();
  const utils = api.useUtils();
  const create = api.nap.create.useMutation();
  const flushing = useRef(false);

  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const unsynced = readOutbox().filter((n) => !n.synced);
    // Naps stopped from the lock screen are enqueued by the service worker into
    // the shared IndexedDB outbox (which it can access, unlike localStorage).
    // Drain those here too so lock-screen stops reach the server.
    const idbNaps = (await getOutboxByKind("nap")).filter((n) => !n.synced);
    if (unsynced.length === 0 && idbNaps.length === 0) return;

    flushing.current = true;
    try {
      for (const nap of unsynced) {
        try {
          await create.mutateAsync({
            startTime: new Date(nap.startTime),
            endTime: new Date(nap.endTime),
            note: nap.note ?? undefined,
          });
          // Confirmed on the server — drop it from the outbox.
          removeNap(nap.clientId);
        } catch {
          // Network/server error: stop and retry on the next trigger.
          break;
        }
      }
      for (const nap of idbNaps) {
        try {
          await create.mutateAsync({
            startTime: new Date(nap.startTime),
            endTime: new Date(nap.endTime),
            note: nap.note ?? undefined,
          });
          await removeIdbOutbox(nap.clientId);
        } catch {
          break;
        }
      }
      await utils.nap.getHistory.invalidate();
    } finally {
      flushing.current = false;
    }
  }, [create, utils]);

  // Flush on mount and whenever we (re)gain connectivity or the queue changes.
  useEffect(() => {
    if (online) void flush();
  }, [online, pending.length, flush]);

  return {
    pending,
    online,
    pendingCount: pending.filter((n) => !n.synced).length,
    flush,
  };
}

/**
 * The end time (ms since epoch) of the most recently *ended* nap, considering
 * both unsynced naps in the local outbox and naps already on the server.
 * Returns null when no completed nap exists yet.
 */
export function useLastNapEnd(): number | null {
  const pending = usePendingNaps();
  const historyQuery = api.nap.getHistory.useQuery(
    { limit: 30 },
    { retry: false },
  );

  let latest: number | null = null;

  for (const n of pending) {
    const end = new Date(n.endTime).getTime();
    if (Number.isFinite(end) && (latest === null || end > latest)) latest = end;
  }

  for (const nap of historyQuery.data ?? []) {
    if (!nap.endTime) continue;
    const end = new Date(nap.endTime).getTime();
    if (Number.isFinite(end) && (latest === null || end > latest)) latest = end;
  }

  return latest;
}
