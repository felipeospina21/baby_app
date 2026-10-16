"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  enqueueOutbox,
  getOutboxByKind,
  newClientId,
  removeOutbox,
  serializeSplits,
  subscribeOutbox,
  type PendingSession,
  type SplitInterval,
} from "./active-session-store";
import { api } from "~/trpc/react";

/**
 * Local-first sync for night-sleep sessions. Mirrors the nap sync engine but is
 * backed by the shared IndexedDB outbox (so the service worker can enqueue a
 * completed session from the lock screen) and carries the session's wake-up
 * splits through to the server.
 */

/** Data needed to enqueue a completed sleep session for sync. */
export interface CompletedSleep {
  clientId?: string;
  startMs: number;
  endMs: number;
  note?: string | null;
  splits: SplitInterval[];
}

/** Enqueue a completed sleep session into the shared IndexedDB outbox. */
export async function enqueueSleep(session: CompletedSleep): Promise<void> {
  await enqueueOutbox({
    clientId: session.clientId ?? newClientId(),
    kind: "sleep",
    startTime: new Date(session.startMs).toISOString(),
    endTime: new Date(session.endMs).toISOString(),
    note: session.note ?? null,
    splits: serializeSplits(session.splits),
    synced: false,
  });
}

/**
 * Subscribe a component to the pending (unsynced) sleep sessions in the outbox.
 * Reads from IndexedDB (async) and refreshes on outbox changes + window focus.
 */
export function usePendingSleeps(): PendingSession[] {
  const [pending, setPending] = useState<PendingSession[]>([]);

  const refresh = useCallback(() => {
    void getOutboxByKind("sleep").then(setPending);
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeOutbox(refresh);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  return pending;
}

/**
 * Flushes pending sleep sessions to the server on mount, on reconnect, and
 * whenever the outbox changes while online. Returns the pending list + helpers.
 */
export function useSleepSync() {
  const pending = usePendingSleeps();
  const utils = api.useUtils();
  const create = api.sleep.create.useMutation();
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

    const unsynced = (await getOutboxByKind("sleep")).filter((s) => !s.synced);
    if (unsynced.length === 0) return;

    flushing.current = true;
    try {
      for (const session of unsynced) {
        try {
          await create.mutateAsync({
            startTime: new Date(session.startTime),
            endTime: new Date(session.endTime),
            note: session.note ?? undefined,
            splits: session.splits.map((s) => ({
              startTime: new Date(s.startTime),
              endTime: s.endTime ? new Date(s.endTime) : null,
            })),
          });
          await removeOutbox(session.clientId);
        } catch {
          // Network/server error: stop and retry on the next trigger.
          break;
        }
      }
      await utils.sleep.getHistory.invalidate();
    } finally {
      flushing.current = false;
    }
  }, [create, utils]);

  useEffect(() => {
    if (online) void flush();
  }, [online, pending.length, flush]);

  return {
    pending,
    online,
    pendingCount: pending.filter((s) => !s.synced).length,
    flush,
  };
}
