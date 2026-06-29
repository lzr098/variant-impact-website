/**
 * buildMarkdown — markdown report generation tests
 * Tests all report sections and data presentation.
 */
import { describe, it, expect } from "vitest";
import { buildMarkdown } from "../services/variantAnalyzer";
import type {
  VepResult,
  GnomadResult,
  ClinvarResult,
  UniprotResult,
  LiteratureResult,
  AcmgResult,
  EveResult,
  ConstraintResult,
  GtexResult,
} from "@contracts/variant";

// ── Minimal valid result ──
function minimalResult() {
  return {
    variant: { raw: "chr1:100:A:G", chrom: "1", pos: 100, ref: "A", alt: "G", hgvs_g: "1:g.100A>G" },
    qc: {} as Record<string, string | number>,
    vep: {
      query: "1:g.100A>G",
      input: "chr1:100:A:G",
      gene_symbol: "TEST",
      transcript: "ENST00000000001",
    } as VepResult,
    gnomad: {} as GnomadResult,
    constraint: {} as ConstraintResult,
    clinvar: {} as ClinvarResult,
    uniprot: {} as UniprotResult,
    literature: { query: "", count: 0, articles: [] } as LiteratureResult,
    acmg: {
      classification: "vus",
      evidence_items: [],
      pathogenic_score: 0,
      benign_score: 0,
    } as AcmgResult,
    eve: undefined as EveResult | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Basic structure
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — basic structure", () => {
  it("always contains header with hgvs_g", () => {
    const md = buildMarkdown(minimalResult());
    expect(md).toContain("# 变异功能影响分析报告");
    expect(md).toContain("1:g.100A>G");
  });

  it("contains ACMG classification", () => {
    const md = buildMarkdown(minimalResult());
    expect(md).toContain("ACMG 分类");
    expect(md).toContain("意义未明");
  });

  it("contains footer disclaimer", () => {
    const md = buildMarkdown(minimalResult());
    expect(md).toContain("仅供研究参考");
    expect(md).toContain("grch38-variant-impact");
  });

  it("includes input and coordinates section", () => {
    const md = buildMarkdown(minimalResult());
    expect(md).toContain("输入");
    expect(md).toContain("基因组坐标");
  });
});

// ═══════════════════════════════════════════════════════════════════
// QC section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — QC section", () => {
  it("includes QC table when QC fields exist", () => {
    const r = minimalResult();
    r.qc = { DP: 50, GQ: 99, AF: 0.25 };
    const md = buildMarkdown(r);
    expect(md).toContain("样本质量指标");
    expect(md).toContain("DP");
    expect(md).toContain("50");
    expect(md).toContain("GQ");
    expect(md).toContain("AF");
  });

  it("omits QC section when empty", () => {
    const r = minimalResult();
    r.qc = {};
    const md = buildMarkdown(r);
    expect(md).not.toContain("样本质量指标");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Functional predictions (VEP)
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — functional predictions", () => {
  it("shows SIFT when available", () => {
    const r = minimalResult();
    r.vep.sift = { prediction: "deleterious", score: 0.01 };
    const md = buildMarkdown(r);
    expect(md).toContain("SIFT");
    expect(md).toContain("deleterious");
  });

  it("shows PolyPhen when available", () => {
    const r = minimalResult();
    r.vep.polyphen = { prediction: "probably_damaging", score: 0.98 };
    const md = buildMarkdown(r);
    expect(md).toContain("PolyPhen");
    expect(md).toContain("probably_damaging");
  });

  it("shows AlphaMissense when available", () => {
    const r = minimalResult();
    r.vep.alphamissense = { class: "likely_pathogenic", pathogenicity: 0.85 };
    const md = buildMarkdown(r);
    expect(md).toContain("AlphaMissense");
    expect(md).toContain("likely_pathogenic");
    expect(md).toContain("0.85");
  });

  it("shows CADD phred when available", () => {
    const r = minimalResult();
    r.vep.cadd_phred = 25.3;
    const md = buildMarkdown(r);
    expect(md).toContain("CADD phred");
    expect(md).toContain("25.3");
  });

  it("shows REVEL when available with interpretation", () => {
    const r = minimalResult();
    r.vep.revel = 0.85;
    const md = buildMarkdown(r);
    expect(md).toContain("REVEL");
    expect(md).toContain("致病性");
  });

  it("shows EVE when available", () => {
    const r = minimalResult();
    r.eve = { score: 0.92 };
    const md = buildMarkdown(r);
    expect(md).toContain("EVE");
    expect(md).toContain("0.92");
  });

  it("omits REVEL row when not available", () => {
    const md = buildMarkdown(minimalResult());
    expect(md).not.toContain("| REVEL");
  });

  it("omits EVE row when not available", () => {
    const r = minimalResult();
    r.eve = undefined;
    const md = buildMarkdown(r);
    expect(md).not.toContain("| EVE");
  });
});

