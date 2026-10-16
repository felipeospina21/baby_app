/**
 * Shared IndexedDB store for the single active timer session and the completed
 * session outbox.
 *
 * Why IndexedDB (and not localStorage)? The service worker — which handles
 * lock-screen notification actions — can access IndexedDB but **not**
 * localStorage. This module is the page-side (TypeScript) client. A minimal
 * vanilla-JS equivalent is inlined in `public/sw.js` because the SW cannot
 * import the app bundle. Keep the two in sync: database name, version, store
 * names and the fixed `ACTIVE_KEY` MUST match.
 *
 * Model (see docs/lock-screen-and-sleep.md):
 *  - At most one active session (a nap XOR a night sleep), stored under the
 *    literal key "active" in the `session` store.
 *  - A sleep session carries `splits`: paired wake intervals
 *    { startMs, endMs|null }. A nap has an empty splits array.
 *  - On stop, the completed session is moved to the `outbox` store (keyed by
 *    clientId) for the local-first sync engine to flush to the server.
 */

export const DB_NAME = "baby-app";
export const DB_VERSION = 1;
export const SESSION_STORE = "session";
export const OUTBOX_STORE = "outbox";
/** Fixed key for the single active session record. */
export const ACTIVE_KEY = "active";

export type SessionKind = "nap" | "sleep";

/** A wake-up interval within a sleep session (epoch ms). `endMs` is null while open. */
export interface SplitInterval {
  startMs: number;
  endMs: number | null;
}

/** The one active (running) session, or null when idle. */
export interface ActiveSession {
  /** Always the literal ACTIVE_KEY; present so the record is self-describing. */
  id: typeof ACTIVE_KEY;
  kind: SessionKind;
  /** Stable id carried into the outbox on completion. */
  clientId: string;
  /** Session start, epoch ms. */
  startMs: number;
  note: string | null;
  /** Wake intervals; always empty for naps. */
  splits: SplitInterval[];
}

/** Serialized split for the outbox / server (ISO strings). */
export interface PendingSplit {
  startTime: string;
  endTime: string | null;
}

/** A completed session awaiting sync to the server. */
export interface PendingSession {
  clientId: string;
  kind: SessionKind;
  startTime: string; // ISO
  endTime: string; // ISO
  note: string | null;
  splits: PendingSplit[]; // empty for naps
  synced: boolean;
}

/* ------------------------------------------------------------------ */
/* Low-level IndexedDB plumbing                                        */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function isSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Open (and, if needed, create/upgrade) the shared database. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "clientId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

/** Promisify a single-request transaction. */
function runRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/* ------------------------------------------------------------------ */
/* Active-session API                                                  */
/* ------------------------------------------------------------------ */

/** Read the current active session, or null when idle / unsupported. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  if (!isSupported()) return null;
  const db = await openDb();
  const result = await runRequest(
    tx(db, SESSION_STORE, "readonly").get(ACTIVE_KEY) as IDBRequest<
      ActiveSession | undefined
    >,
  );
  return result ?? null;
}

/** Create/replace the active session. */
export async function setActiveSession(
  session: Omit<ActiveSession, "id">,
): Promise<void> {
  if (!isSupported()) return;
  const db = await openDb();
  await runRequest(
    tx(db, SESSION_STORE, "readwrite").put({ ...session, id: ACTIVE_KEY }),
  );
}

/** Remove the active session (idle state). */
export async function clearActiveSession(): Promise<void> {
  if (!isSupported()) return;
  const db = await openDb();
  await runRequest(tx(db, SESSION_STORE, "readwrite").delete(ACTIVE_KEY));
}

/**
 * Toggle the current wake interval on a sleep session:
 *  - If no interval is open, open a new one at `atMs` (baby woke).
 *  - If an interval is open, close it at `atMs` (baby resettled).
 * No-op for naps or when idle. Returns the updated session (or null).
 */
export async function toggleSplit(
  atMs: number = Date.now(),
): Promise<ActiveSession | null> {
  const current = await getActiveSession();
  if (current?.kind !== "sleep") return current;

  const splits = [...current.splits];
  const open = splits.findIndex((s) => s.endMs === null);
  if (open === -1) {
    splits.push({ startMs: atMs, endMs: null });
  } else {
    splits[open] = { ...splits[open]!, endMs: atMs };
  }
  const updated: ActiveSession = { ...current, splits };
  await setActiveSession(updated);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Outbox API                                                          */
/* ------------------------------------------------------------------ */

/**
 * In-process subscribers notified whenever the outbox changes (enqueue/remove).
 * IndexedDB has no cross-context change events, so this only covers the current
 * page context — which is sufficient for the sync hooks that live there.
 */
const outboxListeners = new Set<() => void>();

function emitOutboxChange() {
  for (const l of outboxListeners) l();
}

/** Subscribe to outbox changes made within this page context. */
export function subscribeOutbox(cb: () => void): () => void {
  outboxListeners.add(cb);
  return () => outboxListeners.delete(cb);
}

/** Append (or replace by clientId) a completed session in the outbox. */
export async function enqueueOutbox(session: PendingSession): Promise<void> {
  if (!isSupported()) return;
  const db = await openDb();
  await runRequest(tx(db, OUTBOX_STORE, "readwrite").put(session));
  emitOutboxChange();
}

/** All outbox entries. */
export async function getOutbox(): Promise<PendingSession[]> {
  if (!isSupported()) return [];
  const db = await openDb();
  const all = await runRequest(
    tx(db, OUTBOX_STORE, "readonly").getAll() as IDBRequest<PendingSession[]>,
  );
  return all ?? [];
}

/** All outbox entries for a given session kind. */
export async function getOutboxByKind(
  kind: SessionKind,
): Promise<PendingSession[]> {
  const all = await getOutbox();
  return all.filter((s) => s.kind === kind);
}

/** Remove a completed session from the outbox by clientId. */
export async function removeOutbox(clientId: string): Promise<void> {
  if (!isSupported()) return;
  const db = await openDb();
  await runRequest(tx(db, OUTBOX_STORE, "readwrite").delete(clientId));
  emitOutboxChange();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Generate a stable client id (used as the outbox key). */
export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Convert an active session's splits (epoch ms) to the serialized form used by
 * the outbox / server (ISO strings).
 */
export function serializeSplits(splits: SplitInterval[]): PendingSplit[] {
  return splits.map((s) => ({
    startTime: new Date(s.startMs).toISOString(),
    endTime: s.endMs === null ? null : new Date(s.endMs).toISOString(),
  }));
}

/**
 * One-time migration of the legacy localStorage nap outbox
 * (`baby_app.napOutbox`) into the IndexedDB outbox, so the service worker can
 * see pending items. Safe to call repeatedly; it clears the legacy key once
 * copied. No-op on the server or when unsupported.
 */
export async function migrateLegacyNapOutbox(): Promise<void> {
  if (typeof window === "undefined" || !isSupported()) return;
  const LEGACY_KEY = "baby_app.napOutbox";
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed as Array<Record<string, unknown>>) {
        const clientId =
          typeof item.clientId === "string" ? item.clientId : newClientId();
        const startTime = typeof item.startTime === "string" ? item.startTime : null;
        const endTime = typeof item.endTime === "string" ? item.endTime : null;
        if (!startTime || !endTime) continue;
        await enqueueOutbox({
          clientId,
          kind: "nap",
          startTime,
          endTime,
          note: typeof item.note === "string" ? item.note : null,
          splits: [],
          synced: false,
        });
      }
    }
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Corrupt legacy data: leave it alone rather than throwing.
  }
}
