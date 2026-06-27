import { z } from "zod";

// ── Input ──
export const analyzeInput = z.object({
  variant: z.string().min(1).max(500),
  options: z.object({
    includeGnomad: z.boolean().default(true),
    includeClinvar: z.boolean().default(true),
    includeLiterature: z.boolean().default(true),
    includeEve: z.boolean().default(true),
    secondVariantPathogenic: z.boolean().default(false),
  }).default(() => ({
    includeGnomad: true,
    includeClinvar: true,
    includeLiterature: true,
    includeEve: true,
    secondVariantPathogenic: false,
  })),
});

export type AnalyzeInput = z.infer<typeof analyzeInput>;

// ── Variant ──
export interface Variant {
  raw: string;
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  rsid?: string;
  hgvs_g: string;
  qc?: Record<string, string | number>;
}

// ── VEP ──
export interface VepResult {
  query: string;
  input: string;
  rsid?: string;
  gene_symbol?: string;
  transcript?: string;
  cdna?: string;
  protein?: string;
  protein_start?: number;
  protein_end?: number;
  amino_acids?: string;
  consequence_terms?: string[];
  sift?: { prediction?: string; score?: number };
  polyphen?: { prediction?: string; score?: number };
  alphamissense?: { class?: string; pathogenicity?: number };
  cadd_phred?: number;
  spliceai?: { DS_AG?: number; DS_AL?: number; DS_DG?: number; DS_DL?: number };
  revel?: number;
  gnomad_frequencies?: Record<string, number>;
  gtex_expression?: Record<string, number>;
  all_transcript_consequences?: any[];
  error?: string;
}

// ── gnomAD ──
export interface GnomadResult {
  variant_id?: string;
  exome?: { ac?: number; an?: number; af?: number };
  genome?: { ac?: number; an?: number; af?: number };
  error?: string;
}

export interface ConstraintResult {
  pli?: number;
  oe_lof?: number;
  oe_lof_upper?: number;
  oe_mis?: number;
  oe_mis_upper?: number;
}

// ── ClinVar ──
export interface ClinvarResult {
  accession?: string;
  classification?: string;
  review_status?: string;
  last_evaluated?: string;
  traits?: string[];
  source?: string;
  error?: string;
}

// ── UniProt ──
export interface UniprotResult {
  accession?: string;
  gene_symbol?: string;
  protein_length?: number;
  protein_name?: string;
  function?: string;
  features_near_variant?: Array<{
    type: string;
    description?: string;
    start: number;
    end: number;
  }>;
  source?: string;
  error?: string;
}

// ── Literature ──
export interface LiteratureResult {
  query: string;
  count: number;
  articles: Array<{
    title?: string;
    authors?: string;
    journal?: string;
    year?: string;
    pmid?: string;
    doi?: string;
  }>;
}

// ── EVE ──
export interface EveResult {
  score?: number;
  class?: string;
  source?: string;
}

// ── ACMG ──
export interface AcmgEvidence {
  criterion: string;
  strength: string;
  description: string;
}

export interface AcmgResult {
  classification: string;
  evidence_items: AcmgEvidence[];
  pathogenic_score: number;
  benign_score: number;
}

// ── Full Result ──
export interface FullResult {
  variant: {
    raw: string;
    chrom: string;
    pos: number;
    ref: string;
    alt: string;
    rsid?: string;
    hgvs_g: string;
  };
  qc: Record<string, string | number>;
  vep: VepResult;
  gnomad: GnomadResult;
  constraint: ConstraintResult;
  clinvar: ClinvarResult;
  uniprot: UniprotResult;
  literature: LiteratureResult;
  eve?: EveResult;
  acmg: AcmgResult;
  markdown: string;
}

// ── ACMG Constants ──
export const ACMG_BENIGN = "benign";
export const ACMG_LIKELY_BENIGN = "likely_benign";
export const ACMG_VUS = "vus";
export const ACMG_LIKELY_PATHOGENIC = "likely_pathogenic";
export const ACMG_PATHOGENIC = "pathogenic";

export const ACMG_CLASS_MAP: Record<string, string> = {
  [ACMG_PATHOGENIC]: "致病 (Pathogenic)",
  [ACMG_LIKELY_PATHOGENIC]: "可能致病 (Likely Pathogenic)",
  [ACMG_VUS]: "意义未明 (VUS)",
  "vus_favor_pathogenic": "VUS-偏致病 (VUS-favor pathogenic)",
  "vus_favor_benign": "VUS-偏良性 (VUS-favor benign)",
  [ACMG_LIKELY_BENIGN]: "可能良性 (Likely Benign)",
  [ACMG_BENIGN]: "良性 (Benign)",
};

export const CLINVAR_CLASS_MAP: Record<string, string> = {
  "Pathogenic": "致病",
  "Likely pathogenic": "可能致病",
  "Uncertain significance": "意义未明",
  "Likely benign": "可能良性",
  "Benign": "良性",
};
