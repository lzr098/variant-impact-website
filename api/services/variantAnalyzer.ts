/**
 * GRCh38 Variant Functional Impact Analyzer
 * TypeScript rewrite of analyze_variant.py — pure API mode (no local files)
 */

import type {
  Variant,
  VepResult,
  GnomadResult,
  ConstraintResult,
  ClinvarResult,
  UniprotResult,
  LiteratureResult,
  EveResult,
  AcmgResult,
  FullResult,
  AcmgEvidence,
  GtexResult,
} from "@contracts/variant";
import {
  ACMG_BENIGN,
  ACMG_LIKELY_BENIGN,
  ACMG_VUS,
  ACMG_LIKELY_PATHOGENIC,
  ACMG_PATHOGENIC,
} from "@contracts/variant";
import { translateFunction, translateProteinName } from "./translation";

// ═══════════════════════════════════════════════════════════════════
// HTTP helpers
// ═══════════════════════════════════════════════════════════════════

async function safeFetch<T>(
  url: string,
  options?: RequestInit & { params?: Record<string, string> }
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let fullUrl = url;
      if (options?.params) {
        const qs = new URLSearchParams(options.params).toString();
        fullUrl = `${url}?${qs}`;
      }
      const res = await fetch(fullUrl, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options?.headers,
        },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 200) {
        return (await res.json()) as T;
      }
      if (res.status === 429 || res.status >= 502) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      return null;
    } catch {
      if (attempt === 2) return null;
      await sleep(2 ** attempt * 1000);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════
// Parsing
// ═══════════════════════════════════════════════════════════════════

function normalizeChrom(chrom: string): string {
  chrom = chrom.trim().toLowerCase().replace("chr", "");
  if (chrom === "x" || chrom === "y" || chrom === "m" || chrom === "mt") {
    return chrom.toUpperCase();
  }
  return chrom;
}

function parseQcFields(fields: string[], startIdx: number): Record<string, string | number> {
  const qc: Record<string, string | number> = {};
  for (const f of fields.slice(startIdx)) {
    if (f.includes("=")) {
      const [k, v] = f.split("=", 2);
      if (!k || !v) continue;
      try {
        qc[k] = v.includes(".") || v.toLowerCase().includes("e") ? parseFloat(v) : parseInt(v, 10);
      } catch {
        qc[k] = v;
      }
    }
  }
  return qc;
}

/**
 * Smart variant parser — handles many real-world input formats.
 *
 * Supported formats:
 *   chr:pos:ref:alt          → chr11:121567110:C:G
 *   chr:pos ref>alt          → chr11:121567110 C>G        (common display format)
 *   chr pos ref alt          → chr11 121567110 C G
 *   chr pos ref>alt          → chr11 121567110 C>G
 *   chr:g.posref>alt         → chr11:g.121567110C>G       (HGVS)
 *   chr:g.pos ref>alt        → chr11:g.121567110 C>G
 *   pos:ref:alt (no chr)     → 121567110:C:G
 *   pos ref>alt (no chr)     → 121567110 C>G
 *   VCF tab-separated
 *   rsID
 *   NM_:c.
 */
export function parseVariant(variantStr: string): Variant {
  let s = variantStr.trim();
  if (!s) throw new Error("Empty variant string");

  // ── 1. VCF tab-separated ──
  if (s.includes("\t")) {
    const parts = s.split("\t");
    if (parts.length >= 4) {
      const chrom = normalizeChrom(parts[0]!);
      const pos = parseInt(parts[1]!, 10);
      if (isNaN(pos)) throw new Error(`Invalid VCF position: ${parts[1]}`);
      const ref = (parts[3] ?? "").toUpperCase();
      const alt = (parts[4] ?? ".").toUpperCase();
      const qc = parseQcFields(parts, 5);
      return { raw: variantStr, chrom, pos, ref, alt, hgvs_g: `${chrom}:g.${pos}${ref}>${alt}`, qc };
    }
  }

  // ── 2. rsID ──
  if (s.toLowerCase().startsWith("rs")) {
    return { raw: variantStr, chrom: "", pos: 0, ref: "", alt: "", rsid: s.toLowerCase(), hgvs_g: "" };
  }

  // ── 3. NM_:c. coding HGVS ──
  if (/^NM_\d+\.\d+:c\./.test(s)) {
    return { raw: variantStr, chrom: "", pos: 0, ref: "", alt: "", hgvs_g: s };
  }

  // ── 4. Strict HGVS: (chr)N:g.12345A>C ──
  const strictHgvs = s.match(/^(chr)?([0-9XYMTxymt]+):g\.(\d+)([ACGTNacgtn]+)>([ACGTNacgtn]+)$/);
  if (strictHgvs) {
    const chrom = normalizeChrom(strictHgvs[2]!);
    const pos = parseInt(strictHgvs[3]!, 10);
    const ref = strictHgvs[4]!.toUpperCase();
    const alt = strictHgvs[5]!.toUpperCase();
    return { raw: variantStr, chrom, pos, ref, alt, hgvs_g: `${chrom}:g.${pos}${ref}>${alt}` };
  }

  // ── 4b. HGVS deletion: (chr)7:g.123_456del or (chr)7:g.123_456delCTT ──
  const delHgvs = s.match(/^(chr)?([0-9XYMTxymt]+):g\.(\d+)(?:_(\d+))?del([ACGTNacgtn]*)$/i);
  if (delHgvs) {
    const chrom = normalizeChrom(delHgvs[2]!);
    const start = parseInt(delHgvs[3]!, 10);
    const end = delHgvs[4] ? parseInt(delHgvs[4]!, 10) : start;
    const deletedSeq = (delHgvs[5] ?? "").toUpperCase();
    return {
      raw: variantStr,
      chrom,
      pos: start,
      ref: deletedSeq || "-",
      alt: "-",
      hgvs_g: `${chrom}:g.${start}${end !== start ? `_${end}` : ""}del${deletedSeq}`,
    };
  }

  // ── 4c. HGVS insertion: (chr)7:g.123_456insA or (chr)7:g.123insA ──
  const insHgvs = s.match(/^(chr)?([0-9XYMTxymt]+):g\.(\d+)(?:_(\d+))?ins([ACGTNacgtn]+)$/i);
  if (insHgvs) {
    const chrom = normalizeChrom(insHgvs[2]!);
    const start = parseInt(insHgvs[3]!, 10);
    const end = insHgvs[4] ? parseInt(insHgvs[4]!, 10) : start;
    const insSeq = insHgvs[5]!.toUpperCase();
    return {
      raw: variantStr,
      chrom,
      pos: start,
      ref: "-",
      alt: insSeq,
      hgvs_g: `${chrom}:g.${start}${end !== start ? `_${end}` : ""}ins${insSeq}`,
    };
  }

  // ── 5. Generic smart parser ──
  // Normalize: collapse all whitespace to single spaces, keep colons
  s = s.replace(/\s+/g, " ");

  // Handle "ref>alt" notation — split it so > becomes a word boundary
  // e.g. "C>G" → "C G"
  s = s.replace(/>/g, " ");

  // Now split by both colon and space
  const tokens = s.split(/[:\s]+/).filter(Boolean);

  if (tokens.length >= 4) {
    // Format: [chr] [pos] [ref] [alt]
    const chrom = normalizeChrom(tokens[0]!);
    const pos = parseInt(tokens[1]!, 10);
    const ref = tokens[2]!.toUpperCase();
    const alt = tokens[3]!.toUpperCase();

    // ── Deletion: ref longer than alt and shares prefix (e.g., CTTT > C) ──
    if (ref.length > alt.length && alt.length > 0 && ref.startsWith(alt)) {
      const deleted = ref.slice(alt.length);
      const delStart = pos + alt.length;
      const delEnd = pos + ref.length - 1;
      const hgvs = `${chrom}:g.${delStart}_${delEnd}del${deleted}`;
      return { raw: variantStr, chrom, pos: delStart, ref: deleted, alt: "-", hgvs_g: hgvs };
    }

    // ── Insertion: alt longer than ref and shares prefix (e.g., C > CTTT) ──
    if (alt.length > ref.length && ref.length > 0 && alt.startsWith(ref)) {
      const inserted = alt.slice(ref.length);
      const insStart = pos + ref.length;
      const hgvs = `${chrom}:g.${insStart}_${insStart + 1}ins${inserted}`;
      return { raw: variantStr, chrom, pos: insStart, ref: "-", alt: inserted, hgvs_g: hgvs };
    }

    if (!isNaN(pos) && /^[ACGTN]+$/i.test(ref) && /^[ACGTN]+$/i.test(alt)) {
      return { raw: variantStr, chrom, pos, ref, alt, hgvs_g: `${chrom}:g.${pos}${ref}>${alt}` };
    }
  }

  if (tokens.length === 3) {
    // Could be: [pos] [ref] [alt]  (missing chr)
    // Or: [chr:g.] [pos] [ref] [alt] but got merged
    const t0 = tokens[0]!;
    const t1 = tokens[1]!;
    const t2 = tokens[2]!;

    // If first token ends with ":g" or ".g", strip it
    const cleaned0 = t0.replace(/:g\.?$/, "").replace(/\.g\.?$/, "");

    if (/^[0-9XYMTxymt]+$/i.test(cleaned0)) {
      // [chr-ish] [pos] [ref/alt]
      const chrom = normalizeChrom(cleaned0);
      const pos = parseInt(t1, 10);
      if (!isNaN(pos) && /^[ACGTN]+$/i.test(t2)) {
        // ref alt separately or ref>alt
        return { raw: variantStr, chrom, pos, ref: t2.toUpperCase(), alt: "", hgvs_g: `${chrom}:g.${pos}${t2.toUpperCase()}>`, qc: {} };
      }
    }

    // Maybe it's just pos ref alt without chr
    const pos = parseInt(t0, 10);
    if (!isNaN(pos) && /^[ACGTN]+$/i.test(t1) && /^[ACGTN]+$/i.test(t2)) {
      return { raw: variantStr, chrom: "", pos, ref: t1.toUpperCase(), alt: t2.toUpperCase(), hgvs_g: "" };
    }
  }

  throw new Error(
    `Unsupported variant format: "${variantStr}". ` +
    `Expected: chr:pos:ref:alt, chr:pos ref>alt, HGVS (e.g. chr11:g.121567110C>G, chr7:g.123_456delCTT, chr7:g.123_456insA), rsID, NM_:c., or VCF tab-separated`
  );
}

// ═══════════════════════════════════════════════════════════════════
// Ensembl VEP
// ═══════════════════════════════════════════════════════════════════

export async function resolveRsid(rsid: string): Promise<Variant | null> {
  const data = await safeFetch<any>(
    `https://rest.ensembl.org/variation/human/${rsid.toLowerCase()}`,
    { params: { pops: "0" } }
  );
  if (!data?.mappings) return null;
  for (const mapping of data.mappings) {
    if (mapping.assembly_name === "GRCh38") {
      const chrom = normalizeChrom(mapping.seq_region_name ?? "");
      const pos = mapping.start;
      const alleleStr = mapping.allele_string ?? "";
      const parts = alleleStr.split("/");
      if (chrom && pos && parts.length === 2) {
        return {
          raw: rsid,
          chrom,
          pos: parseInt(pos, 10),
          ref: parts[0]!.toUpperCase(),
          alt: parts[1]!.toUpperCase(),
          rsid: rsid.toLowerCase(),
          hgvs_g: `${chrom}:g.${pos}${parts[0]!.toUpperCase()}>${parts[1]!.toUpperCase()}`,
        };
      }
    }
  }
  return null;
}

export async function queryVep(variant: Variant): Promise<{ vep: VepResult; updated: Variant }> {
  const payload = {
    hgvs_notations: [variant.hgvs_g],
    AlphaMissense: true,
    CADD: true,
    SpliceAI: true,
    REVEL: true,
    canonical: true,
    mane: true,
    numbers: true,
  };

  const data = await safeFetch<any[]>("https://rest.ensembl.org/vep/human/hgvs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { vep: { query: variant.hgvs_g, input: variant.raw, error: "VEP returned no data" }, updated: variant };
  }

  const top = data[0]!;
  const updated = { ...variant };
  if (top.input) {
    // VEP may return updated coordinates
  }

  const transcript = pickCanonicalTranscript(top.transcript_consequences ?? []);
  const rsid = resolveRsidFromVep(top, variant.rsid);
  const [cdna, protein] = extractHgvs(transcript);

  const vep: VepResult = {
    query: updated.hgvs_g,
    input: updated.raw,
    rsid,
    gene_symbol: transcript?.gene_symbol,
    gene_id: transcript?.gene_id,
    transcript: transcript?.transcript_id,
    cdna,
    protein,
    protein_start: transcript?.protein_start,
    protein_end: transcript?.protein_end,
    amino_acids: transcript?.amino_acids,
    consequence_terms: transcript?.consequence_terms,
    sift: extractSift(transcript),
    polyphen: extractPolyphen(transcript),
    alphamissense: extractAlphamissense(transcript),
    cadd_phred: extractCadd(top, transcript),
    spliceai: extractSpliceai(transcript),
    revel: extractRevel(transcript),
    gnomad_frequencies: extractFrequencies(top),
    gtex_expression: undefined, // Will be filled by queryGtex
    all_transcript_consequences: top.transcript_consequences,
  };

  if (rsid && !updated.rsid) updated.rsid = rsid;

  return { vep, updated };
}

function pickCanonicalTranscript(consequences: any[]): any | undefined {
  if (!consequences?.length) return undefined;
  for (const tc of consequences) if (tc.mane_select) return tc;
  for (const tc of consequences) if (tc.canonical === 1) return tc;
  return consequences[0];
}

function resolveRsidFromVep(top: any, fallback?: string): string | undefined {
  if (fallback?.toLowerCase().startsWith("rs")) return fallback;
  for (const cv of top.colocated_variants ?? []) {
    const cid = cv.id ?? "";
    if (typeof cid === "string" && cid.toLowerCase().startsWith("rs")) return cid;
  }
  return fallback;
}

function extractSift(tc: any): VepResult["sift"] {
  if (!tc) return undefined;
  const pred = tc.sift_prediction;
  const score = tc.sift_score;
  if (pred == null && score == null) return undefined;
  return { prediction: pred, score };
}

function extractPolyphen(tc: any): VepResult["polyphen"] {
  if (!tc) return undefined;
  const pred = tc.polyphen_prediction;
  const score = tc.polyphen_score;
  if (pred == null && score == null) return undefined;
  return { prediction: pred, score };
}

function extractAlphamissense(tc: any): VepResult["alphamissense"] {
  if (!tc) return undefined;
  const am = tc.alphamissense;
  if (!am) return undefined;
  return { class: am.am_class, pathogenicity: am.am_pathogenicity };
}

function extractCadd(top: any, tc: any): number | undefined {
  if (tc?.cadd_phred != null) return tc.cadd_phred;
  return top?.cadd_phred;
}

function extractSpliceai(tc: any): VepResult["spliceai"] {
  if (!tc) return undefined;
  const sai = tc.spliceai;
  if (!sai) return undefined;
  return {
    DS_AG: sai.DS_AG,
    DS_AL: sai.DS_AL,
    DS_DG: sai.DS_DG,
    DS_DL: sai.DS_DL,
  };
}

function extractRevel(tc: any): number | undefined {
  if (!tc) return undefined;
  return tc.revel_score;
}

function extractFrequencies(top: any): Record<string, number> | undefined {
  const colocated = top?.colocated_variants;
  if (!colocated?.length) return undefined;
  const freqs = colocated[0]?.frequencies;
  if (!freqs) return undefined;
  const altFreqs = Object.values(freqs)[0] as Record<string, number> | undefined;
  if (!altFreqs) return undefined;
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(altFreqs)) {
    if (k.startsWith("gnomad") && v != null) result[k] = v;
  }
  return Object.keys(result).length ? result : undefined;
}

