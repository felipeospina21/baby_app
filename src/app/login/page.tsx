import { redirect } from "next/navigation";

import { AuthForm } from "~/app/_components/auth-form";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#1e1b4b] to-[#0f0f23] px-4 text-white">
      <AuthForm />
    </main>
  );
}
