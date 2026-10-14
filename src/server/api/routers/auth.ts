import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { users } from "~/server/db/schema";

export const authRouter = createTRPCRouter({
  /**
   * Register a new email/password user. Rejects duplicate emails and stores a
   * bcrypt hash of the password (never the plaintext).
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        name: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();

      const existing = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists.",
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);

      const [created] = await ctx.db
        .insert(users)
        .values({
          email,
          name: input.name ?? null,
          hashedPassword,
        })
        .returning({ id: users.id, email: users.email });

      return { id: created!.id, email: created!.email };
    }),
});
