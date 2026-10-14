"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/80 transition hover:bg-white/20 hover:text-white"
    >
      Sign out
    </button>
  );
}