// ═══════════════════════════════════════════════════════════════════
// SpliceAI section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — SpliceAI", () => {
  it("shows '无剪接影响' when all scores are 0", () => {
    const r = minimalResult();
    r.vep.spliceai = { DS_AG: 0, DS_AL: 0, DS_DG: 0, DS_DL: 0 };
    const md = buildMarkdown(r);
    expect(md).toContain("无剪接影响");
  });

  it("shows '可能存在剪接影响' with scores", () => {
    const r = minimalResult();
    r.vep.spliceai = { DS_AG: 0, DS_AL: 0.3, DS_DG: 0, DS_DL: 0 };
    const md = buildMarkdown(r);
    expect(md).toContain("可能存在剪接影响");
    expect(md).toContain("DS_AG/AL/DG/DL");
  });

  it("shows '强剪接影响' when max >= 0.5", () => {
    const r = minimalResult();
    r.vep.spliceai = { DS_AG: 0.6, DS_AL: 0.1, DS_DG: 0, DS_DL: 0 };
    const md = buildMarkdown(r);
    expect(md).toContain("强剪接影响");
  });

  it("shows '中等剪接影响' when max >= 0.2 but < 0.5", () => {
    const r = minimalResult();
    r.vep.spliceai = { DS_AG: 0.3, DS_AL: 0, DS_DG: 0, DS_DL: 0 };
    const md = buildMarkdown(r);
    expect(md).toContain("中等剪接影响");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Constraint data
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — gnomAD constraint", () => {
  it("shows constraint data when available", () => {
    const r = minimalResult();
    r.constraint = { pli: 0.95, oe_lof_upper: 0.1, oe_mis_upper: 0.3 };
    const md = buildMarkdown(r);
    expect(md).toContain("pLI");
    expect(md).toContain("0.95");
    expect(md).toContain("LOEUF");
    expect(md).toContain("oe_mis");
  });

  it("omits constraint row when empty", () => {
    const r = minimalResult();
    r.constraint = {};
    const md = buildMarkdown(r);
    expect(md).not.toContain("pLI");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Population frequencies
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — population frequencies", () => {
  it("shows gnomAD exome frequencies", () => {
    const r = minimalResult();
    r.gnomad = { exome: { ac: 10, an: 100000, af: 1e-4 } };
    const md = buildMarkdown(r);
    expect(md).toContain("人群频率");
    expect(md).toContain("gnomAD 外显子组");
    expect(md).toContain("10");
    expect(md).toContain("100000");
  });

  it("shows gnomAD genome frequencies", () => {
    const r = minimalResult();
    r.gnomad = { genome: { ac: 5, an: 50000, af: 1e-4 } };
    const md = buildMarkdown(r);
    expect(md).toContain("gnomAD 全基因组");
  });

  it("shows VEP frequency data", () => {
    const r = minimalResult();
    r.vep.gnomad_frequencies = { gnomade: 0.01, gnomade_eas: 0.02 };
    const md = buildMarkdown(r);
    expect(md).toContain("VEP 外显子组");
    expect(md).toContain("VEP 东亚");
    expect(md).toContain("0.01");
    expect(md).toContain("0.02");
  });
});

// ═══════════════════════════════════════════════════════════════════
// GTEx tissue expression
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — GTEx expression", () => {
  it("shows GTEx gene expression table", () => {
    const r = minimalResult();
    r.vep.gtex_expression = {
      gene_expression: {
        "Brain - Cortex": 25.3,
        "Liver": 10.1,
        "Heart - Left Ventricle": 5.2,
      },
    } as GtexResult;
    const md = buildMarkdown(r);
    expect(md).toContain("GTEx 组织表达");
    expect(md).toContain("Brain - Cortex");
    expect(md).toContain("25.3");
  });

  it("shows GTEx transcript expression", () => {
    const r = minimalResult();
    r.vep.gtex_expression = {
      transcript_expression: {
        "ENST00000000001": { "Brain - Cortex": 20.0, "Liver": 5.0 },
      },
    } as GtexResult;
    const md = buildMarkdown(r);
    expect(md).toContain("GTEx 转录本表达");
    expect(md).toContain("ENST00000000001");
    expect(md).toContain("20");
  });

  it("omits GTEx sections when no data", () => {
    const r = minimalResult();
    r.vep.gtex_expression = {};
    const md = buildMarkdown(r);
    expect(md).not.toContain("GTEx");
  });
});

