/* Simple offline-first service worker for the Nap Tracker PWA.
 *
 * Strategy:
 *  - Precache a minimal offline fallback page and icons on install.
 *  - Navigations: network-first; successful HTML responses are cached as the
 *    "app shell". With no connection we serve the cached shell for the
 *    requested route (or the last cached app page) so a COLD launch boots the
 *    real React app — which runs fully client-side (local-first timers) — and
 *    only drops to the static offline page if nothing is cached yet.
 *  - Static assets (Next.js /_next/static, icons): cache-first (immutable).
 *  - API/tRPC and auth requests are never cached (always hit the network).
 */

const CACHE = "baby-app-v2";
const OFFLINE_URL = "/offline.html";
// Navigable app routes to warm into the shell cache on install, so the app can
// cold-launch offline even before the user has visited them online this SW
// generation. These are same-origin GET navigations.
const APP_SHELL_ROUTES = ["/", "/sleep", "/dashboard"];
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

/* ================================================================== */
/* Lock-screen notification layer                                      */
/*                                                                     */
/* Mirrors src/app/_components/active-session-store.ts. These constants */
/* MUST stay in sync with that file (DB name/version, store names, key).*/
/* The SW cannot import the app bundle, so this is a vanilla-JS copy of  */
/* the minimal IndexedDB access it needs.                               */
/* ================================================================== */

const DB_NAME = "baby-app";
const DB_VERSION = 1;
const SESSION_STORE = "session";
const OUTBOX_STORE = "outbox";
const ACTIVE_KEY = "active";
const NOTIF_TAG = "active-session"; // single tag => one notification, updated in place

