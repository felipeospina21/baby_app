"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side bridge to the lock-screen notification layer implemented in
 * `public/sw.js`. Responsibilities:
 *   - Report whether notifications are supported and their permission state.
 *   - Request permission on an explicit user gesture (never automatically).
 *   - Tell the service worker to show / clear the active-session notification.
 *   - Surface SW -> page messages ("session-stopped", "session-updated") so the
 *     page can re-read IndexedDB and flush the outbox after a lock-screen action.
 *
 * Everything degrades to a safe no-op when the environment lacks service
 * workers or the Notification API (e.g. iOS), so callers can use it
 * unconditionally.
 */

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

/** Message the service worker can post back to the page. */
export interface SwSessionMessage {
  type: "session-stopped" | "session-updated";
  kind: "nap" | "sleep";
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window
  );
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Post a message to the active service worker (via its registration). */
async function postToSw(message: Record<string, unknown>): Promise<void> {
  const reg = await readyRegistration();
  const worker = reg?.active ?? navigator.serviceWorker?.controller ?? null;
  worker?.postMessage(message);
}

export interface UseLockScreen {
  /** Whether the Notification + SW combination is available at all. */
  isSupported: boolean;
  /** Current permission ("unsupported" when the APIs are missing). */
  permission: NotificationPermissionState;
  /** Prompt the user for permission (call from a click handler). */
  requestPermission: () => Promise<NotificationPermissionState>;
  /** Ask the SW to show/update the active-session notification. */
  showNotification: () => Promise<void>;
  /** Ask the SW to clear the active-session notification. */
  clearNotification: () => Promise<void>;
}

export function useLockScreen(
  onMessage?: (msg: SwSessionMessage) => void,
): UseLockScreen {
  // Start in a stable, environment-agnostic state so the server render and the
  // first client render match (avoids hydration mismatches). The real support
  // and permission values are resolved after mount in the effect below.
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>(
    "unsupported",
  );

  // Resolve support + permission once, on the client, after hydration.
  useEffect(() => {
    setMounted(true);
    setPermission(supported() ? Notification.permission : "unsupported");
  }, []);

  // Only treat the feature as available after we've mounted and checked.
  const isSupported = mounted && supported();

  // Subscribe to messages posted by the service worker.
  useEffect(() => {
    if (!supported() || !onMessage) return;
    const handler = (event: MessageEvent) => {
      const data = event.data as SwSessionMessage | undefined;
      if (
        data &&
        (data.type === "session-stopped" || data.type === "session-updated")
      ) {
        onMessage(data);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [onMessage]);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermissionState> => {
      if (!supported()) return "unsupported";
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
      } catch {
        return Notification.permission;
      }
    }, []);

  const showNotification = useCallback(async () => {
    if (!supported() || Notification.permission !== "granted") return;
    await postToSw({ type: "show-session" });
  }, []);

  const clearNotification = useCallback(async () => {
    if (!supported()) return;
    await postToSw({ type: "clear-session" });
  }, []);

  return {
    isSupported,
    permission,
    requestPermission,
    showNotification,
    clearNotification,
  };
}
