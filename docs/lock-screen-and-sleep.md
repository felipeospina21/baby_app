# Lock‑screen controls & Night Sleep module — design

Status: **implemented**. All code is in place and verified: `pnpm check` (lint +
types) and `pnpm build` pass, and the Drizzle migration has been applied to the
database. The remaining verification is on‑device manual QA (checklist at the end),
which requires a physical Android phone and a production deploy.

## Goals

1. **Lock‑screen controls.** Let the user act on an active timer from the Android
   lock screen without unlocking the phone or opening the app:
   - **Naps:** Stop + Refresh.
   - **Night sleep:** **Split (mark wake‑up) + Refresh only** — deliberately *no* Stop,
     so an all‑night session cannot be ended by accident. Start/Stop for sleep happens
     only inside the full app.
2. **Night Sleep module.** A separate page/module. Start a sleep timer that keeps
   running; mark "splits" (wake‑ups) like laps on a stopwatch. The clock never stops
   on a split. Full stop/start only in‑app.

## Why this is possible (and where it isn't)

The timer **cannot tick by itself on the lock screen**. Service workers are
event‑driven and are killed when idle, and the web `Notification` API has no
self‑updating chronometer. Instead we use the pattern:

> A notification action (or tapping the notification) **wakes the service worker**.
> At that moment we recompute `elapsed = Date.now() - startMs` from stored state and
> **re‑show** the notification with the fresh value.

So the displayed time is **refresh‑on‑tap**, not live‑ticking. This matches the agreed
UX ("update the timer when the screen is tapped").

### Known limitations (accepted)

- **No self‑ticking timer** on the lock screen; it updates when the user taps an action.
- **Android‑only.** iOS PWA notification support is minimal; the feature degrades to a
  no‑op there (the in‑app timer still works).
- **The OS may clear the notification** under memory pressure. It is re‑shown the next
  time the app opens / regains focus.
- **Starting from a fully locked/closed state** requires the active notification to already
  exist. We only show the active‑session notification while a session is running. (A future
  "pinned quick‑track" idle notification could allow start‑from‑lock‑screen for naps; out of
  scope for now.)

## Decisions

These are the defaults chosen for the first implementation. Any of them can be revisited.

1. **Single active session.** At most **one** active timer exists at a time — a nap and a
   night sleep cannot run simultaneously. The active session lives under a single fixed key
   in IndexedDB. The UI prevents starting one kind while the other is active.

2. **Split semantics = paired wake intervals.** A "split" is not a bare instant; it is a
   **wake‑up interval** with a `start` (baby woke) and an optional `end` (baby resettled).
   - Tapping **Mark wake‑up** opens a new interval (`start = now`, `end = null`).
   - Tapping again (**Resettled**) closes the open interval (`end = now`).
   - This captures *how long* each wake‑up lasted, which is more useful for a sleep tracker
     than bare lap marks. Derived metrics: total session duration, number of wake‑ups, total
     awake time, total asleep time.
   - On the **lock screen**, each Split tap toggles open/close of the current wake interval;
     the notification shows the current wake count and whether a wake is currently open.

3. **Splits storage = child table.** `baby_app_sleep_split` rows reference a
   `baby_app_sleep_session`. Chosen over a JSON column for queryability/aggregation and to
   mirror the existing relational conventions in `schema.ts`.

4. **Local‑first, unchanged contract.** As with naps, the client owns the running timer and
   only writes a **completed** session (with its splits) to the server on Stop, via an
   IndexedDB outbox that flushes through tRPC when online.

## Data model

### Active session (IndexedDB — client + service worker)

Database `baby-app` (version 1), object stores:

- `session` — keyed by the literal string `"active"`. Zero or one record:

  ```ts
  type ActiveSession = {
    id: "active";
    kind: "nap" | "sleep";
    clientId: string;        // stable id carried into the outbox on completion
    startMs: number;         // epoch ms
    note: string | null;
    // sleep only; empty for naps:
    splits: { startMs: number; endMs: number | null }[];
  };
  ```

- `outbox` — keyed by `clientId`. Completed sessions awaiting sync:

  ```ts
  type PendingSession = {
    clientId: string;
    kind: "nap" | "sleep";
    startTime: string;       // ISO
    endTime: string;         // ISO
    note: string | null;
    splits: { startTime: string; endTime: string | null }[]; // sleep only
    synced: boolean;
  };
  ```

The existing nap outbox currently lives in `localStorage` (`baby_app.napOutbox`). The
service worker **cannot** read `localStorage`, so the shared outbox moves to IndexedDB.
A one‑time migration copies any existing `localStorage` outbox into IndexedDB on first load.

### Server (Postgres via Drizzle)

New tables, following the `baby_app_` prefix convention:

- `baby_app_sleep_session`
  - `id` identity PK
  - `userId` → `baby_app_user.id`
  - `startTime` timestamptz not null
  - `endTime` timestamptz null (null while running; always set once persisted)
  - `note` varchar(256) null
  - `createdAt` / `updatedAt`
  - indexes on `userId`, `startTime`
- `baby_app_sleep_split`
  - `id` identity PK
  - `sessionId` → `baby_app_sleep_session.id` (cascade delete)
  - `startTime` timestamptz not null  (baby woke)
  - `endTime` timestamptz null         (baby resettled; null if still awake at session stop)
  - `note` varchar(256) null
  - index on `sessionId`

## Lock‑screen action matrix

| Session kind | Notification actions | Stop available on lock screen? |
|--------------|----------------------|--------------------------------|
| Nap          | `stop`, `refresh`    | **Yes**                        |
| Sleep        | `split`, `refresh`   | **No** (safety)                |

