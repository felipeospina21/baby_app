"use client";

import type { NotificationPermissionState } from "./use-lock-screen";

/**
 * A small inline banner that invites the user to enable lock-screen controls
 * (notification permission). Renders nothing when the feature is unsupported or
 * already granted. Keep it unobtrusive — it sits above a timer.
 */
export function LockScreenPrompt({
  permission,
  onEnable,
}: {
  permission: NotificationPermissionState;
  onEnable: () => void;
}) {
  if (permission === "unsupported" || permission === "granted") return null;

  const denied = permission === "denied";

  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
      {denied ? (
        <p>
          Lock-screen controls are blocked. Enable notifications for this app in
          your browser/site settings to control the timer from the lock screen.
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p>Control the timer from your lock screen?</p>
          <button
            onClick={onEnable}
            className="shrink-0 rounded-full bg-violet-500 px-4 py-1.5 font-medium text-white transition hover:bg-violet-600"
          >
            Enable
          </button>
        </div>
      )}
    </div>
  );
}
