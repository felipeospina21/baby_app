import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sleepSessions, sleepSplits } from "~/server/db/schema";

/** Reject ranges where the end is before the start. */
const endAfterStart = (data: { startTime: Date; endTime: Date }) =>
  data.endTime.getTime() >= data.startTime.getTime();

/** A wake-up interval sent from the client. `endTime` null => still awake. */
const splitInput = z.object({
  startTime: z.coerce.date(),
  endTime: z.coerce.date().nullable(),
  note: z.string().max(256).nullable().optional(),
});

export const sleepRouter = createTRPCRouter({
  /**
   * Persist a completed night-sleep session together with its wake-up splits.
   * Like naps, sleep is tracked client-side (local-first) and written here once
   * on stop, so start and end are always provided. Splits are inserted in the
   * same transaction so a session never persists without its wake-ups.
   */
  create: protectedProcedure
    .input(
      z
        .object({
          startTime: z.coerce.date(),
          endTime: z.coerce.date(),
          note: z.string().max(256).optional(),
          splits: z.array(splitInput).max(100).default([]),
        })
        .refine(endAfterStart, {
          message: "End time must be after start time",
          path: ["endTime"],
        })
        .refine(
          (d) =>
            d.splits.every(
              (s) =>
                s.endTime === null ||
                s.endTime.getTime() >= s.startTime.getTime(),
            ),
          { message: "Each wake-up must end after it starts", path: ["splits"] },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [session] = await tx
          .insert(sleepSessions)
          .values({
            userId: ctx.session.user.id,
            startTime: input.startTime,
            endTime: input.endTime,
            note: input.note,
          })
          .returning();

        if (!session) throw new Error("Failed to create sleep session");

        if (input.splits.length > 0) {
          await tx.insert(sleepSplits).values(
            input.splits.map((s) => ({
              sessionId: session.id,
              startTime: s.startTime,
              endTime: s.endTime,
              note: s.note ?? null,
            })),
          );
        }

        return session;
      });
    }),

  /**
   * Edit the top-level times/note of one of the current user's sleep sessions.
   * (Editing individual splits is handled separately if/when the UI needs it.)
   */
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
        .update(sleepSessions)
        .set({
          startTime: input.startTime,
          endTime: input.endTime,
          note: input.note ?? null,
        })
        .where(
          and(
            eq(sleepSessions.id, input.id),
            eq(sleepSessions.userId, ctx.session.user.id),
          ),
        )
        .returning();
      return updated ?? null;
    }),

  /** Delete one of the current user's sleep sessions (splits cascade). */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(sleepSessions)
        .where(
          and(
            eq(sleepSessions.id, input.id),
            eq(sleepSessions.userId, ctx.session.user.id),
          ),
        );
      return { id: input.id };
    }),

  /** The current user's most recent sleep sessions, newest first, with splits. */
  getHistory: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(30) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 30;
      return ctx.db.query.sleepSessions.findMany({
        where: eq(sleepSessions.userId, ctx.session.user.id),
        orderBy: [desc(sleepSessions.startTime)],
        limit,
        with: {
          splits: true,
        },
      });
    }),
});