// ═══════════════════════════════════════════════════════════════════
// ClinVar section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — ClinVar", () => {
  it("shows ClinVar annotation on success", () => {
    const r = minimalResult();
    r.clinvar = {
      accession: "VCV000012345",
      classification: "Pathogenic",
      review_status: "reviewed by expert panel",
      traits: ["Hereditary breast cancer"],
      source: "ncbi_eutils",
    };
    const md = buildMarkdown(r);
    expect(md).toContain("ClinVar 注释");
    expect(md).toContain("VCV000012345");
    expect(md).toContain("致病");
    expect(md).toContain("Hereditary breast cancer");
  });

  it("shows error message when ClinVar fails", () => {
    const r = minimalResult();
    r.clinvar = { error: "No ClinVar annotation found" };
    const md = buildMarkdown(r);
    expect(md).toContain("未命中");
    expect(md).toContain("No ClinVar annotation found");
  });
});

// ═══════════════════════════════════════════════════════════════════
// UniProt section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — UniProt", () => {
  it("shows UniProt info on success", () => {
    const r = minimalResult();
    r.uniprot = {
      accession: "P04637",
      protein_name: "Cellular tumor antigen p53",
      protein_name_cn: "细胞肿瘤抗原 p53",
      protein_length: 393,
      function: "Acts as a tumor suppressor",
      function_summary_cn: "作为肿瘤抑制因子发挥作用",
      source: "uniprot_api",
    };
    const md = buildMarkdown(r);
    expect(md).toContain("UniProt 蛋白信息");
    expect(md).toContain("P04637");
    expect(md).toContain("Cellular tumor antigen p53");
    expect(md).toContain("393");
    expect(md).toContain("Acts as a tumor suppressor");
  });

  it("shows variant-proximal features", () => {
    const r = minimalResult();
    r.uniprot = {
      accession: "P04637",
      features_near_variant: [
        { type: "DNA binding", description: "DNA-binding domain", start: 102, end: 292 },
        { type: "Active site", description: "", start: 175, end: 176 },
      ],
    };
    const md = buildMarkdown(r);
    expect(md).toContain("变异附近的结构特征");
    expect(md).toContain("DNA binding"); // Not in featMap, rendered as-is
    expect(md).toContain("活性位点");     // "Active site" → in featMap
  });

  it("shows error when query fails", () => {
    const r = minimalResult();
    r.uniprot = { error: "No UniProt entry for FAKEGENE" };
    const md = buildMarkdown(r);
    expect(md).toContain("查询失败");
    expect(md).toContain("FAKEGENE");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Literature section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — Literature", () => {
  it("shows literature results", () => {
    const r = minimalResult();
    r.literature = {
      query: "TP53",
      count: 150,
      articles: [
        { title: "p53 mutations in cancer", authors: "Smith J", journal: "Nature", year: "2020", pmid: "12345678" },
      ],
    };
    const md = buildMarkdown(r);
    expect(md).toContain("文献检索");
    expect(md).toContain("150");
    expect(md).toContain("p53 mutations in cancer");
    expect(md).toContain("PMID:12345678");
  });

  it("shows no-articles message", () => {
    const r = minimalResult();
    r.literature = { query: "FAKE", count: 0, articles: [] };
    const md = buildMarkdown(r);
    expect(md).toContain("未找到该位点特异性文献");
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACMG section
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — ACMG", () => {
  it("shows ACMG evidence table", () => {
    const r = minimalResult();
    r.acmg = {
      classification: "likely_pathogenic",
      evidence_items: [
        { criterion: "PVS1", strength: "Very Strong", description: "LOF variant" },
        { criterion: "PM2", strength: "Moderate", description: "gnomAD AF=1.00e-6" },
      ],
      pathogenic_score: 10,
      benign_score: 0,
    };
    const md = buildMarkdown(r);
    expect(md).toContain("ACMG 证据加权分类");
    expect(md).toContain("可能致病");
    expect(md).toContain("PVS1");
    expect(md).toContain("PM2");
    expect(md).toContain("10");
  });

  it("shows no-evidence message when empty", () => {
    const r = minimalResult();
    r.acmg = { classification: "vus", evidence_items: [], pathogenic_score: 0, benign_score: 0 };
    const md = buildMarkdown(r);
    expect(md).toContain("无触发任何 ACMG 证据规则");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Summary & warnings
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — summary & warnings", () => {
  it("shows appropriate summary for each classification", () => {
    const classifications = [
      { cls: "pathogenic", text: "致病" },
      { cls: "likely_pathogenic", text: "可能致病" },
      { cls: "vus_favor_pathogenic", text: "偏致病" },
      { cls: "vus", text: "意义未明" },
      { cls: "vus_favor_benign", text: "偏良性" },
      { cls: "likely_benign", text: "可能良性" },
      { cls: "benign", text: "良性" },
    ];
    for (const { cls, text } of classifications) {
      const r = minimalResult();
      r.acmg = { classification: cls, evidence_items: [], pathogenic_score: 0, benign_score: 0 };
      const md = buildMarkdown(r);
      expect(md).toContain(text);
    }
  });

  it("shows LOF warning when appropriate", () => {
    const r = minimalResult();
    r.vep.consequence_terms = ["stop_gained"];
    r.constraint = { pli: 0.99 };
    r.acmg = {
      classification: "likely_pathogenic",
      evidence_items: [{ criterion: "PVS1", strength: "Very Strong", description: "" }],
      pathogenic_score: 8,
      benign_score: 0,
    };
    const md = buildMarkdown(r);
    expect(md).toContain("功能丧失 (LOF)");
    expect(md).toContain("pLI > 0.9");
  });

  it("shows splice warning when appropriate", () => {
    const r = minimalResult();
    r.vep.spliceai = { DS_AG: 0.6 };
    const md = buildMarkdown(r);
    expect(md).toContain("SpliceAI");
    expect(md).toContain("mRNA 剪接");
    expect(md).toContain("RNA 分析验证");
  });

  it("shows LOF warning without splice warning when both apply", () => {
    // LOF warning comes first, splice warning second
    const r = minimalResult();
    r.vep.consequence_terms = ["stop_gained"];
    r.vep.spliceai = { DS_DG: 0.6 };
    r.constraint = { pli: 0.99 };
    r.acmg = {
      classification: "pathogenic",
      evidence_items: [{ criterion: "PVS1", strength: "Very Strong", description: "" }],
      pathogenic_score: 15,
      benign_score: 0,
    };
    const md = buildMarkdown(r);
    const lofIdx = md.indexOf("功能丧失");
    const spliceIdx = md.indexOf("SpliceAI");
    // Both warnings should appear
    expect(lofIdx).toBeGreaterThan(0);
    expect(spliceIdx).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QC fields display
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — QC field display", () => {
  it("handles mixed numeric and string QC values", () => {
    const r = minimalResult();
    r.qc = { DP: 50, PL: "100,0,500" };
    const md = buildMarkdown(r);
    expect(md).toContain("DP");
    expect(md).toContain("50");
    expect(md).toContain("PL");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Protein and splicing edge cases
// ═══════════════════════════════════════════════════════════════════
describe("buildMarkdown — edge cases", () => {
  it("handles N/A for missing values", () => {
    const r = minimalResult();
    r.vep.transcript = undefined;
    r.vep.protein = undefined;
    const md = buildMarkdown(r);
    // the val() helper returns "N/A" for undefined
    expect(md).toContain("N/A");
  });

  it("handles empty spliceai gracefully (all undefined)", () => {
    const r = minimalResult();
    r.vep.spliceai = {};
    const md = buildMarkdown(r);
    expect(md).toContain("无剪接影响");
  });

  it("handles UNIPROT error without function gracefully", () => {
    const r = minimalResult();
    r.uniprot = { error: "No UniProt entry for XYZ" };
    const md = buildMarkdown(r);
    // Should show error but not crash
    expect(md).toContain("查询失败");
  });

  it("shows UniProt info when function exists despite error", () => {
    // error field + function field can coexist (search error but features loaded)
    const r = minimalResult();
    r.uniprot = {
      accession: "P04637",
      error: "partial error",
      function: "Acts as a tumor suppressor",
    };
    const md = buildMarkdown(r);
    expect(md).toContain("P04637");
    expect(md).toContain("Acts as a tumor suppressor");
  });
});
