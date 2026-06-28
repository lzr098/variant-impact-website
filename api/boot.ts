import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { analyzeVariant } from "./services/variantAnalyzer";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Direct REST endpoint for variant analysis (bypasses tRPC routing issues in production)
app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const variant = body.variant;
    const options = body.options || {};
    if (!variant || typeof variant !== "string") {
      return c.json({ success: false, error: "Missing variant field" }, 400);
    }
    const result = await analyzeVariant(variant, options);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? "Unknown error" }, 500);
  }
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
