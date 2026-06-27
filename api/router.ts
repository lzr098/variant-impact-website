import { createRouter, publicQuery } from "./middleware";
import { variantRouter } from "./routers/variant";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  variant: variantRouter,
});

export type AppRouter = typeof appRouter;
