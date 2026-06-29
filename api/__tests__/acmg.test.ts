/**
 * buildAcmgEvidence — ACMG evidence engine tests
 * Tests all ACMG rules against constructed inputs.
 */
import { describe, it, expect } from "vitest";
import { buildAcmgEvidence } from "../services/variantAnalyzer";
import type {
  VepResult,
  GnomadResult,
  ClinvarResult,
  ConstraintResult,
  UniprotResult,
  EveResult,
} from "@contracts/variant";
import {
  ACMG_BENIGN,
  ACMG_LIKELY_BENIGN,
  ACMG_VUS,
  ACMG_LIKELY_PATHOGENIC,
  ACMG_PATHOGENIC,
} from "@contracts/variant";

// ── Helpers ──

function emptyVep(): VepResult {
  return { query: "input", input: "raw" };
}

function emptyGnomad(): GnomadResult {
  return {};
}

function emptyClinvar(): ClinvarResult {
  return {};
}

function emptyConstraint(): ConstraintResult {
  return {};
}

function emptyUniprot(): UniprotResult {
  return {};
}

function emptyEve(): EveResult | undefined {
  return undefined;
}

function makeResult(
  overrides: {
    vep?: Partial<VepResult>;
    gnomad?: Partial<GnomadResult>;
    clinvar?: Partial<ClinvarResult>;
    constraint?: Partial<ConstraintResult>;
    uniprot?: Partial<UniprotResult>;
    eve?: EveResult | undefined;
    secondVariantPathogenic?: boolean;
  } = {}
) {
  return buildAcmgEvidence(
    { ...emptyVep(), ...overrides.vep },
    { ...emptyGnomad(), ...overrides.gnomad },
    { ...emptyClinvar(), ...overrides.clinvar },
    { ...emptyConstraint(), ...overrides.constraint },
    { ...emptyUniprot(), ...overrides.uniprot },
    overrides.eve !== undefined ? overrides.eve : emptyEve(),
    overrides.secondVariantPathogenic
  );
}

// ── Helper to find criterion ──
function hasCriterion(result: ReturnType<typeof buildAcmgEvidence>, criterion: string): boolean {
  return result.evidence_items.some((e) => e.criterion === criterion);
}

