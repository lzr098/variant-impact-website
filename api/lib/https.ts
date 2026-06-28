/**
 * Node.js https request helper.
 * Uses system default TLS (supports TLS 1.3), follows redirects, sends User-Agent.
 */
import https from "node:https";
import { URL } from "node:url";

export function httpsRequest<T>(
  url: string,
  options?: { method?: string; body?: string; headers?: Record<string, string>; timeout?: number; maxRedirects?: number }
): Promise<T> {
  const maxRedirects = options?.maxRedirects ?? 5;
  return doRequest<T>(url, options, maxRedirects, maxRedirects);
}

function doRequest<T>(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string>; timeout?: number } | undefined,
  redirectsLeft: number,
  maxRedirects: number
): Promise<T> {
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
        "User-Agent": "VariantImpactAnalyzer/1.0",
        ...(options?.headers || {}),
      },
      // ponytail: system default TLS — supports 1.2 and 1.3, do NOT lock to 1.2
    };

    const timeoutMs = options?.timeout || 15000;
    const req = https.request(reqOptions, (res) => {
      // Follow 3xx redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects (max ${maxRedirects})`));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).href;
        resolve(doRequest<T>(nextUrl, options, redirectsLeft - 1, maxRedirects));
        return;
      }
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
      reject(new Error(`Request timeout after ${timeoutMs}ms: ${url}`));
    });

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}
