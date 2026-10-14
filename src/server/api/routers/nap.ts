import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { naps } from "~/server/db/schema";

/** Reject ranges where the nap ends before it starts. */
const endAfterStart = (data: { startTime: Date; endTime: Date }) =>
  data.endTime.getTime() >= data.startTime.getTime();

export const napRouter = createTRPCRouter({
  /**
   * Persist a completed nap. Naps are tracked client-side (local-first) and
   * written here once, on stop — so start and end times are always provided.
   */
  create: protectedProcedure
    .input(
      z
        .object({
          startTime: z.coerce.date(),
          endTime: z.coerce.date(),
          note: z.string().max(256).optional(),
        })
        .refine(endAfterStart, {
          message: "End time must be after start time",
          path: ["endTime"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(naps)
        .values({
          userId: ctx.session.user.id,
          startTime: input.startTime,
          endTime: input.endTime,
          note: input.note,
        })
        .returning();
      return created;
    }),

  /** Edit the times/note of one of the current user's naps. */
  update: protectedProcedure
    .input(
      z
        .object({
          id: z.number().int(),
          startTime: z.coerce.date(),
          endTime: z.coerce.date(),
          note: z.string().max(256).nullable().optional(),
        })
        .refine(endAfterStart, {
          message: "End time must be after start time",
          path: ["endTime"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(naps)
        .set({
          startTime: input.startTime,
          endTime: input.endTime,
          note: input.note ?? null,
        })
        .where(
          and(eq(naps.id, input.id), eq(naps.userId, ctx.session.user.id)),
        )
        .returning();
      return updated ?? null;
    }),

  /** Delete one of the current user's naps. */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(naps)
        .where(
          and(eq(naps.id, input.id), eq(naps.userId, ctx.session.user.id)),
        );
      return { id: input.id };
    }),

  /** The current user's most recent naps, newest first. */
  getHistory: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(30) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 30;
      return ctx.db.query.naps.findMany({
        where: eq(naps.userId, ctx.session.user.id),
        orderBy: [desc(naps.startTime)],
        limit,
      });
    }),
});
