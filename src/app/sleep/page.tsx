import { redirect } from "next/navigation";

import { ModuleNav } from "~/app/_components/module-nav";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { SleepHistory } from "~/app/_components/sleep-history";
import { SleepTimer } from "~/app/_components/sleep-timer";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

// This page reads live sleep data from the database on each request.
export const dynamic = "force-dynamic";

export default async function SleepPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Warm the cache so the history query resolves instantly on the client.
  void api.sleep.getHistory.prefetch({ limit: 30 });

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-[#1e1b4b] to-[#0f0f23] px-4 py-10 text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          <header className="flex w-full items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Night Sleep
              </h1>
              <p className="text-xs text-white/50">
                {session.user.email ?? session.user.name}
              </p>
            </div>
            <SignOutButton />
          </header>

          <ModuleNav />
          <SleepTimer />
          <SleepHistory />
        </div>
      </main>
    </HydrateClient>
  );
}
