"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { api } from "~/trpc/react";

type Mode = "signin" | "signup";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const register = api.auth.register.useMutation();

  const signInWithCredentials = async () => {
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (res?.error) {
      setError("Invalid email or password.");
      return false;
    }
    return true;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await register.mutateAsync({
          email,
          password,
          name: name.trim() ? name.trim() : undefined,
        });
      }
      const ok = await signInWithCredentials();
      if (ok) {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      // tRPC errors (e.g. duplicate email, password too short) surface here.
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white/10 p-6 shadow-lg backdrop-blur">
      <h1 className="text-center text-2xl font-bold text-white">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-1 text-center text-sm text-white/60">
        {mode === "signin"
          ? "Welcome back — sign in to see your naps."
          : "Set up a login to start tracking naps."}
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        {mode === "signup" && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg bg-white/10 px-4 py-2 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-violet-400"
          />
        )}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg bg-white/10 px-4 py-2 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-violet-400"
        />
        <input
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"}
          value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg bg-white/10 px-4 py-2 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-violet-400"
        />

        {error && (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-full bg-violet-500 px-6 py-3 font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50"
        >
          {submitting
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="mt-4 w-full text-center text-sm text-white/60 underline decoration-dotted underline-offset-4 hover:text-white"
      >
        {mode === "signin"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
