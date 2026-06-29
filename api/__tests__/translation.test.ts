import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ponytail: test the dict fallback path directly (LLM path needs network).
// We test the internal translateByDict via the public API by forcing LLM to be unavailable.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Force LLM off so translateFunction falls back to dictionary
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_ENDPOINT;
  // Mock free API to fail, so dict is the fallback
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("free api unavailable"));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("translateProteinName", () => {
  it("translates known protein name terms", async () => {
    const { translateProteinName } = await import("../services/translation");
    const result = translateProteinName("Breast cancer type 1 susceptibility protein");
    expect(result).toBeTruthy();
    // "protein" -> "蛋白" should be in the result
    expect(result).toContain("蛋白");
  });

  it("returns undefined when nothing matches", async () => {
    const { translateProteinName } = await import("../services/translation");
    expect(translateProteinName("Unknown xyzq")).toBeUndefined();
  });

  it("returns undefined for empty input", async () => {
    const { translateProteinName } = await import("../services/translation");
    expect(translateProteinName(undefined)).toBeUndefined();
    expect(translateProteinName("")).toBeUndefined();
  });
});

describe("translateFunction (dict fallback)", () => {
  it("translates common biology phrases", async () => {
    const { translateFunction } = await import("../services/translation");
    const result = await translateFunction("This protein plays a role in dna repair and homologous recombination.");
    expect(result).toBeTruthy();
    expect(result).toContain("DNA 修复");
    expect(result).toContain("同源重组");
  });

  it("respects word boundaries — 'is' must not corrupt 'histone'", async () => {
    const { translateFunction } = await import("../services/translation");
    const result = await translateFunction("histone modification is important for transcriptional regulation.");
    // 'is' is NOT in our dict, so it should not be replaced. But verify no short key
    // corrupts a longer word. "transcriptional regulation" -> contains "转录调控".
    expect(result).toBeTruthy();
    // histone should remain intact (no Chinese char inserted into the middle of it)
    expect(result).not.toMatch(/h[^\x00-\x7F]+tone/);
  });

  it("handles regex special characters in dict keys without throwing", async () => {
    const { translateFunction } = await import("../services/translation");
    // Keys like "g protein-coupled receptor" contain hyphen — should not throw
    const result = await translateFunction("This is a g protein-coupled receptor involved in signal transduction.");
    expect(result).toBeTruthy();
  });

  it("returns undefined for short strings", async () => {
    const { translateFunction } = await import("../services/translation");
    expect(await translateFunction("short")).toBeUndefined();
    expect(await translateFunction(undefined)).toBeUndefined();
  });

  it("returns undefined when no terms match", async () => {
    const { translateFunction } = await import("../services/translation");
    // Use gibberish that matches zero dictionary entries
    expect(await translateFunction("xyzq abcde fghij klmno pqrst uvwxy zzzzz 12345.")).toBeUndefined();
  });
});

describe("translateFunction (LLM path)", () => {
  it("calls LLM when LLM_API_KEY is set", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_ENDPOINT = "https://fake-llm.test/v1/chat";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "这是LLM翻译的结果。" } }],
        }),
        text: async () => "",
      } as any;
    });

    const { translateFunction } = await import("../services/translation");
    const result = await translateFunction("Some protein function description text here.");
    expect(result).toBe("这是LLM翻译的结果。");
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("falls back to dict when LLM fails", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_ENDPOINT = "https://fake-llm.test/v1/chat";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { translateFunction } = await import("../services/translation");
    const result = await translateFunction("plays a role in dna repair.");
    // Should fall back to dict — "dna repair" -> "DNA 修复"
    expect(result).toContain("DNA 修复");
    fetchSpy.mockRestore();
  });
});
