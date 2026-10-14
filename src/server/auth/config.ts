import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "~/server/db";
import { env } from "~/env";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "~/server/db/schema";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

/** Shape of credentials submitted on the sign-in form. */
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Options for NextAuth.js. Uses email/password (Credentials) auth with JWT
 * sessions — the Credentials provider is incompatible with database sessions.
 *
 * @see https://authjs.dev/getting-started/authentication/credentials
 */
export const authConfig = {
  // Explicitly provide the secret used to sign/encrypt the session JWT so it
  // never falls back to undefined regardless of how env is loaded.
  secret: env.AUTH_SECRET,
  trustHost: true,
  // The adapter is retained so NextAuth can read user records; sessions
  // themselves are stored in a JWT, not the sessions table.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (!user?.hashedPassword) return null;

        const valid = await bcrypt.compare(password, user.hashedPassword);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    // Persist the user id onto the JWT at sign-in.
    jwt: ({ token, user }) => {
      if (user) token.id = user.id;
      return token;
    },
    // Expose the user id on the session object.
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: (token.id as string | undefined) ?? session.user.id,
      },
    }),
  },
} satisfies NextAuthConfig;
