import { redirect } from "next/navigation";

import { NapHistory } from "~/app/_components/nap-history";
import { NapTimer } from "~/app/_components/nap-timer";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

// This page reads live nap data from the database on each request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Warm the cache so the history query resolves instantly on the client.
  void api.nap.getHistory.prefetch({ limit: 30 });

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-[#1e1b4b] to-[#0f0f23] px-4 py-10 text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          <header className="flex w-full items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Nap Tracker
              </h1>
              <p className="text-xs text-white/50">
                {session.user.email ?? session.user.name}
              </p>
            </div>
            <SignOutButton />
          </header>

          <NapTimer />
          <NapHistory />
        </div>
      </main>
    </HydrateClient>
  );
}