The safety guarantee for sleep is structural: the `stop` action is simply **never
registered** on a sleep notification, so there is no lock‑screen affordance that can end a
sleep session. Stop is reachable only from the in‑app Sleep page.

### Service‑worker action handling

`notificationclick` reads the active session from IndexedDB and:

- **nap + `stop`** → clear active session, enqueue a completed nap into the outbox, show an
  "ended" confirmation (or clear the notification).
- **nap + `refresh`** (or body tap) → recompute elapsed, re‑show.
- **sleep + `split`** → toggle the current wake interval (open a new one, or close the open
  one), persist to IndexedDB, re‑show with updated wake count.
- **sleep + `refresh`** (or body tap) → recompute elapsed + wake count, re‑show.

A `message` handler lets the page drive the notification (show on start, clear on stop,
update after in‑app changes).

## Client ↔ service‑worker sync

- The page writes the active session to IndexedDB and posts a message to the SW to show the
  notification on Start.
- Actions taken from the lock screen mutate IndexedDB inside the SW. The page re‑reads
  IndexedDB on `focus` / `visibilitychange` so splits or a Stop performed from the lock
  screen are reflected when the app is reopened.
- On Stop, the completed session is enqueued to the outbox and flushed to the server by the
  existing local‑first sync engine (generalised to handle `kind` + `splits`).

## Affected / new files

Shared lock‑screen infra:
- `src/app/_components/active-session-store.ts` — typed IndexedDB helpers (new).
- `public/sw.js` — add notification + message handlers (caching logic untouched).
- `src/app/_components/use-lock-screen.ts` — permission flow + SW message bridge (new).

Nap integration:
- `src/app/_components/nap-timer.tsx` — write active session to IDB; show/clear notification.

Night sleep module:
- `src/server/db/schema.ts` — add `sleep_session` + `sleep_split` tables & relations.
- `src/server/api/routers/sleep.ts` — tRPC router (new); register in `root.ts`.
- `src/app/_components/use-sleep-sync.ts` + shared sync core — generalise the outbox engine.
- `src/app/sleep/page.tsx`, `sleep-timer.tsx`, `sleep-history.tsx` — the module (new).
- Navigation between the Naps (`/`) and Sleep (`/sleep`) pages.

## Verification

- `pnpm check` (next lint + tsc --noEmit) and `pnpm build` must pass.
- `pnpm db:generate` then `pnpm db:migrate` to apply the new schema.
- Manual QA on a real Android device (installed PWA):
  1. Nap: start → lock → Refresh updates elapsed → Stop ends it; reopen app shows it synced.
  2. Sleep: start → lock → tap Split several times → confirm **no Stop** on the lock screen →
     reopen app and confirm splits are present; Stop only from the app.
  3. Offline: stop a nap / split a sleep while offline → reconnect → confirm sync.
  4. iOS / unsupported: feature no‑ops; in‑app timers still work.

### Automated verification performed

- `pnpm check` — ESLint + `tsc --noEmit`: **pass, no warnings/errors**.
- `pnpm build` — production build (includes type‑checking + static generation):
  **pass**; `/sleep` route built, `/` intact.
- `pnpm db:generate` + `pnpm db:migrate` — migration `0003_common_inhumans.sql`
  **applied**; `baby_app_sleep_session` and `baby_app_sleep_split` confirmed present
  in the database.
- Split‑only safety confirmed by inspection of `public/sw.js`: the `stop` action is
  registered **only** inside the `kind === "nap"` branch and gated by
  `session.kind === "nap" && action === "stop"`; the sleep notification exposes only
  `split` + `refresh`.

### Manual QA checklist (on a real Android device)

Prerequisites: deploy a production build (the service worker is registered only when
`NODE_ENV === "production"`), open the site in Chrome on Android, and **Install** the
PWA (Add to Home screen).

- [ ] Open the installed PWA. On the Naps tab, tap **Enable** on the lock‑screen prompt
      and grant notification permission.
- [ ] **Nap – lock‑screen Stop/Refresh**
  - [ ] Start a nap. A notification appears showing elapsed time with **Stop** + **Refresh**.
  - [ ] Lock the phone. On the lock screen, tap **Refresh** → elapsed time updates.
  - [ ] Tap **Stop** → the notification clears.
  - [ ] Unlock, open the app → the nap appears in Latest naps (synced, or "pending" then synced).
- [ ] **Sleep – split‑only safety**
  - [ ] Switch to the Night Sleep tab. Start a night sleep. Notification shows
        **Mark wake‑up** + **Refresh** and **no Stop button**.
  - [ ] Lock the phone. Tap **Mark wake‑up** → body shows "awake now"; tap again
        (**Resettled**) → wake count increments. Repeat a few times.
  - [ ] Confirm there is **no way to stop** the session from the lock screen.
  - [ ] Open the app → the running session shows the wake‑ups recorded from the lock screen.
  - [ ] Tap **Stop sleep** in the app (confirm prompt) → the session moves to Latest nights
        with the correct duration and wake‑up count; expand **Details** to see each wake.
- [ ] **Offline behaviour**
  - [ ] Enable airplane mode. Stop a nap / stop a sleep → it is queued ("pending sync").
  - [ ] Disable airplane mode → within a few seconds it syncs and "pending" clears.
- [ ] **Degradation**
  - [ ] On iOS (or a browser without notification support) the lock‑screen prompt does
        not appear and the in‑app timers still work normally.

Note: the lock‑screen timer updates on tap (Refresh / an action), not every second —
this is an inherent PWA limitation documented above, not a bug.
