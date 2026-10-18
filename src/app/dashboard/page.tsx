import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardTabs } from "~/app/_components/dashboard-tabs";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

// Reads live nap + sleep data from the database on each request.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Warm both caches so either tab resolves instantly on the client.
  void api.sleep.getHistory.prefetch({ limit: 30 });
  void api.nap.getHistory.prefetch({ limit: 100 });

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-[#1e1b4b] to-[#0f0f23] px-4 py-10 text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          <header className="flex w-full items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Dashboard
              </h1>
              <p className="text-xs text-white/50">
                {session.user.email ?? session.user.name}
              </p>
            </div>
            <SignOutButton />
          </header>

          <nav className="flex w-full items-center justify-between gap-2 text-sm">
            <Link
              href="/"
              className="text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
            >
              ← Naps
            </Link>
            <Link
              href="/sleep"
              className="text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
            >
              Night Sleep →
            </Link>
          </nav>

          <DashboardTabs />
        </div>
      </main>
    </HydrateClient>
  );
}