/** Open the shared DB, creating stores if the page hasn't yet. */
function openDb() {
  return new Promise((resolve, reject) => {
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
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getActiveSession() {
  const db = await openDb();
  return idbGet(db, SESSION_STORE, ACTIVE_KEY);
}

async function setActiveSession(session) {
  const db = await openDb();
  return idbPut(db, SESSION_STORE, { ...session, id: ACTIVE_KEY });
}

async function clearActiveSession() {
  const db = await openDb();
  return idbDelete(db, SESSION_STORE, ACTIVE_KEY);
}

async function enqueueOutbox(entry) {
  const db = await openDb();
  return idbPut(db, OUTBOX_STORE, entry);
}

/** Format an elapsed millisecond span as "1h 23m" (coarse; for the shade). */
function formatElapsed(ms) {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(ms / 1000)}s`;
}

function serializeSplits(splits) {
  return (splits || []).map((s) => ({
    startTime: new Date(s.startMs).toISOString(),
    endTime: s.endMs === null || s.endMs === undefined
      ? null
      : new Date(s.endMs).toISOString(),
  }));
}

/**
 * Build the notification title/body/actions for the current session.
 * SAFETY: the "stop" action is only ever added for naps. A sleep session
 * exposes "split" + "refresh" and NEVER "stop", so an all-night session cannot
 * be ended from the lock screen.
 */
function buildNotification(session, now) {
  const elapsed = formatElapsed(now - session.startMs);

  if (session.kind === "nap") {
    return {
      title: "Nap in progress",
      options: {
        tag: NOTIF_TAG,
        body: `Elapsed ${elapsed} • tap Refresh to update`,
        icon: "/icon.svg",
        badge: "/icon.svg",
        requireInteraction: true,
        renotify: false,
        silent: true,
        actions: [
          { action: "stop", title: "Stop" },
          { action: "refresh", title: "Refresh" },
        ],
        data: { kind: "nap" },
      },
    };
  }

  // sleep
  const splits = session.splits || [];
  const openWake = splits.some((s) => s.endMs === null);
  const wakeCount = splits.length;
  const splitLabel = openWake ? "Resettled" : "Mark wake-up";
  const status = openWake ? "awake now" : `${wakeCount} wake-up${wakeCount === 1 ? "" : "s"}`;

  return {
    title: "Night sleep in progress",
    options: {
      tag: NOTIF_TAG,
      body: `Elapsed ${elapsed} • ${status}`,
      icon: "/icon.svg",
      badge: "/icon.svg",
      requireInteraction: true,
      renotify: false,
      silent: true,
      // NOTE: no "stop" action — sleep cannot be stopped from the lock screen.
      actions: [
        { action: "split", title: splitLabel },
        { action: "refresh", title: "Refresh" },
      ],
      data: { kind: "sleep" },
    },
  };
}

/** Show (or update, via the shared tag) the active-session notification. */
async function showActiveNotification() {
  const session = await getActiveSession();
  if (!session) {
    await clearActiveNotification();
    return;
  }
  const { title, options } = buildNotification(session, Date.now());
  await self.registration.showNotification(title, options);
}

/** Dismiss the active-session notification if present. */
async function clearActiveNotification() {
  const existing = await self.registration.getNotifications({ tag: NOTIF_TAG });
  for (const n of existing) n.close();
}

/** Toggle the open/closed wake interval for a sleep session. */
function toggleSplitLocal(session, atMs) {
  const splits = Array.isArray(session.splits) ? session.splits.slice() : [];
  const openIdx = splits.findIndex((s) => s.endMs === null);
  if (openIdx === -1) splits.push({ startMs: atMs, endMs: null });
  else splits[openIdx] = { startMs: splits[openIdx].startMs, endMs: atMs };
  return { ...session, splits };
}

/**
 * Apply a lock-screen action to the active session.
 *  - nap + stop    => clear session, enqueue completed nap to the outbox.
 *  - sleep + split => toggle the current wake interval.
 *  - *   + refresh => no state change (notification is re-shown by caller).
 */
async function handleAction(action) {
  const session = await getActiveSession();
  if (!session) return;

  if (session.kind === "nap" && action === "stop") {
    const now = Date.now();
    await enqueueOutbox({
      clientId: session.clientId,
      kind: "nap",
      startTime: new Date(session.startMs).toISOString(),
      endTime: new Date(now).toISOString(),
      note: session.note ?? null,
      splits: [],
      synced: false,
    });
    await clearActiveSession();
    await clearActiveNotification();
    // Best-effort: ask any open page to flush the outbox now.
    await notifyClients({ type: "session-stopped", kind: "nap" });
    return;
  }

  if (session.kind === "sleep" && action === "split") {
    const updated = toggleSplitLocal(session, Date.now());
    await setActiveSession(updated);
    await showActiveNotification();
    await notifyClients({ type: "session-updated", kind: "sleep" });
    return;
  }

  // refresh / body tap / unknown => just re-show with fresh elapsed.
  await showActiveNotification();
}

/** Post a message to every controlled client (open tabs/PWA windows). */
async function notifyClients(message) {
  const clientList = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  for (const client of clientList) client.postMessage(message);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Required assets — must all succeed.
      await cache.addAll(PRECACHE);
      // App-shell routes — best-effort. We only cache a genuine HTML page
      // (status 200, not an opaque/auth redirect) so the offline cold launch
      // boots the real app. Failures here must not abort the install.
      await Promise.all(
        APP_SHELL_ROUTES.map(async (route) => {
          try {
            const res = await fetch(route, { credentials: "same-origin" });
            if (res.ok && res.type === "basic") {
              await cache.put(route, res.clone());
            }
          } catch {
            /* offline during install, or route unavailable — ignore. */
          }
        }),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

/* ================================================================== */
/* Lock-screen notification event handlers                             */
/* ================================================================== */

/**
 * A notification action button (or the body) was tapped — possibly from the
 * lock screen. This wakes the SW; we apply the action and re-show with a fresh
 * elapsed time. For a plain body tap we also focus/open the relevant page.
 */
self.addEventListener("notificationclick", (event) => {
  const action = event.action; // "stop" | "refresh" | "split" | "" (body)
  const kind = event.notification?.data?.kind;

  // Refresh and the sleep/nap action buttons keep the user on the lock screen:
  // we handle state + re-show without opening the app.
  if (action) {
    event.waitUntil(handleAction(action));
    return;
  }

  // Body tap (no action): keep the notification fresh AND bring the app
  // forward to the matching module.
  event.notification.close();
  const url = kind === "sleep" ? "/sleep" : "/";
  event.waitUntil(
    (async () => {
      await showActiveNotification();
      const clientList = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});

/**
 * Message bridge from the page. The client drives the notification lifecycle:
 *  - { type: "show-session" }  => show/update the active-session notification
 *  - { type: "clear-session" } => dismiss the notification
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "show-session") {
    event.waitUntil(showActiveNotification());
  } else if (data.type === "clear-session") {
    event.waitUntil(clearActiveNotification());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache dynamic app data or auth — these must be live.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, caching the fetched app shell so a later cold
  // launch with no connection can boot the real app. Offline, we serve the
  // cached shell for this route (or any cached app page) and only drop to the
  // static offline page when nothing usable is cached yet.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Cache only successful same-origin HTML (not login/auth redirects).
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        } catch {
          const cache = await caches.open(CACHE);
          // 1) Exact cached route (ignore the search string so query params
          //    don't cause a miss).
          const exact = await cache.match(request, { ignoreSearch: true });
          if (exact) return exact;
          // 2) The route's pathname as an app-shell key.
          const byPath = await cache.match(url.pathname);
          if (byPath) return byPath;
          // 3) Any cached app-shell route — the React app can client-route from
          //    there once it boots.
          for (const route of APP_SHELL_ROUTES) {
            const shell = await cache.match(route);
            if (shell) return shell;
          }
          // 4) Last resort: the static offline page.
          return (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first, then populate the cache.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});
