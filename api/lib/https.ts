/**
 * Node.js https request helper.
 * Uses the native https module which respects system TLS settings
 * (more compatible with servers that have strict SSL configurations).
 */

import https from "node:https";
import { URL } from "node:url";

export function httpsRequest<T>(url: string, options?: { method?: string; body?: string; headers?: Record<string, string>; timeout?: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options?.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options?.headers || {}),
      },
      // Use system default TLS settings (same as curl)
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
    };

    const timeoutMs = options?.timeout || 15000;
    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}
