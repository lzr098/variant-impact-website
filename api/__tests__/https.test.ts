import { describe, it, expect, vi, beforeEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import { httpsRequest } from "../lib/https";

// ponytail: mock https.request so we never touch the network in unit tests.
function mockRequest(opts: {
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
  location?: string;
}) {
  const statusCode = opts.statusCode ?? 200;
  const body = opts.body ?? "";
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  res.headers = { ...(opts.headers || {}), ...(opts.location ? { location: opts.location } : {}) };
  const req = new EventEmitter() as any;
  req.write = vi.fn();
  req.end = vi.fn();
  req.setTimeout = vi.fn((ms: number, cb: () => void) => { (req as any)._timeoutCb = cb; });
  req.destroy = vi.fn();

  const spy = vi.spyOn(https, "request").mockImplementation((reqOpts: any, cb: (res: any) => void) => {
    // Verify TLS settings are NOT locked to 1.2
    expect(reqOpts.minVersion).not.toBe("TLSv1.2");
    expect(reqOpts.maxVersion).not.toBe("TLSv1.2");
    // Verify User-Agent is set
    expect(reqOpts.headers["User-Agent"]).toBeTruthy();
    cb(res);
    // Emit body asynchronously
    setImmediate(() => {
      if (body) res.emit("data", body);
      res.emit("end");
    });
    return req;
  });
  return { req, res, spy };
}

// Helper: create a fake req object with all methods the real http.ClientRequest has
function makeFakeReq() {
  const r = new EventEmitter() as any;
  r.write = vi.fn();
  r.end = vi.fn();
  r.setTimeout = vi.fn();
  r.destroy = vi.fn();
  return r;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("httpsRequest", () => {
  it("parses JSON response on 200", async () => {
    mockRequest({ body: JSON.stringify({ ok: true }) });
    const result = await httpsRequest<any>("https://example.com/test");
    expect(result).toEqual({ ok: true });
  });

  it("rejects on non-2xx non-3xx status", async () => {
    mockRequest({ statusCode: 403, body: "forbidden" });
    await expect(httpsRequest("https://example.com/test")).rejects.toThrow(/HTTP 403/);
  });

  it("follows 3xx redirects", async () => {
    let callCount = 0;
    const spy = vi.spyOn(https, "request").mockImplementation((reqOpts: any, cb: (res: any) => void) => {
      callCount++;
      const res = new EventEmitter() as any;
      const req = makeFakeReq();
      if (callCount === 1) {
        res.statusCode = 302;
        res.headers = { location: "https://other.com/final" };
        cb(res);
        setImmediate(() => res.emit("end"));
      } else {
        res.statusCode = 200;
        res.headers = {};
        cb(res);
        setImmediate(() => {
          res.emit("data", JSON.stringify({ redirected: true }));
          res.emit("end");
        });
      }
      return req;
    });
    const result = await httpsRequest<any>("https://example.com/test");
    expect(callCount).toBe(2);
    expect(result).toEqual({ redirected: true });
    spy.mockRestore();
  });

  it("does NOT lock TLS to 1.2 (regression test for GTEx failure)", async () => {
    mockRequest({ body: "{}" });
    await httpsRequest("https://gtexportal.org/api/v2/test");
    // mockRequest's spy asserts minVersion/maxVersion are not "TLSv1.2"
  });

  it("sends User-Agent header", async () => {
    mockRequest({ body: "{}" });
    await httpsRequest("https://example.com/test");
    // mockRequest's spy asserts User-Agent is truthy
  });
});