// ═══════════════════════════════════════════════════════════════════
// BA1 — AF > 5%
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — BA1 (Stand-alone benign)", () => {
  it("gnomAD exome global AF > 5% triggers BA1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 60000, an: 100000, af: 0.06 } },
    });
    expect(result.classification).toBe(ACMG_BENIGN);
    expect(hasCriterion(result, "BA1")).toBe(true);
    expect(result.benign_score).toBeGreaterThanOrEqual(8);
  });

  it("gnomAD genome global AF > 5% triggers BA1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { genome: { ac: 600, an: 1000, af: 0.6 } },
    });
    expect(result.classification).toBe(ACMG_BENIGN);
    expect(hasCriterion(result, "BA1")).toBe(true);
  });

  it("VEP gnomAD frequency > 5% triggers BA1", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        gnomad_frequencies: { gnomade: 0.07 },
      },
    });
    expect(result.classification).toBe(ACMG_BENIGN);
    expect(hasCriterion(result, "BA1")).toBe(true);
  });

  it("EAS AF > 5% triggers BA1 even if global < 5%", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        gnomad_frequencies: { gnomade: 0.01, gnomade_eas: 0.08 },
      },
    });
    expect(hasCriterion(result, "BA1")).toBe(true);
    expect(result.classification).toBe(ACMG_BENIGN);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BS1 — AF > 1%
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — BS1 (Strong benign)", () => {
  it("AF > 1% (but < 5%) triggers BS1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 2000, an: 100000, af: 0.02 } },
    });
    expect(hasCriterion(result, "BS1")).toBe(true);
    expect(result.benign_score).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PVS1 — LOF variants
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PVS1 (LOF)", () => {
  it("stop_gained + pLI > 0.9 → PVS1 Very Strong (8 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["stop_gained"] },
      constraint: { pli: 0.99 },
    });
    expect(hasCriterion(result, "PVS1")).toBe(true);
    expect(result.evidence_items.find((e) => e.criterion === "PVS1")!.strength).toBe("Very Strong");
    expect(result.pathogenic_score).toBeGreaterThanOrEqual(8);
  });

  it("frameshift + LOEUF < 0.35 → PVS1_Strong (4 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["frameshift_variant"] },
      constraint: { oe_lof_upper: 0.2 },
    });
    expect(hasCriterion(result, "PVS1_Strong")).toBe(true);
    expect(result.evidence_items.find((e) => e.criterion === "PVS1_Strong")!.strength).toBe("Strong");
    expect(result.pathogenic_score).toBeGreaterThanOrEqual(4);
  });

  it("splice_donor + no constraint → PVS1_Moderate (2 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["splice_donor_variant"] },
    });
    expect(hasCriterion(result, "PVS1_Moderate")).toBe(true);
    expect(result.pathogenic_score).toBe(2);
  });

  it("splice_acceptor_variant triggers PVS1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["splice_acceptor_variant"] },
      constraint: { pli: 0.95 },
    });
    expect(hasCriterion(result, "PVS1")).toBe(true);
  });

  it("start_lost triggers PVS1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["start_lost"] },
      constraint: { pli: 0.95 },
    });
    expect(hasCriterion(result, "PVS1")).toBe(true);
  });

  it("missense does NOT trigger PVS1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      constraint: { pli: 0.95 },
    });
    expect(hasCriterion(result, "PVS1")).toBe(false);
    expect(hasCriterion(result, "PVS1_Strong")).toBe(false);
    expect(hasCriterion(result, "PVS1_Moderate")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PS1 / PP5 — ClinVar pathogenic
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PS1/PP5 (ClinVar)", () => {
  it("ClinVar Pathogenic 4-star → PS1 (Strong, 4 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Pathogenic",
        review_status: "practice guideline",
      },
    });
    expect(hasCriterion(result, "PS1")).toBe(true);
    expect(result.evidence_items.find((e) => e.criterion === "PS1")!.strength).toBe("Strong");
  });

  it("ClinVar Pathogenic 3-star → PS1 (Strong)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Pathogenic",
        review_status: "reviewed by expert panel",
      },
    });
    expect(hasCriterion(result, "PS1")).toBe(true);
  });

  it("ClinVar Pathogenic 2-star → PP5_Strong (4 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Pathogenic",
        review_status: "criteria provided, multiple submitters, no conflicts",
      },
    });
    expect(hasCriterion(result, "PP5_Strong")).toBe(true);
  });

  it("ClinVar Pathogenic 1-star → PP5 Supporting (1 pt)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Pathogenic",
        review_status: "criteria provided, single submitter",
      },
    });
    expect(hasCriterion(result, "PP5")).toBe(true);
    expect(result.evidence_items.find((e) => e.criterion === "PP5")!.strength).toBe("Supporting");
  });

  it("ClinVar Pathogenic 0-star → PP5 Supporting (1 pt)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Pathogenic",
        review_status: "no assertion criteria provided",
      },
    });
    expect(hasCriterion(result, "PP5")).toBe(true);
  });

  // Fixed: "likely_pathogenic" no longer matches "pathogenic" substring check
  // clinvarClass === "pathogenic" is checked exactly. LP goes to its own block.
  it("ClinVar Likely Pathogenic 2-star → PP5_Moderate (2 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: {
        classification: "Likely pathogenic",
        review_status: "criteria provided, multiple submitters, no conflicts",
      },
    });
    expect(hasCriterion(result, "PP5_Moderate")).toBe(true);
    expect(hasCriterion(result, "PP5_Strong")).toBe(false);
    expect(hasCriterion(result, "PS1")).toBe(false);
  });

  it("ClinVar VUS → no ClinVar evidence", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: { classification: "Uncertain significance" },
    });
    expect(hasCriterion(result, "PS1")).toBe(false);
    expect(hasCriterion(result, "PP5")).toBe(false);
    expect(hasCriterion(result, "PP5_Strong")).toBe(false);
    expect(hasCriterion(result, "PP5_Moderate")).toBe(false);
  });

  it("ClinVar Benign → no pathogenic ClinVar evidence", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: { classification: "Benign" },
    });
    // No pathogenic ClinVar criteria should fire
    expect(hasCriterion(result, "PS1")).toBe(false);
  });

  it("ClinVar Likely Benign → no pathogenic ClinVar evidence", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      clinvar: { classification: "Likely benign" },
    });
    expect(hasCriterion(result, "PS1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PM2 — Absent / very rare
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PM2 (very rare)", () => {
  it("AF < 1e-5 → PM2 Moderate (2 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 0, an: 100000, af: 1e-6 } },
    });
    expect(hasCriterion(result, "PM2")).toBe(true);
  });

  it("AF < 1e-4 (but >= 1e-5) → PM2_Supporting (1 pt)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 5, an: 100000, af: 5e-5 } },
    });
    expect(hasCriterion(result, "PM2_Supporting")).toBe(true);
  });

  it("AF >= 1e-4 → no PM2", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 20, an: 100000, af: 2e-4 } },
    });
    expect(hasCriterion(result, "PM2")).toBe(false);
    expect(hasCriterion(result, "PM2_Supporting")).toBe(false);
  });

  it("no gnomAD data → no PM2", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
    });
    expect(hasCriterion(result, "PM2")).toBe(false);
    expect(hasCriterion(result, "PM2_Supporting")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PM3 — Second pathogenic variant
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PM3 (second variant)", () => {
  it("secondVariantPathogenic=true → PM3_Strong (4 pts)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      secondVariantPathogenic: true,
    });
    expect(hasCriterion(result, "PM3_Strong")).toBe(true);
  });

  it("secondVariantPathogenic=false → no PM3", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      secondVariantPathogenic: false,
    });
    expect(hasCriterion(result, "PM3_Strong")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PP3 — In-silico evidence (missense)
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PP3 (in-silico pathogenic)", () => {
  it("missense + REVEL > 0.75 → PP3 (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.85,
      },
    });
    expect(hasCriterion(result, "PP3")).toBe(true);
    expect(result.pathogenic_score).toBe(1);
  });

  it("missense + CADD >= 25 (with low REVEL) → PP3 (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        cadd_phred: 28,
        revel: 0.3,
      },
    });
    expect(hasCriterion(result, "PP3")).toBe(true);
  });

  it("missense + REVEL=0.5 (borderline) → no PP3", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.5,
      },
    });
    expect(hasCriterion(result, "PP3")).toBe(false);
  });

  it("missense + CADD=20 (below threshold) → no PP3", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        cadd_phred: 20,
      },
    });
    expect(hasCriterion(result, "PP3")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BP4 — Multiple benign in-silico
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — BP4 (in-silico benign)", () => {
  it("missense + REVEL < 0.25 + CADD < 15 → BP4 (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.1,
        cadd_phred: 10,
      },
    });
    expect(hasCriterion(result, "BP4")).toBe(true);
  });

  it("missense + REVEL < 0.25 + AlphaMissense likely_benign → BP4", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.15,
        alphamissense: { class: "likely_benign" },
      },
    });
    expect(hasCriterion(result, "BP4")).toBe(true);
  });

  it("missense + only REVEL < 0.25 (CADD high) → no BP4", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.1,
        cadd_phred: 25,
      },
    });
    expect(hasCriterion(result, "BP4")).toBe(false);
  });

  it("non-missense variant → no BP4", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["synonymous_variant"],
        revel: 0.1,
        cadd_phred: 10,
      },
    });
    expect(hasCriterion(result, "BP4")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SpliceAI
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — SpliceAI evidence", () => {
  it("max delta >= 0.5 → PS3_Supporting (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        spliceai: { DS_AG: 0, DS_AL: 0, DS_DG: 0.6, DS_DL: 0.1 },
      },
    });
    expect(hasCriterion(result, "PS3_Supporting")).toBe(true);
    expect(result.pathogenic_score).toBe(1);
  });

  it("max delta >= 0.2 (but < 0.5) → PP3_Splice (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        spliceai: { DS_AG: 0.3, DS_AL: 0, DS_DG: 0, DS_DL: 0 },
      },
    });
    expect(hasCriterion(result, "PP3_Splice")).toBe(true);
  });

  it("max delta < 0.2 → no splice evidence", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        spliceai: { DS_AG: 0.1, DS_AL: 0, DS_DG: 0, DS_DL: 0 },
      },
    });
    expect(hasCriterion(result, "PS3_Supporting")).toBe(false);
    expect(hasCriterion(result, "PP3_Splice")).toBe(false);
  });

  it("no spliceai data → no splice evidence", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
    });
    expect(hasCriterion(result, "PS3_Supporting")).toBe(false);
    expect(hasCriterion(result, "PP3_Splice")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EVE
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — EVE evidence", () => {
  it("EVE score > 0.7 → PP3_EVE (1 pt)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      eve: { score: 0.85, class: "pathogenic", source: "evemodel_api" },
    });
    expect(hasCriterion(result, "PP3_EVE")).toBe(true);
  });

  it("EVE score <= 0.7 → no PP3_EVE", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      eve: { score: 0.5, class: "uncertain", source: "evemodel_api" },
    });
    expect(hasCriterion(result, "PP3_EVE")).toBe(false);
  });

  it("no EVE data → no PP3_EVE", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
    });
    expect(hasCriterion(result, "PP3_EVE")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Combined scenarios (multiple evidence stacking)
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — combined scenarios", () => {
  it("LOF + pLI>0.9 + ClinVar Path 3-star + rare + SpliceAI>0.5 → Pathogenic",
    () => {
      const result = makeResult({
        vep: {
          consequence_terms: ["stop_gained"],
          spliceai: { DS_AG: 0, DS_AL: 0, DS_DG: 0.6, DS_DL: 0.1 },
        },
        gnomad: { exome: { ac: 0, an: 100000, af: 1e-6 } },
        clinvar: {
          classification: "Pathogenic",
          review_status: "reviewed by expert panel",
        },
        constraint: { pli: 0.99 },
      });
      expect(result.classification).toBe(ACMG_PATHOGENIC);
      expect(hasCriterion(result, "PVS1")).toBe(true);
      expect(hasCriterion(result, "PS1")).toBe(true);
      expect(hasCriterion(result, "PM2")).toBe(true);
      expect(hasCriterion(result, "PS3_Supporting")).toBe(true);
    }
  );

  it("missense + REVEL>0.75 + AF=1e-5 + no ClinVar → VUS-favor-pathogenic",
    () => {
      const result = makeResult({
        vep: {
          consequence_terms: ["missense_variant"],
          revel: 0.85,
        },
        gnomad: { exome: { ac: 1, an: 100000, af: 1e-5 } },
      });
      expect(result.classification).toBe(`${ACMG_VUS}_favor_pathogenic`);
      expect(hasCriterion(result, "PP3")).toBe(true);
      // PM2_Supporting fires (AF=1e-5 is < 1e-4, not < 1e-5)
      expect(hasCriterion(result, "PM2_Supporting")).toBe(true);
      expect(result.pathogenic_score).toBe(2); // 1(PP3) + 1(PM2_Supporting)
    }
  );

  it("missense + REVEL<0.25 + CADD<15 + AF=0.02 → likely_benign",
    () => {
      // BP4(1) + BS1(4) = 5 benign → likely_benign
      const result = makeResult({
        vep: {
          consequence_terms: ["missense_variant"],
          revel: 0.1,
          cadd_phred: 10,
        },
        gnomad: { exome: { ac: 2000, an: 100000, af: 0.02 } },
      });
      expect(result.classification).toBe(ACMG_LIKELY_BENIGN);
      expect(hasCriterion(result, "BP4")).toBe(true);
      expect(hasCriterion(result, "BS1")).toBe(true);
    }
  );

  it("synonymous + AF=0.005 → VUS (BP7 fires, 1 benign)", () => {
    // BP7 gives 1 benign point for silent synonymous
    const result = makeResult({
      vep: {
        consequence_terms: ["synonymous_variant"],
      },
      gnomad: { exome: { ac: 500, an: 100000, af: 0.005 } },
    });
    // BP7(1) — benign=1, not enough for vus_favor_benign (needs ≥2)
    expect(result.classification).toBe(ACMG_VUS);
    expect(hasCriterion(result, "BP7")).toBe(true);
    expect(result.benign_score).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Score boundary tests
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — score boundaries", () => {
  it("benign >= 8 → benign", () => {
    // BA1 gives 8
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      gnomad: { exome: { ac: 10000, an: 100000, af: 0.1 } },
    });
    expect(result.classification).toBe(ACMG_BENIGN);
  });

  it("benign >= 4 → likely_benign", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        gnomad_frequencies: { gnomade: 0.03 },
      },
    });
    expect(result.classification).toBe(ACMG_LIKELY_BENIGN);
  });

  it("pathogenic >= 10 → pathogenic", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["stop_gained"],
        spliceai: { DS_DG: 0.6 },
      },
      gnomad: { exome: { ac: 0, an: 100000, af: 1e-6 } },
      clinvar: {
        classification: "Pathogenic",
        review_status: "reviewed by expert panel",
      },
      constraint: { pli: 0.99 },
    });
    expect(result.classification).toBe(ACMG_PATHOGENIC);
    expect(result.pathogenic_score).toBeGreaterThanOrEqual(10);
  });

  it("pathogenic >= 6 (but < 10) → likely_pathogenic", () => {
    // PVS1=8 only (no rare AF, so no PM2)
    const result = makeResult({
      vep: {
        consequence_terms: ["stop_gained"],
      },
      gnomad: { exome: { ac: 50, an: 100000, af: 5e-4 } }, // AF too high for PM2
      constraint: { pli: 0.99 },
    });
    expect(result.classification).toBe(ACMG_LIKELY_PATHOGENIC);
    expect(result.pathogenic_score).toBeGreaterThanOrEqual(6);
    expect(result.pathogenic_score).toBeLessThan(10);
  });

  it("pathogenic >= 2 (but < 6) → vus_favor_pathogenic", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.85,
      },
      gnomad: { exome: { ac: 1, an: 100000, af: 1e-5 } },
    });
    expect(result.classification).toBe(`${ACMG_VUS}_favor_pathogenic`);
    expect(result.pathogenic_score).toBeGreaterThanOrEqual(2);
    expect(result.pathogenic_score).toBeLessThan(6);
  });

  it("benign >= 4 → likely_benign (BP4 + BS1)", () => {
    // BP4(1) + BS1(AF=0.02, +4) = 5 benign → likely_benign
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.1,
        cadd_phred: 10,
        alphamissense: { class: "likely_benign" },
      },
      gnomad: {
        exome: { ac: 2000, an: 100000, af: 0.02 },
      },
    });
    expect(result.classification).toBe(ACMG_LIKELY_BENIGN);
    expect(result.benign_score).toBeGreaterThanOrEqual(4);
  });

  it("BP4 alone (1 pt) → VUS (vus_favor_benign needs ≥2)", () => {
    // vus_favor_benign needs benign >= 2, but BP4 only gives 1 pt
    // So with only BP4, classification falls to VUS
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        revel: 0.1,
        cadd_phred: 10,
        alphamissense: { class: "likely_benign" },
      },
    });
    expect(result.classification).toBe(ACMG_VUS);
    expect(result.benign_score).toBe(1);
    expect(hasCriterion(result, "BP4")).toBe(true);
  });

  it("all scores 0 → VUS", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
    });
    expect(result.classification).toBe(ACMG_VUS);
    expect(result.pathogenic_score).toBe(0);
    expect(result.benign_score).toBe(0);
    expect(result.evidence_items.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PM1 — Protein domain impact
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PM1 (protein domain)", () => {
  it("missense in active site → PM1_Strong (4 pts)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        protein_start: 175,
      },
      uniprot: {
        features_near_variant: [
          { type: "Active site", description: "Catalytic triad", start: 170, end: 180 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1_Strong")).toBe(true);
    expect(hasCriterion(result, "PM1")).toBe(false);
    expect(result.pathogenic_score).toBe(4);
  });

  it("missense in binding site → PM1 Moderate (2 pts)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        protein_start: 200,
      },
      uniprot: {
        features_near_variant: [
          { type: "DNA binding", description: "DNA-binding domain", start: 102, end: 292 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1")).toBe(true);
    expect(result.pathogenic_score).toBe(2);
  });

  it("missense in functional domain → PM1_Supporting (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        protein_start: 150,
      },
      uniprot: {
        features_near_variant: [
          { type: "Domain", description: "Kinase domain", start: 100, end: 300 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1_Supporting")).toBe(true);
    expect(result.pathogenic_score).toBe(1);
  });

  it("missense outside any domain → no PM1", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["missense_variant"],
        protein_start: 50,
      },
      uniprot: {
        features_near_variant: [
          { type: "Domain", description: "Kinase domain", start: 100, end: 300 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1_Strong")).toBe(false);
    expect(hasCriterion(result, "PM1")).toBe(false);
    expect(hasCriterion(result, "PM1_Supporting")).toBe(false);
  });

  it("no protein_start → no PM1", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
      uniprot: {
        features_near_variant: [
          { type: "Active site", description: "", start: 100, end: 101 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1_Strong")).toBe(false);
  });

  it("non-missense → no PM1 even in active site", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["frameshift_variant"],
        protein_start: 175,
      },
      uniprot: {
        features_near_variant: [
          { type: "Active site", description: "", start: 170, end: 180 },
        ],
      },
    });
    expect(hasCriterion(result, "PM1_Strong")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PM4 — Inframe indel
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — PM4 (inframe indel)", () => {
  it("inframe deletion changing >1 residue → PM4_Strong (4 pts)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["inframe_deletion"],
        protein_start: 100,
        protein_end: 102,
      },
    });
    expect(hasCriterion(result, "PM4_Strong")).toBe(true);
    expect(result.pathogenic_score).toBe(4);
  });

  it("inframe deletion changing 1 residue → PM4 Moderate (2 pts)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["inframe_deletion"],
        protein_start: 100,
        protein_end: 100,
      },
    });
    expect(hasCriterion(result, "PM4")).toBe(true);
    expect(result.pathogenic_score).toBe(2);
  });

  it("inframe insertion → PM4 Moderate (1 residue)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["inframe_insertion"],
        protein_start: 150,
        protein_end: 150,
      },
    });
    expect(hasCriterion(result, "PM4")).toBe(true);
    expect(result.pathogenic_score).toBe(2);
  });

  it("inframe indel in repeat region → no PM4", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["inframe_deletion"],
        protein_start: 100,
        protein_end: 102,
      },
      uniprot: {
        features_near_variant: [
          { type: "Repeat", description: "Poly-Ala tract", start: 90, end: 110 },
        ],
      },
    });
    expect(hasCriterion(result, "PM4_Strong")).toBe(false);
    expect(hasCriterion(result, "PM4")).toBe(false);
  });

  it("non-inframe variant → no PM4", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["frameshift_variant"],
        protein_start: 100,
        protein_end: 100,
      },
    });
    expect(hasCriterion(result, "PM4_Strong")).toBe(false);
    expect(hasCriterion(result, "PM4")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BP7 — Silent synonymous
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — BP7 (silent synonymous)", () => {
  it("synonymous + no splice impact → BP7 (1 pt)", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["synonymous_variant"],
        spliceai: { DS_AG: 0, DS_AL: 0, DS_DG: 0, DS_DL: 0 },
      },
    });
    expect(hasCriterion(result, "BP7")).toBe(true);
    expect(result.benign_score).toBe(1);
  });

  it("synonymous + low splice impact (<0.1) → BP7", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["synonymous_variant"],
        spliceai: { DS_AG: 0.05, DS_AL: 0, DS_DG: 0, DS_DL: 0.02 },
      },
    });
    expect(hasCriterion(result, "BP7")).toBe(true);
  });

  it("synonymous + significant splice impact (≥0.1) → no BP7", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["synonymous_variant"],
        spliceai: { DS_AG: 0.3, DS_AL: 0, DS_DG: 0, DS_DL: 0 },
      },
    });
    expect(hasCriterion(result, "BP7")).toBe(false);
  });

  it("missense variant → no BP7", () => {
    const result = makeResult({
      vep: { consequence_terms: ["missense_variant"] },
    });
    expect(hasCriterion(result, "BP7")).toBe(false);
  });

  it("no SpliceAI data → synonymous is BP7 (assume no impact)", () => {
    const result = makeResult({
      vep: { consequence_terms: ["synonymous_variant"] },
    });
    expect(hasCriterion(result, "BP7")).toBe(true);
    expect(result.benign_score).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BA1 + pathogenic coexistence → BA1 wins
// ═══════════════════════════════════════════════════════════════════
describe("ACMG — BA1 overrides pathogenic", () => {
  it("BA1 (8 pts) + PVS1 (8 pts) + PS1 (4 pts) → still benign", () => {
    const result = makeResult({
      vep: {
        consequence_terms: ["stop_gained"],
      },
      gnomad: { exome: { ac: 10000, an: 100000, af: 0.1 } },
      clinvar: {
        classification: "Pathogenic",
        review_status: "reviewed by expert panel",
      },
      constraint: { pli: 0.99 },
    });
    // BA1 = 8, BS1 = 4 → benign=12, PVS1=8, PS1=4 → pathogenic=12
    // Both >= 8, but BA1 is stand-alone → classification is benign
    expect(result.classification).toBe(ACMG_BENIGN);
    expect(result.benign_score).toBe(12);
  });
});
