/**
 * parseVariant — input parser tests
 * Covers all supported variant input formats and edge cases.
 */
import { describe, it, expect } from "vitest";
import { parseVariant } from "../services/variantAnalyzer";

// ═══════════════════════════════════════════════════════════════════
// 1. SNV — colon-separated
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — SNV colon-separated", () => {
  it("chr:pos:ref:alt format", () => {
    const v = parseVariant("chr13:32363294:G:A");
    expect(v.chrom).toBe("13");
    expect(v.pos).toBe(32363294);
    expect(v.ref).toBe("G");
    expect(v.alt).toBe("A");
    expect(v.hgvs_g).toBe("13:g.32363294G>A");
  });

  it("chr:pos:ref:alt without chr prefix", () => {
    const v = parseVariant("7:117559592:C:T");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("T");
  });

  it("pos:ref:alt without chromosome (3 tokens)", () => {
    const v = parseVariant("117559592:C:G");
    expect(v.chrom).toBe("");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("G");
  });

  it("lowercase bases are normalized", () => {
    const v = parseVariant("chr1:100:a:g");
    expect(v.ref).toBe("A");
    expect(v.alt).toBe("G");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. SNV — ref>alt / space-separated
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — ref>alt / space-separated", () => {
  it("chr:pos ref>alt", () => {
    const v = parseVariant("chr12:25245350 C>T");
    expect(v.chrom).toBe("12");
    expect(v.pos).toBe(25245350);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("T");
  });

  it("chr pos ref>alt (space, no colon)", () => {
    const v = parseVariant("chr11 121567110 C>G");
    expect(v.chrom).toBe("11");
    expect(v.pos).toBe(121567110);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("G");
  });

  it("pos ref>alt without chromosome", () => {
    const v = parseVariant("121567110 C>G");
    expect(v.chrom).toBe("");
    expect(v.pos).toBe(121567110);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("G");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. HGVS 严格格式
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — strict HGVS", () => {
  it("chrN:g.pos ref>alt", () => {
    const v = parseVariant("7:g.117559592C>T");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("T");
    expect(v.hgvs_g).toBe("7:g.117559592C>T");
  });

  it("chr prefix + HGVS", () => {
    const v = parseVariant("chr7:g.117559592C>T");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("T");
  });

  it("chr:g.pos ref>alt (space before ref>alt) — now supported", () => {
    const v = parseVariant("chr11:g.121567110 C>G");
    expect(v.chrom).toBe("11");
    expect(v.pos).toBe(121567110);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("G");
    expect(v.hgvs_g).toBe("11:g.121567110C>G");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. HGVS 缺失 (del)
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — HGVS deletion", () => {
  it("range deletion without sequence", () => {
    const v = parseVariant("7:g.117559591_117559593del");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559591);
    expect(v.ref).toBe("-");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toBe("7:g.117559591_117559593del");
  });

  it("range deletion with sequence", () => {
    const v = parseVariant("7:g.117559591_117559593delCTT");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559591);
    expect(v.ref).toBe("CTT");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toBe("7:g.117559591_117559593delCTT");
  });

  it("single-base deletion", () => {
    const v = parseVariant("7:g.117559592del");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("-");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toBe("7:g.117559592del");
  });

  it("single-base deletion with sequence", () => {
    const v = parseVariant("7:g.117559592delC");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("C");
    expect(v.alt).toBe("-");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. HGVS 插入 (ins)
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — HGVS insertion", () => {
  it("range insertion", () => {
    const v = parseVariant("7:g.117559591_117559592insA");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559591);
    expect(v.ref).toBe("-");
    expect(v.alt).toBe("A");
    expect(v.hgvs_g).toBe("7:g.117559591_117559592insA");
  });

  it("single position insertion", () => {
    const v = parseVariant("7:g.117559592insT");
    expect(v.chrom).toBe("7");
    expect(v.pos).toBe(117559592);
    expect(v.alt).toBe("T");
  });

  it("multi-base insertion with chr prefix", () => {
    const v = parseVariant("chr7:g.117559591_117559592insATCG");
    expect(v.chrom).toBe("7");
    expect(v.alt).toBe("ATCG");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. VCF 风格插入/缺失自动转换
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — VCF-style auto-conversion (del/ins)", () => {
  it("VCF deletion (ref longer than alt, shared prefix)", () => {
    const v = parseVariant("chr7:117559591:CTTT:C");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("TTT");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toBe("7:g.117559592_117559594delTTT");
  });

  it("VCF insertion (alt longer than ref, shared prefix)", () => {
    const v = parseVariant("chr7:117559591:C:CTTTT");
    expect(v.pos).toBe(117559592);
    expect(v.ref).toBe("-");
    expect(v.alt).toBe("TTTT");
    expect(v.hgvs_g).toContain("ins");
  });

  it("VCF multi-base insertion", () => {
    const v = parseVariant("chr7:117559591:C:CGATCG");
    expect(v.ref).toBe("-");
    expect(v.alt).toBe("GATCG");
  });

  it("VCF large deletion", () => {
    const v = parseVariant("chr1:1000:GCTAG:G");
    expect(v.pos).toBe(1001);
    expect(v.ref).toBe("CTAG");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toBe("1:g.1001_1004delCTAG");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. rsID
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — rsID", () => {
  it("lowercase rsID", () => {
    const v = parseVariant("rs113993960");
    expect(v.rsid).toBe("rs113993960");
    expect(v.chrom).toBe("");
    expect(v.pos).toBe(0);
    expect(v.hgvs_g).toBe("");
  });

  it("uppercase RS prefix normalizes", () => {
    const v = parseVariant("RS113993960");
    expect(v.rsid).toBe("rs113993960");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. NM_:c. 编码区 HGVS
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — NM_:c.", () => {
  it("coding HGVS", () => {
    const v = parseVariant("NM_000492.4:c.1521_1523delCTT");
    expect(v.hgvs_g).toBe("NM_000492.4:c.1521_1523delCTT");
    expect(v.chrom).toBe("");
    expect(v.pos).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. VCF tab-separated
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — VCF tab-separated", () => {
  it("basic VCF line", () => {
    const v = parseVariant("chr13\t32363294\t.\tG\tA\t100\tPASS\t.");
    expect(v.chrom).toBe("13");
    expect(v.pos).toBe(32363294);
    expect(v.ref).toBe("G");
    expect(v.alt).toBe("A");
  });

  it("VCF with QC fields (DP, GQ)", () => {
    const v = parseVariant("chr13\t32363294\t.\tG\tA\t.\tPASS\tDP=50\tGQ=99");
    expect(v.ref).toBe("G");
    expect(v.alt).toBe("A");
    expect(v.qc).toBeDefined();
    expect(v.qc!["DP"]).toBe(50);
    expect(v.qc!["GQ"]).toBe(99);
  });

  it("VCF with AF field", () => {
    const v = parseVariant("chr1\t12345\t.\tA\tG\t.\tPASS\tAF=0.25");
    expect(v.qc!["AF"]).toBe(0.25);
  });

  it("VCF with missing fields", () => {
    const v = parseVariant("chr1\t12345\t.\tA\tG\t.\t.");
    expect(v.chrom).toBe("1");
    expect(v.pos).toBe(12345);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Edge cases / errors
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — edge cases & errors", () => {
  it("throws on empty string", () => {
    expect(() => parseVariant("")).toThrow();
  });

  it("throws on whitespace-only", () => {
    expect(() => parseVariant("   ")).toThrow();
  });

  it("throws on invalid position", () => {
    expect(() => parseVariant("chr1:abc:A:G")).toThrow();
  });

  it("throws on incomplete format", () => {
    expect(() => parseVariant("chr1:100:A")).toThrow();
  });

  it("throws on unsupported format", () => {
    expect(() => parseVariant("this is not a valid variant")).toThrow(/Unsupported variant format/);
  });

  it("throws on VCF with invalid position", () => {
    expect(() => parseVariant("chr1\tabc\t.\tA\tG")).toThrow(/Invalid VCF position/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Real-world variant examples (BRCA1, CFTR)
// ═══════════════════════════════════════════════════════════════════
describe("parseVariant — real variants", () => {
  it("BRCA1 c.68_69delAG (rsID)", () => {
    const v = parseVariant("rs80357914");
    expect(v.rsid).toBe("rs80357914");
  });

  it("CFTR ΔF508 (chr:pos:ref:alt)", () => {
    const v = parseVariant("chr7:117559591:CTTT:C");
    expect(v.chrom).toBe("7");
    expect(v.ref).toBe("TTT");
    expect(v.alt).toBe("-");
    expect(v.hgvs_g).toContain("del");
  });

  it("BRCA2 nonsense", () => {
    const v = parseVariant("chr13:32363294:G:A");
    expect(v.chrom).toBe("13");
    expect(v.pos).toBe(32363294);
    expect(v.ref).toBe("G");
    expect(v.alt).toBe("A");
  });
});
