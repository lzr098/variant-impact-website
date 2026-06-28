import { describe, it, expect, vi, beforeEach } from "vitest";

// ponytail: mock the https module so queryGtex never hits the network.

vi.mock("../lib/https", () => ({
  httpsRequest: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("queryGtex", () => {
  it("returns undefined when geneSymbol is undefined", async () => {
    const { queryGtex } = await import("../services/variantAnalyzer");
    expect(await queryGtex(undefined)).toBeUndefined();
  });

  it("returns undefined when gene search returns no data", async () => {
    const { httpsRequest } = await import("../lib/https");
    (httpsRequest as any).mockResolvedValue({ data: [] });

    const { queryGtex } = await import("../services/variantAnalyzer");
    expect(await queryGtex("FAKEGENE")).toBeUndefined();
  });

  it("returns gene + transcript expression on success", async () => {
    const { httpsRequest } = await import("../lib/https");
    const mock = httpsRequest as any;
    // Call 1: gene search -> gencodeId
    // Call 2: gene expression
    // Call 3: transcript expression
    mock
      .mockResolvedValueOnce({ data: [{ gencodeId: "ENSG00000012048.20" }] })
      .mockResolvedValueOnce({
        data: [
          { tissueSiteDetailId: "Adipose_Subcutaneous", median: 1.5 },
          { tissueSiteDetailId: "Brain_Cortex", median: 8.2 },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          { transcriptId: "ENST00000357654.9", tissueSiteDetailId: "Brain_Cortex", median: 7.1 },
        ],
      });

    const { queryGtex } = await import("../services/variantAnalyzer");
    const result = await queryGtex("BRCA1");

    expect(result).toBeDefined();
    expect(result!.gene_expression).toBeDefined();
    expect(result!.gene_expression!["Adipose - Subcutaneous"]).toBe(1.5);
    expect(result!.gene_expression!["Brain - Cortex"]).toBe(8.2);
    expect(result!.transcript_expression).toBeDefined();
    expect(result!.transcript_expression!["ENST00000357654.9"]!["Brain - Cortex"]).toBe(7.1);
  });

  it("logs error and returns undefined when gene search throws", async () => {
    const { httpsRequest } = await import("../lib/https");
    (httpsRequest as any).mockRejectedValue(new Error("TLS handshake failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { queryGtex } = await import("../services/variantAnalyzer");
    const result = await queryGtex("BRCA1");

    expect(result).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("[GTEx]"), expect.any(String));
    errSpy.mockRestore();
  });

  it("converts tissueSiteDetailId snake_case to display format", async () => {
    const { httpsRequest } = await import("../lib/https");
    const mock = httpsRequest as any;
    mock
      .mockResolvedValueOnce({ data: [{ gencodeId: "ENSG1.1" }] })
      .mockResolvedValueOnce({
        data: [{ tissueSiteDetailId: "Brain_Cerebellar_Hemisphere", median: 3.0 }],
      })
      .mockResolvedValueOnce({ data: [] });

    const { queryGtex } = await import("../services/variantAnalyzer");
    const result = await queryGtex("GENE1");
    expect(result!.gene_expression!["Brain - Cerebellar - Hemisphere"]).toBe(3.0);
  });
});
