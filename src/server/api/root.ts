import { authRouter } from "~/server/api/routers/auth";
import { napRouter } from "~/server/api/routers/nap";
import { sleepRouter } from "~/server/api/routers/sleep";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  nap: napRouter,
  sleep: sleepRouter,
  auth: authRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.nap.getHistory();
 *       ^? Nap[]
 */
export const createCaller = createCallerFactory(appRouter);
