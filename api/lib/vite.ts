import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  // Serve static files only for non-API paths
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      return next();
    }
    return serveStatic({ root: "./dist/public" })(c, next);
  });

  app.notFound((c) => {
    // Never return HTML for API paths
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