function extractHgvs(tc: any): [string | undefined, string | undefined] {
  if (!tc) return [undefined, undefined];
  return [tc.hgvsc, tc.hgvsp];
}

// ═══════════════════════════════════════════════════════════════════
// GTEx Portal API v2 — uses Node.js https module (supports TLS 1.3, redirects)
// Three-step: 1) search gene for versioned gencodeId,
//             2) query median gene expression (tissue),
//             3) query median transcript expression (transcript x tissue)
// ═══════════════════════════════════════════════════════════════════

import { httpsRequest } from "../lib/https";

export async function queryGtex(
  geneSymbol: string | undefined
): Promise<GtexResult | undefined> {
  if (!geneSymbol) return undefined;

  // Step 1: Search gene to get versioned gencodeId
  let gencodeId: string | undefined;
  try {
    const searchData = await httpsRequest<any>(
      `https://gtexportal.org/api/v2/reference/gene?geneId=${encodeURIComponent(geneSymbol)}&datasetId=gtex_v8`
    );
    if (searchData?.data?.length > 0) {
      gencodeId = searchData.data[0].gencodeId;
    }
  } catch (err) {
    console.error("[GTEx] gene search failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
  if (!gencodeId) {
    console.error(`[GTEx] no gencodeId found for gene: ${geneSymbol}`);
    return undefined;
  }

  // Step 2 + 3: query gene expression and transcript expression in parallel
  const [geneExpr, transcriptExpr] = await Promise.all([
    queryGtexGeneExpression(gencodeId),
    queryGtexTranscriptExpression(gencodeId),
  ]);

  if (!geneExpr && !transcriptExpr) return undefined;
  return {
    gene_expression: geneExpr,
    transcript_expression: transcriptExpr,
  };
}

async function queryGtexGeneExpression(gencodeId: string): Promise<Record<string, number> | undefined> {
  try {
    const exprData = await httpsRequest<any>(
      `https://gtexportal.org/api/v2/expression/medianGeneExpression?gencodeId=${encodeURIComponent(gencodeId)}&datasetId=gtex_v8`
    );
    if (exprData?.data && exprData.data.length > 0) {
      const result: Record<string, number> = {};
      for (const item of exprData.data) {
        if (item.tissueSiteDetailId && item.median != null) {
          result[item.tissueSiteDetailId.replace(/_/g, " - ")] = item.median;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  } catch (err) {
    console.error("[GTEx] gene expression query failed:", err instanceof Error ? err.message : err);
  }
  return undefined;
}

async function queryGtexTranscriptExpression(gencodeId: string): Promise<Record<string, Record<string, number>> | undefined> {
  try {
    const exprData = await httpsRequest<any>(
      `https://gtexportal.org/api/v2/expression/medianTranscriptExpression?gencodeId=${encodeURIComponent(gencodeId)}&datasetId=gtex_v8`
    );
    if (exprData?.data && exprData.data.length > 0) {
      const result: Record<string, Record<string, number>> = {};
      for (const item of exprData.data) {
        const transcriptId = item.transcriptId;
        const tissue = item.tissueSiteDetailId;
        if (transcriptId && tissue && item.median != null) {
          if (!result[transcriptId]) result[transcriptId] = {};
          result[transcriptId][tissue.replace(/_/g, " - ")] = item.median;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  } catch (err) {
    console.error("[GTEx] transcript expression query failed:", err instanceof Error ? err.message : err);
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// gnomAD GraphQL
// ═══════════════════════════════════════════════════════════════════

export async function queryGnomad(variant: Variant): Promise<GnomadResult> {
  if (!variant.chrom || !variant.pos) {
    return { error: "Cannot query gnomAD without chrom/pos" };
  }
  const query = `
    query GetVariant($chrom: String!, $start: Int!, $stop: Int!, $dataset: DatasetId!) {
      region(chrom: $chrom, start: $start, stop: $stop, reference_genome: GRCh38) {
        variants(dataset: $dataset) {
          variant_id
          exome { ac an af }
          genome { ac an af }
        }
      }
    }
  `;
  const variables = {
    chrom: variant.chrom,
    start: Math.max(1, variant.pos - 5),
    stop: variant.pos + 5,
    dataset: "gnomad_r4",
  };
  const data = await safeFetch<any>("https://gnomad.broadinstitute.org/api/", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (!data?.data?.region?.variants) {
    return { error: "gnomAD returned no data" };
  }
  const targetId = `${variant.chrom}-${variant.pos}-${variant.ref}-${variant.alt}`;
  for (const v of data.data.region.variants) {
    if (v.variant_id === targetId) {
      return { variant_id: v.variant_id, exome: v.exome, genome: v.genome };
    }
  }
  return { error: `Variant ${targetId} not found in gnomAD` };
}

export async function queryGnomadConstraint(geneSymbol: string): Promise<ConstraintResult> {
  const query = `
    query GetConstraint($gene_symbol: String!) {
      gene(gene_symbol: $gene_symbol, reference_genome: GRCh38) {
        gene_id
        symbol
        gnomad_constraint {
          pLI
          oe_lof
          oe_lof_upper
          oe_mis
          oe_mis_upper
        }
      }
    }
  `;
  const data = await safeFetch<any>("https://gnomad.broadinstitute.org/api/", {
    method: "POST",
    body: JSON.stringify({ query, variables: { gene_symbol: geneSymbol } }),
  });
  if (!data?.data?.gene?.gnomad_constraint) return {};
  const c = data.data.gene.gnomad_constraint;
  return {
    pli: c.pLI,
    oe_lof: c.oe_lof,
    oe_lof_upper: c.oe_lof_upper,
    oe_mis: c.oe_mis,
    oe_mis_upper: c.oe_mis_upper,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ClinVar (NCBI E-utilities)
// ═══════════════════════════════════════════════════════════════════

export async function queryClinvar(variant: Variant, vep: VepResult): Promise<ClinvarResult> {
  const sess: { rsid?: string; hgvs?: string } = {};
  if (variant.rsid?.toLowerCase().startsWith("rs")) sess.rsid = variant.rsid;
  if (variant.hgvs_g) sess.hgvs = variant.hgvs_g;
  if (vep.rsid?.toLowerCase().startsWith("rs")) sess.rsid = vep.rsid;

  // Try rsID first
  if (sess.rsid) {
    const uid = await clinvarSearchUid(sess.rsid);
    if (uid) {
      const data = await clinvarEsummary(uid);
      if (data) return data;
    }
  }

  // Try HGVS
  if (sess.hgvs) {
    const uid = await clinvarSearchUid(sess.hgvs);
    if (uid) {
      const data = await clinvarEsummary(uid);
      if (data) return data;
    }
  }

  return { error: "No ClinVar annotation found" };
}

async function clinvarSearchUid(term: string): Promise<string | null> {
  const data = await safeFetch<any>("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
    params: { db: "clinvar", term, retmode: "json", retmax: "1" },
  });
  if (!data?.esearchresult?.idlist?.length) return null;
  return data.esearchresult.idlist[0] as string;
}

async function clinvarEsummary(uid: string): Promise<ClinvarResult | null> {
  const data = await safeFetch<any>("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", {
    params: { db: "clinvar", id: uid, retmode: "json" },
  });
  if (!data?.result?.uids?.length) return null;
  const raw = data.result[data.result.uids[0] as string];
  if (!raw) return null;
  return parseClinvarRecord(raw);
}

function parseClinvarRecord(raw: any): ClinvarResult {
  const germline = raw.germline_classification ?? {};
  const traits: string[] = [];
  for (const traitSet of germline.trait_set ?? raw.trait_set ?? []) {
    if (typeof traitSet === "object") {
      const name = traitSet.trait_name;
      if (typeof name === "string") traits.push(name);
      else if (Array.isArray(name)) traits.push(...name.filter((n) => typeof n === "string"));
    }
  }
  return {
    accession: raw.accession,
    classification: germline.description,
    review_status: germline.review_status,
    last_evaluated: germline.last_evaluated,
    traits,
    source: "ncbi_eutils",
  };
}

// ═══════════════════════════════════════════════════════════════════
// UniProt
// ═══════════════════════════════════════════════════════════════════

export async function queryUniprot(
  geneSymbol: string,
  proteinPos?: number
): Promise<UniprotResult> {
  const searchData = await safeFetch<any>("https://rest.uniprot.org/uniprotkb/search", {
    params: {
      query: `gene:${geneSymbol} AND organism_id:9606 AND reviewed:true`,
      fields: "accession,id,gene_names,protein_name,length",
      format: "json",
      size: "1",
    },
  });
  if (!searchData?.results?.length) {
    return { error: `No UniProt entry for ${geneSymbol}` };
  }
  const entry = searchData.results[0];
  const accession = entry.primaryAccession;

  const fullData = await safeFetch<any>(`https://rest.uniprot.org/uniprotkb/${accession}.json`);
  if (!fullData) {
    return { error: `Could not fetch UniProt entry ${accession}` };
  }

  const functionTexts: string[] = [];
  for (const comment of fullData.comments ?? []) {
    if (comment.commentType === "FUNCTION") {
      for (const text of comment.texts ?? []) {
        if (text.value) functionTexts.push(text.value);
      }
    }
  }

  const featuresNear: UniprotResult["features_near_variant"] = [];
  if (proteinPos) {
    for (const feature of fullData.features ?? []) {
      const loc = feature.location ?? {};
      const start = loc.start?.value;
      const end = loc.end?.value;
      if (start && end && start <= proteinPos + 2 && end >= proteinPos - 2) {
        featuresNear.push({
          type: feature.type,
          description: feature.description,
          start,
          end,
        });
      }
    }
  }

  // Extract tissue specificity
  let tissueSpec: string | undefined;
  for (const comment of fullData.comments ?? []) {
    if (comment.commentType === "TISSUE SPECIFICITY") {
      const texts: string[] = [];
      for (const text of comment.texts ?? []) {
        if (text.value) texts.push(text.value);
      }
      if (texts.length > 0) tissueSpec = texts.join(" ");
    }
  }

  const funcText = functionTexts.join(" ");
  const [functionSummaryCn, proteinNameCn] = await Promise.all([
    translateFunction(funcText),
    Promise.resolve(translateProteinName(fullData.proteinDescription?.recommendedName?.fullName?.value)),
  ]);

  return {
    accession,
    gene_symbol: geneSymbol,
    protein_length: fullData.sequence?.length,
    protein_name: fullData.proteinDescription?.recommendedName?.fullName?.value,
    protein_name_cn: proteinNameCn,
    function: funcText,
    function_summary_cn: functionSummaryCn,
    tissue_specificity: tissueSpec,
    features_near_variant: featuresNear,
    source: "uniprot_api",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Literature (Europe PMC)
// ═══════════════════════════════════════════════════════════════════

export async function queryLiterature(variant: Variant, vep: VepResult): Promise<LiteratureResult> {
  const parts: string[] = [];
  if (vep.protein) {
    parts.push(`"${vep.protein}"`);
    const short = shortProteinChange(vep.protein);
    if (short) parts.push(`"${short}"`);
  }
  if (vep.cdna?.startsWith("c.")) parts.push(`"${vep.cdna}"`);
  if (variant.rsid) parts.push(`"${variant.rsid}"`);
  else if (variant.hgvs_g && !variant.hgvs_g.startsWith("NM_")) parts.push(`"${variant.hgvs_g}"`);

  const query = parts.length ? parts.join(" OR ") : `"${variant.raw}"`;
  const data = await safeFetch<any>("https://www.ebi.ac.uk/europepmc/webservices/rest/search", {
    params: { query, format: "json", pageSize: "10" },
  });
  if (!data) return { query, count: 0, articles: [] };

  const articles: LiteratureResult["articles"] = [];
  for (const rslt of data.resultList?.result ?? []) {
    articles.push({
      title: rslt.title,
      authors: rslt.authorString,
      journal: rslt.journalTitle,
      year: rslt.pubYear,
      pmid: rslt.pmid,
      doi: rslt.doi,
    });
  }
  return { query, count: data.hitCount ?? 0, articles };
}

function shortProteinChange(hgvsP: string): string | null {
  const m = hgvsP.match(/^p\.([A-Za-z]{3})(\d+)([A-Za-z]{3})$/);
  if (!m) return null;
  return `p.${m[1]![0]!.toUpperCase()}${m[2]}${m[3]![0]!.toUpperCase()}`;
}

// ═══════════════════════════════════════════════════════════════════
// EVE
// ═══════════════════════════════════════════════════════════════════

export async function queryEve(variant: Variant, vep: VepResult): Promise<EveResult | undefined> {
  if (!variant.chrom || !variant.pos) return undefined;
  if (!vep.protein || (vep.protein as string).includes("Ter")) return undefined;

  const geneSymbol = vep.gene_symbol ?? "";
  const protein = vep.protein ?? "";
  const m = protein.match(/p\.([A-Za-z]{3})(\d+)([A-Za-z]{3})$/);
  if (!m) return undefined;

  try {
    const data = await safeFetch<any>("https://evemodel.org/api/v1/predict", {
      method: "POST",
      body: JSON.stringify({
        gene_name: geneSymbol,
        mutations: [`${geneSymbol}-${m[1]![0]!.toUpperCase()}-${m[3]![0]!.toUpperCase()}`],
      }),
    });
    if (data?.predictions?.length) {
      const p = data.predictions[0];
      const score = p.eve_score ?? p.score;
      if (score != null) {
        return { score: parseFloat(score), class: p.eve_class ?? p.classification, source: "evemodel_api" };
      }
    }
  } catch {
    // EVE is optional
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// ACMG Evidence Engine
// ═══════════════════════════════════════════════════════════════════

function getGnomadEasAf(vep: VepResult): number | undefined {
  const freqs = vep.gnomad_frequencies ?? {};
  for (const key of ["gnomade_eas", "gnomadg_eas"]) {
    const v = freqs[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function getGnomadGlobalAf(vep: VepResult, gnomad: GnomadResult): number | undefined {
  for (const source of ["exome", "genome"] as const) {
    const g = gnomad[source];
    if (g && typeof g === "object" && g.af != null) return g.af;
  }
  const freqs = vep.gnomad_frequencies ?? {};
  for (const key of ["gnomade", "gnomadg"]) {
    const v = freqs[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function isLofVariant(vep: VepResult): boolean {
  const consequences = vep.consequence_terms ?? [];
  const lofTerms = new Set([
    "stop_gained",
    "frameshift_variant",
    "splice_donor_variant",
    "splice_acceptor_variant",
    "start_lost",
  ]);
  return consequences.some((c) => lofTerms.has(c));
}

function isMissense(vep: VepResult): boolean {
  return (vep.consequence_terms ?? []).includes("missense_variant");
}

function isSpliceAltered(vep: VepResult): boolean {
  const sai = vep.spliceai ?? {};
  const maxDelta = Math.max(
    sai.DS_AG ?? 0,
    sai.DS_AL ?? 0,
    sai.DS_DG ?? 0,
    sai.DS_DL ?? 0
  );
  return maxDelta >= 0.2;
}

function clinvarStarCount(clinvar: ClinvarResult): number {
  const status = (clinvar.review_status ?? "").toLowerCase().replace(/_/g, " ");
  if (status.includes("practice guideline")) return 4;
  if (status.includes("reviewed by expert panel")) return 3;
  if (status.includes("multiple submitters") && status.includes("criteria provided")) return 2;
  if (status.includes("single submitter") && status.includes("criteria provided")) return 1;
  if (status.includes("no assertion")) return 0;
  return 0;
}

export function buildAcmgEvidence(
  vep: VepResult,
  gnomad: GnomadResult,
  clinvar: ClinvarResult,
  constraint: ConstraintResult,
  _uniprot: UniprotResult,
  eve?: EveResult,
  secondVariantPathogenic = false
): AcmgResult {
  const evidence: AcmgEvidence[] = [];
  let pathogenicWeight = 0;
  let benignWeight = 0;

  const globalAf = getGnomadGlobalAf(vep, gnomad);
  const easAf = getGnomadEasAf(vep);
  const pli = constraint.pli;
  const oeLofUpper = constraint.oe_lof_upper;
  const cadd = vep.cadd_phred;
  const revel = vep.revel;
  const sai = vep.spliceai ?? {};
  const clinvarClass = (clinvar.classification ?? "").toLowerCase();
  const clinvarStars = clinvarStarCount(clinvar);

  // ── Benign criteria ──
  // BA1: AF > 5%
  if (globalAf != null && globalAf > 0.05) {
    evidence.push({ criterion: "BA1", strength: "Stand-alone", description: `gnomAD global AF=${globalAf.toExponential(2)} > 5%` });
    benignWeight += 8;
  } else if (easAf != null && easAf > 0.05) {
    evidence.push({ criterion: "BA1", strength: "Stand-alone", description: `gnomAD EAS AF=${easAf.toExponential(2)} > 5%` });
    benignWeight += 8;
  }

  // BS1: AF > 1%
  if (globalAf != null && globalAf > 0.01) {
    evidence.push({ criterion: "BS1", strength: "Strong", description: `gnomAD AF=${globalAf.toExponential(2)} > 1%` });
    benignWeight += 4;
  }

  // BP4: Multiple tools predict benign
  if (isMissense(vep)) {
    let silicoBenign = 0;
    if (revel != null && revel < 0.25) silicoBenign++;
    if (cadd != null && cadd < 15) silicoBenign++;
    const am = vep.alphamissense;
    if (am?.class === "likely_benign") silicoBenign++;
    if (silicoBenign >= 2) {
      evidence.push({ criterion: "BP4", strength: "Supporting", description: `Multiple in-silico tools predict benign (REVEL=${revel}, CADD=${cadd})` });
      benignWeight += 1;
    }
  }

  // ── Pathogenic criteria ──
  // PVS1: LOF variant
  if (isLofVariant(vep)) {
    if (pli != null && pli > 0.9) {
      evidence.push({ criterion: "PVS1", strength: "Very Strong", description: `LOF variant; pLI=${pli} (LOF-intolerant)` });
      pathogenicWeight += 8;
    } else if (oeLofUpper != null && oeLofUpper < 0.35) {
      evidence.push({ criterion: "PVS1_Strong", strength: "Strong", description: `LOF variant; LOEUF=${oeLofUpper}` });
      pathogenicWeight += 4;
    } else {
      evidence.push({ criterion: "PVS1_Moderate", strength: "Moderate", description: "LOF variant; no constraint data" });
      pathogenicWeight += 2;
    }
  }

  // PS1/PP5: ClinVar pathogenic
  if (clinvarClass.includes("pathogenic") && clinvarStars >= 3) {
    evidence.push({ criterion: "PS1", strength: "Strong", description: `ClinVar Pathogenic, ${clinvarStars} stars` });
    pathogenicWeight += 4;
  } else if (clinvarClass.includes("pathogenic") && clinvarStars >= 2) {
    evidence.push({ criterion: "PP5_Strong", strength: "Strong", description: `ClinVar Pathogenic, multiple submitters` });
    pathogenicWeight += 4;
  } else if (clinvarClass.includes("pathogenic") && clinvarStars >= 1) {
    evidence.push({ criterion: "PP5", strength: "Supporting", description: `ClinVar Pathogenic, single submitter` });
    pathogenicWeight += 1;
  } else if (clinvarClass.includes("pathogenic")) {
    evidence.push({ criterion: "PP5", strength: "Supporting", description: `ClinVar ${clinvar.classification}` });
    pathogenicWeight += 1;
  }

  if (clinvarClass.includes("likely_pathogenic") && clinvarStars >= 2) {
    evidence.push({ criterion: "PP5_Moderate", strength: "Moderate", description: `ClinVar Likely Pathogenic, ${clinvarStars} stars` });
    pathogenicWeight += 2;
  }

  // PM2: Absent/very rare
  if (globalAf != null && globalAf < 1e-5) {
    evidence.push({ criterion: "PM2", strength: "Moderate", description: `gnomAD AF=${globalAf.toExponential(2)} — extremely rare` });
    pathogenicWeight += 2;
  } else if (globalAf != null && globalAf < 1e-4) {
    evidence.push({ criterion: "PM2_Supporting", strength: "Supporting", description: `gnomAD AF=${globalAf.toExponential(2)} — very rare` });
    pathogenicWeight += 1;
  }

  // PM3: Second pathogenic variant
  if (secondVariantPathogenic) {
    evidence.push({ criterion: "PM3_Strong", strength: "Strong", description: "Second pathogenic variant in trans (recessive)" });
    pathogenicWeight += 4;
  }

  // PP3: In-silico evidence
  const maxSpliceai = Math.max(sai.DS_AG ?? 0, sai.DS_AL ?? 0, sai.DS_DG ?? 0, sai.DS_DL ?? 0);
  if (maxSpliceai >= 0.5) {
    evidence.push({ criterion: "PS3_Supporting", strength: "Supporting", description: `SpliceAI max delta=${maxSpliceai.toFixed(2)}` });
    pathogenicWeight += 1;
  } else if (maxSpliceai >= 0.2) {
    evidence.push({ criterion: "PP3_Splice", strength: "Supporting", description: `SpliceAI delta=${maxSpliceai.toFixed(2)}` });
    pathogenicWeight += 1;
  }

  if (isMissense(vep)) {
    if (revel != null && revel > 0.75) {
      evidence.push({ criterion: "PP3", strength: "Supporting", description: `REVEL=${revel} — damaging` });
      pathogenicWeight += 1;
    } else if (cadd != null && cadd >= 25) {
      evidence.push({ criterion: "PP3", strength: "Supporting", description: `CADD phred=${cadd}` });
      pathogenicWeight += 1;
    }
  }

  if (eve && (eve.score ?? 0) > 0.7) {
    evidence.push({ criterion: "PP3_EVE", strength: "Supporting", description: `EVE score=${eve.score?.toFixed(3)}` });
    pathogenicWeight += 1;
  }

  // ── Classification ──
  let classification: string;
  if (benignWeight >= 8) classification = ACMG_BENIGN;
  else if (benignWeight >= 4) classification = ACMG_LIKELY_BENIGN;
  else if (pathogenicWeight >= 10) classification = ACMG_PATHOGENIC;
  else if (pathogenicWeight >= 6) classification = ACMG_LIKELY_PATHOGENIC;
  else if (pathogenicWeight >= 2) classification = `${ACMG_VUS}_favor_pathogenic`;
  else if (benignWeight >= 2) classification = `${ACMG_VUS}_favor_benign`;
  else classification = ACMG_VUS;

  return { classification, evidence_items: evidence, pathogenic_score: pathogenicWeight, benign_score: benignWeight };
}

// ═══════════════════════════════════════════════════════════════════
// Markdown Report
// ═══════════════════════════════════════════════════════════════════

function val(v: any, def = "N/A"): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return def;
  return String(v);
}

export function buildMarkdown(result: Omit<FullResult, "markdown">): string {
  const v = result.variant;
  const vep = result.vep;
  const gnomad = result.gnomad;
  const clinvar = result.clinvar;
  const uniprot = result.uniprot;
  const lit = result.literature;
  const acmg = result.acmg;
  const constraint = result.constraint;
  const eve = result.eve;
  const qc = result.qc;

  const acmgMap: Record<string, string> = {
    [ACMG_PATHOGENIC]: "致病 (Pathogenic)",
    [ACMG_LIKELY_PATHOGENIC]: "可能致病 (Likely Pathogenic)",
    [ACMG_VUS]: "意义未明 (VUS)",
    "vus_favor_pathogenic": "VUS-偏致病 (VUS-favor pathogenic)",
    "vus_favor_benign": "VUS-偏良性 (VUS-favor benign)",
    [ACMG_LIKELY_BENIGN]: "可能良性 (Likely Benign)",
    [ACMG_BENIGN]: "良性 (Benign)",
  };

  const lines: string[] = [
    `# 变异功能影响分析报告：${v.hgvs_g}`,
    "",
    `**输入**：${v.raw.slice(0, 80)}  `,
    `**基因组坐标**：${v.hgvs_g ?? "-"}  `,
    `**转录本 / 蛋白**：${val(vep.transcript)} / ${val(vep.protein)}  `,
    `**ACMG 分类**：${acmgMap[acmg.classification] ?? acmg.classification}  `,
    "",
  ];

  // QC
  if (qc && Object.keys(qc).length > 0) {
    lines.push("## 0. 样本质量指标", "");
    lines.push("| 指标 | 值 |", "|------|----|");
    for (const [k, v_qc] of Object.entries(qc)) {
      lines.push(`| ${k} | ${v_qc} |`);
    }
    lines.push("");
  }

  // 1. Functional predictions
  lines.push("## 1. 功能预测 (VEP)", "");
  lines.push("| 工具 | 预测结果 | 分值 |", "|------|----------|------|");
  const sift = vep.sift ?? {};
  const polyphen = vep.polyphen ?? {};
  const am = vep.alphamissense ?? {};
  lines.push(`| SIFT | ${val(sift.prediction)} | ${val(sift.score)} |`);
  lines.push(`| PolyPhen | ${val(polyphen.prediction)} | ${val(polyphen.score)} |`);
  lines.push(`| AlphaMissense | ${val(am.class)} | ${val(am.pathogenicity)} |`);
  lines.push(`| CADD phred | ${val(vep.cadd_phred)} | — |`);

  if (vep.revel != null) {
    lines.push(`| REVEL | ${vep.revel > 0.5 ? "致病性" : "良性"} | ${vep.revel.toFixed(4)} |`);
  }

  const sai = vep.spliceai ?? {};
  const ds = [sai.DS_AG, sai.DS_AL, sai.DS_DG, sai.DS_DL];
  const noEffect = ds.every((v) => v === 0 || v === undefined);
  const dsStr = ds.map((v) => (v != null ? v : "—")).join("/");
  const maxSai = Math.max(sai.DS_AG ?? 0, sai.DS_AL ?? 0, sai.DS_DG ?? 0, sai.DS_DL ?? 0);
  let saiNote = "";
  if (maxSai >= 0.5) saiNote = " — 强剪接影响";
  else if (maxSai >= 0.2) saiNote = " — 中等剪接影响";
  lines.push(`| SpliceAI | ${noEffect ? "无剪接影响" : "可能存在剪接影响"} | DS_AG/AL/DG/DL = ${dsStr}${saiNote} |`);

  if (eve?.score != null) {
    lines.push(`| EVE | ${eve.score > 0.5 ? "致病性" : "良性"} | score=${eve.score.toFixed(4)} |`);
  }

  if (constraint && Object.keys(constraint).length > 0) {
    lines.push("", "| gnomAD 约束 | pLI | LOEUF | oe_mis |", "|-------------|-----|-------|--------|");
    lines.push(`| | ${val(constraint.pli)} | ${val(constraint.oe_lof_upper)} | ${val(constraint.oe_mis_upper)} |`);
  }
  lines.push("");

  // 2. Population frequencies
  lines.push("## 2. 人群频率", "", "| 来源 | AC | AN | AF |", "|------|----|----|----|");
  for (const source of ["exome", "genome"] as const) {
    const g = gnomad[source];
    if (g && typeof g === "object") {
      lines.push(`| gnomAD ${source === "exome" ? "外显子组" : "全基因组"} | ${val(g.ac)} | ${val(g.an)} | ${val(g.af)} |`);
    }
  }

  const vepFreqs = vep.gnomad_frequencies ?? {};
  const freqDisplay: Record<string, string> = {
    gnomade: "VEP 外显子组",
    gnomadg: "VEP 全基因组",
    gnomade_eas: "VEP 东亚外显子组",
    gnomadg_eas: "VEP 东亚全基因组",
  };
  for (const [k, label] of Object.entries(freqDisplay)) {
    const v_freq = vepFreqs[k];
    if (v_freq != null) lines.push(`| ${label} | — | — | ${v_freq} |`);
  }

  // GTEx
  const gtex = vep.gtex_expression;
  const gtexGene = gtex?.gene_expression;
  const gtexTranscript = gtex?.transcript_expression;
  if (gtexGene && Object.keys(gtexGene).length > 0) {
    lines.push("", "## 3. GTEx 组织表达 (mRNA TPM)", "");
    lines.push("| 组织 | TPM |", "|------|-----|");
    const sorted = Object.entries(gtexGene).sort((a, b) => b[1] - a[1]);
    for (const [tissue, tpm] of sorted.slice(0, 8)) {
      lines.push(`| ${tissue} | ${tpm} |`);
    }
  }
  if (gtexTranscript && Object.keys(gtexTranscript).length > 0) {
    lines.push("", "### 3.1 GTEx 转录本表达 (TPM)", "");
    const transcriptIds = Object.keys(gtexTranscript);
    // Show top 5 transcripts by max tissue expression
    const ranked = transcriptIds
      .map((tid) => {
        const tissues = gtexTranscript[tid] ?? {};
        const maxTpm = Math.max(...Object.values(tissues), 0);
        return { tid, maxTpm, tissues };
      })
      .sort((a, b) => b.maxTpm - a.maxTpm)
      .slice(0, 5);
    for (const { tid, tissues } of ranked) {
      lines.push(`**${tid}**:`);
      const sortedT = Object.entries(tissues).sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [tissue, tpm] of sortedT) {
        lines.push(`  - ${tissue}: ${tpm}`);
      }
    }
  }

  // 4. ClinVar
  lines.push("", "## 4. ClinVar 注释", "");
  if (clinvar.error) {
    lines.push(`- 未命中：${clinvar.error}`);
  } else {
    const clsMap: Record<string, string> = {
      Pathogenic: "致病",
      "Likely pathogenic": "可能致病",
      "Uncertain significance": "意义未明",
      "Likely benign": "可能良性",
      Benign: "良性",
    };
    const rawCls = clinvar.classification ?? "";
    lines.push(`- **Accession**：${val(clinvar.accession)}`);
    lines.push(`- **临床意义分类**：${clsMap[rawCls] ?? rawCls}（${rawCls}）`);
    lines.push(`- **审核状态**：${val(clinvar.review_status)}`);
    lines.push(`- **数据来源**：${val(clinvar.source)}`);
    lines.push(`- **关联表型**：${(clinvar.traits ?? []).join(", ") || "无"}`);
  }

  // 5. UniProt
  lines.push("", "## 5. UniProt 蛋白信息", "");
  if (uniprot.error && !uniprot.function) {
    lines.push(`- 查询失败：${uniprot.error}`);
  } else {
    lines.push(`- **UniProt Accession**：${val(uniprot.accession)}`);
    lines.push(`- **蛋白名称**：${val(uniprot.protein_name)}`);
    lines.push(`- **蛋白长度**：${val(uniprot.protein_length)} 个氨基酸`);
    lines.push(`- **数据来源**：${val(uniprot.source)}`);
    if (uniprot.function) lines.push(`- **功能描述**：${uniprot.function}`);
    const feats = uniprot.features_near_variant ?? [];
    if (feats.length > 0) {
      lines.push("- **变异附近的结构特征**：");
      const featMap: Record<string, string> = {
        Chain: "成熟链", Domain: "结构域", Region: "区域",
        "Binding site": "结合位点", "Active site": "活性位点",
        "Modified residue": "修饰残基", "Disulfide bond": "二硫键",
      };
      for (const f of feats) {
        lines.push(`  - ${featMap[f.type] ?? f.type}：${f.description ?? ""} [${f.start}-${f.end}]`);
      }
    }
  }

  // 6. Literature
  lines.push("", "## 6. 文献检索", "");
  lines.push(`- 检索式：\`${lit.query}\``);
  lines.push(`- 命中：${lit.count} 条`);
  if (lit.articles.length > 0) {
    for (const a of lit.articles.slice(0, 5)) {
      lines.push(`  - ${a.title}（${a.year}）PMID:${a.pmid}`);
    }
  } else {
    lines.push("  - 未找到该位点特异性文献。");
  }

  // 7. ACMG
  lines.push("", "## 7. ACMG 证据加权分类", "");
  lines.push(`**最终分类**：${acmgMap[acmg.classification] ?? acmg.classification}`);
  lines.push(`**致病分值**：${acmg.pathogenic_score} | **良性分值**：${acmg.benign_score}`);
  lines.push("");

  if (acmg.evidence_items.length > 0) {
    lines.push("### 证据项", "");
    lines.push("| 规则 | 强度 | 描述 |", "|------|------|------|");
    const strengthMap: Record<string, string> = {
      "Very Strong": "非常强", Strong: "强", Moderate: "中等", Supporting: "支持", "Stand-alone": "独立",
    };
    for (const e of acmg.evidence_items) {
      lines.push(`| ${e.criterion} | ${strengthMap[e.strength] ?? e.strength} | ${e.description} |`);
    }
  } else {
    lines.push("_无触发任何 ACMG 证据规则。_");
  }

  // 8. Summary
  lines.push("", "## 8. 综合解读", "");
  const summaryMap: Record<string, string> = {
    [ACMG_PATHOGENIC]: "致病 — 有充分的遗传学和功能证据支持该变异导致疾病。",
    [ACMG_LIKELY_PATHOGENIC]: "可能致病 — 有较强证据支持该变异与疾病相关。",
    "vus_favor_pathogenic": "意义未明，偏致病 — 有一些证据指向致病性，但不足以作出确定分级。",
    [ACMG_VUS]: "意义未明 — 现有证据不足以判断致病的或良性。",
    "vus_favor_benign": "意义未明，偏良性 — 多数证据指向良性，但尚未完全排除致病可能。",
    [ACMG_LIKELY_BENIGN]: "可能良性 — 多数证据支持该变异不致病。",
    [ACMG_BENIGN]: "良性 — 有充分证据表明该变异不引起疾病。",
  };
  lines.push(summaryMap[acmg.classification] ?? `ACMG分类：${acmg.classification}`);

  // Warnings
  if (acmg.pathogenic_score >= 6 && isLofVariant(vep) && (constraint.pli ?? 0) > 0.9) {
    lines.push(
      "",
      "> ⚠️ 该变异为**功能丧失 (LOF)** 变异，位于 LOF-不耐受基因中 (pLI > 0.9)。"
    );
  } else if (isSpliceAltered(vep)) {
    lines.push("", "> ⚠️ SpliceAI 预测该变异可能影响 mRNA 剪接。建议通过 RNA 分析验证。");
  }

  lines.push("", "---", "", "*由 grch38-variant-impact 生成。本报告仅供研究参考，不可作为临床诊断依据。*");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// Main orchestrator
// ═══════════════════════════════════════════════════════════════════

export async function analyzeVariant(
  input: string,
  options: {
    includeGnomad?: boolean;
    includeClinvar?: boolean;
    includeLiterature?: boolean;
    includeEve?: boolean;
    secondVariantPathogenic?: boolean;
  }
): Promise<FullResult> {
  // 1. Parse
  let variant = parseVariant(input);

  // 2. Resolve rsID if needed
  if (variant.rsid && !variant.chrom) {
    const resolved = await resolveRsid(variant.rsid);
    if (!resolved) throw new Error(`Could not resolve ${variant.rsid} to GRCh38 coordinates`);
    variant = resolved;
  }

  if (!variant.chrom || !variant.pos) {
    throw new Error("Could not determine variant coordinates");
  }

  // 3. Query VEP
  const { vep, updated } = await queryVep(variant);
  variant = updated;

  const geneSymbol = vep.gene_symbol;

  // 4. Query GTEx (using gene_symbol — Portal API requires symbol search first)
  const gtexData = await queryGtex(geneSymbol);
  if (gtexData) {
    vep.gtex_expression = gtexData;
  }

  // 5. Parallel queries
  const [
    gnomad,
    constraint,
    clinvar,
    uniprot,
    literature,
    eve,
  ] = await Promise.all([
    options.includeGnomad !== false ? queryGnomad(variant) : Promise.resolve({} as GnomadResult),
    options.includeGnomad !== false && geneSymbol ? queryGnomadConstraint(geneSymbol) : Promise.resolve({} as ConstraintResult),
    options.includeClinvar !== false ? queryClinvar(variant, vep) : Promise.resolve({} as ClinvarResult),
    geneSymbol ? queryUniprot(geneSymbol, vep.protein_start) : Promise.resolve({} as UniprotResult),
    options.includeLiterature !== false ? queryLiterature(variant, vep) : Promise.resolve({ query: "", count: 0, articles: [] } as LiteratureResult),
    options.includeEve !== false ? queryEve(variant, vep) : Promise.resolve(undefined),
  ]);

  // 6. ACMG
  const acmg = buildAcmgEvidence(
    vep,
    gnomad,
    clinvar,
    constraint,
    uniprot,
    eve,
    options.secondVariantPathogenic
  );

  const result: Omit<FullResult, "markdown"> = {
    variant: {
      raw: variant.raw,
      chrom: variant.chrom,
      pos: variant.pos,
      ref: variant.ref,
      alt: variant.alt,
      rsid: variant.rsid,
      hgvs_g: variant.hgvs_g,
    },
    qc: variant.qc ?? {},
    vep,
    gnomad,
    constraint,
    clinvar,
    uniprot,
    literature,
    eve,
    acmg,
  };

  const markdown = buildMarkdown(result);

  return { ...result, markdown };
}
