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
} from "@contracts/variant";
import {
  ACMG_BENIGN,
  ACMG_LIKELY_BENIGN,
  ACMG_VUS,
  ACMG_LIKELY_PATHOGENIC,
  ACMG_PATHOGENIC,
} from "@contracts/variant";

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
    `Expected: chr:pos:ref:alt, chr:pos ref>alt, HGVS (e.g. chr11:g.121567110C>G), rsID, NM_:c., or VCF tab-separated`
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
// GTEx Portal API v2 — uses Node.js https module (avoids SSL issues with fetch)
// Two-step: 1) search gene for versioned gencodeId, 2) query expression
// ═══════════════════════════════════════════════════════════════════

import { httpsRequest } from "../lib/https";

export async function queryGtex(
  geneSymbol: string | undefined
): Promise<Record<string, number> | undefined> {
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
  } catch {
    return undefined;
  }
  if (!gencodeId) return undefined;

  // Step 2: Query median gene expression
  try {
    const exprData = await httpsRequest<any>(
      `https://gtexportal.org/api/v2/expression/medianGeneExpression?gencodeId=${encodeURIComponent(gencodeId)}&datasetId=gtex_v8`
    );
    if (exprData?.data && exprData.data.length > 0) {
      const result: Record<string, number> = {};
      for (const item of exprData.data) {
        if (item.tissueSiteDetailId && item.median != null) {
          // Convert snake_case to display format
          const tissue = item.tissueSiteDetailId.replace(/_/g, " - ");
          result[tissue] = item.median;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  } catch {
    return undefined;
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

  return {
    accession,
    gene_symbol: geneSymbol,
    protein_length: fullData.sequence?.length,
    protein_name: fullData.proteinDescription?.recommendedName?.fullName?.value,
    protein_name_cn: translateProteinName(fullData.proteinDescription?.recommendedName?.fullName?.value),
    function: funcText,
    function_summary_cn: translateFunction(funcText),
    tissue_specificity: tissueSpec,
    features_near_variant: featuresNear,
    source: "uniprot_api",
  };
}

// ── Lightweight translation helpers ──
// These do term-by-term replacement, keeping proper nouns and abbreviations in English.

function translateProteinName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  // Common domain / motif translations
  const dict: Record<string, string> = {
    "ubiquitin carboxyl-terminal hydrolase": "泛素羧基末端水解酶",
    "E3 ubiquitin-protein ligase": "E3 泛素蛋白连接酶",
    "tyrosine kinase": "酪氨酸激酶",
    "serine/threonine-protein kinase": "丝氨酸/苏氨酸蛋白激酶",
    "growth factor receptor": "生长因子受体",
    "tumor protein": "肿瘤蛋白",
    "tumor suppressor": "肿瘤抑制因子",
    "DNA repair protein": "DNA 修复蛋白",
    "transcription factor": "转录因子",
    "zinc finger protein": "锌指蛋白",
    "G protein-coupled receptor": "G 蛋白偶联受体",
    "sodium channel protein": "钠通道蛋白",
    "calcium channel": "钙通道",
    "potassium channel": "钾通道",
    "dehydrogenase": "脱氢酶",
    "protease": "蛋白酶",
    "phosphatase": "磷酸酶",
    "phosphorylase": "磷酸化酶",
    "synthase": "合成酶",
    "ligase": "连接酶",
    "isomerase": "异构酶",
    "reductase": "还原酶",
    "transferase": "转移酶",
    "hydrolase": "水解酶",
    "receptor": "受体",
    "channel": "通道",
    "protein": "蛋白",
  };
  // Try phrase matches first (longer phrases first)
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  let result = name.toLowerCase();
  for (const key of sortedKeys) {
    if (result.includes(key)) {
      result = result.replace(new RegExp(key, "g"), dict[key]!);
    }
  }
  // If no substitution happened, return undefined
  if (result === name.toLowerCase()) return undefined;
  return result;
}

/**
 * Full-text translation of UniProt function description.
 * Replaces English scientific terms with Chinese equivalents,
 * keeping proper nouns, abbreviations, and gene names in English.
 * 200+ terms in dictionary.
 */
function translateFunction(func: string | undefined): string | undefined {
  if (!func || func.length < 10) return undefined;

  const dict: Record<string, string> = {
    // === Multi-word phrases (matched first, longer first) ===
    "post-replicative dna mismatch repair system": "复制后 DNA 错配修复系统",
    "dna mismatch repair": "DNA 错配修复",
    "mismatch repair": "错配修复",
    "base excision repair": "碱基切除修复",
    "nucleotide excision repair": "核苷酸切除修复",
    "homologous recombination": "同源重组",
    "non-homologous end joining": "非同源末端连接",
    "double-strand break repair": "双链断裂修复",
    "double-strand break": "双链断裂",
    "single-strand break": "单链断裂",
    "post-replicative": "复制后",
    "cell cycle checkpoint": "细胞周期检查点",
    "cell cycle arrest": "细胞周期阻滞",
    "g2/m transition": "G2/M 转换",
    "g1/s transition": "G1/S 转换",
    "signal transduction": "信号转导",
    "signaling pathway": "信号通路",
    "wnt signaling": "Wnt 信号",
    "mapk signaling": "MAPK 信号",
    "pi3k-akt signaling": "PI3K-Akt 信号",
    "p53 signaling": "p53 信号",
    "notch signaling": "Notch 信号",
    "tgfb signaling": "TGF-beta 信号",
    "nf-kappab signaling": "NF-kappaB 信号",
    "jak-stat signaling": "JAK-STAT 信号",
    "immune response": "免疫应答",
    "inflammatory response": "炎症反应",
    "innate immunity": "先天性免疫",
    "adaptive immunity": "适应性免疫",
    "antigen presentation": "抗原呈递",
    "t cell": "T 细胞",
    "b cell": "B 细胞",
    "nk cell": "NK 细胞",
    "dendritic cell": "树突状细胞",
    "macrophage": "巨噬细胞",
    "neutrophil": "中性粒细胞",
    "eosinophil": "嗜酸性粒细胞",
    "mast cell": "肥大细胞",
    "platelet": "血小板",
    "erythrocyte": "红细胞",
    "leukocyte": "白细胞",
    "apoptotic process": "凋亡过程",
    "programmed cell death": "程序性细胞死亡",
    "autophagic cell death": "自噬性细胞死亡",
    "necrotic cell death": "坏死性细胞死亡",
    "cell proliferation": "细胞增殖",
    "cell differentiation": "细胞分化",
    "cell migration": "细胞迁移",
    "cell adhesion": "细胞粘附",
    "cell division": "细胞分裂",
    "cell growth": "细胞生长",
    "cell survival": "细胞存活",
    "chromatin remodeling": "染色质重塑",
    "histone modification": "组蛋白修饰",
    "dna methylation": "DNA 甲基化",
    "transcriptional regulation": "转录调控",
    "transcriptional repression": "转录抑制",
    "transcriptional activation": "转录激活",
    "post-translational modification": "翻译后修饰",
    "protein ubiquitination": "蛋白泛素化",
    "protein phosphorylation": "蛋白磷酸化",
    "protein dephosphorylation": "蛋白去磷酸化",
    "protein acetylation": "蛋白乙酰化",
    "protein methylation": "蛋白甲基化",
    "protein degradation": "蛋白降解",
    "proteasomal degradation": "蛋白酶体降解",
    "protein stabilization": "蛋白稳定化",
    "protein complex": "蛋白复合物",
    "protein dimerization": "蛋白二聚化",
    "protein oligomerization": "蛋白寡聚化",
    "protein folding": "蛋白折叠",
    "protein transport": "蛋白转运",
    "protein localization": "蛋白定位",
    "protein-protein interaction": "蛋白-蛋白相互作用",
    "protein-ligand interaction": "蛋白-配体相互作用",
    "subcellular localization": "亚细胞定位",
    "nuclear localization": "核定位",
    "cytoplasmic localization": "胞质定位",
    "membrane localization": "膜定位",
    "mitochondrial localization": "线粒体定位",
    "tumorigenesis": "肿瘤发生",
    "tumor suppression": "肿瘤抑制",
    "tumor suppressor": "肿瘤抑制因子",
    "oncogene": "癌基因",
    "oncogenic": "致癌性的",
    "proto-oncogene": "原癌基因",
    "metastasis": "转移",
    "angiogenesis": "血管生成",
    "neurodegeneration": "神经退行性变",
    "synaptic transmission": "突触传递",
    "synaptic plasticity": "突触可塑性",
    "muscle contraction": "肌肉收缩",
    "cardiac muscle": "心肌",
    "skeletal muscle": "骨骼肌",
    "smooth muscle": "平滑肌",
    "lipid metabolism": "脂质代谢",
    "glucose metabolism": "葡萄糖代谢",
    "energy metabolism": "能量代谢",
    "amino acid metabolism": "氨基酸代谢",
    "nucleotide metabolism": "核苷酸代谢",
    "oxidative phosphorylation": "氧化磷酸化",
    "glycolysis": "糖酵解",
    "gluconeogenesis": "糖异生",
    "fatty acid oxidation": "脂肪酸氧化",
    "cholesterol biosynthesis": "胆固醇生物合成",
    "heme biosynthesis": "血红素生物合成",
    "dna replication": "DNA 复制",
    "dna transcription": "DNA 转录",
    "rna splicing": "RNA 剪接",
    "mrna processing": "mRNA 加工",
    "mrna stability": "mRNA 稳定性",
    "mrna transport": "mRNA 转运",
    "translation initiation": "翻译起始",
    "translation elongation": "翻译延伸",
    "ribosome biogenesis": "核糖体生物合成",
    "vesicle trafficking": "囊泡运输",
    "endocytosis": "内吞作用",
    "exocytosis": "外排作用",
    "phagocytosis": "吞噬作用",
    "pinocytosis": "胞饮作用",
    "autophagy": "自噬",
    "mitophagy": "线粒体自噬",
    "exosome": "外泌体",
    "extracellular matrix": "细胞外基质",
    "cell junction": "细胞连接",
    "tight junction": "紧密连接",
    "gap junction": "缝隙连接",
    "adherens junction": "粘着连接",
    "desmosome": "桥粒",
    "hemidesmosome": "半桥粒",
    "focal adhesion": "粘着斑",
    "cytoskeleton organization": "细胞骨架组织",
    "actin filament": "肌动蛋白丝",
    "microtubule": "微管",
    "intermediate filament": "中间丝",
    "spindle assembly": "纺锤体组装",
    "chromosome segregation": "染色体分离",
    "sister chromatid": "姐妹染色单体",
    "centromere": "着丝粒",
    "telomere": "端粒",
    "telomerase": "端粒酶",
    "dna damage response": "DNA 损伤应答",
    "dna damage checkpoint": "DNA 损伤检查点",
    "oxidative stress response": "氧化应激应答",
    "heat shock response": "热休克应答",
    "unfolded protein response": "未折叠蛋白应答",
    "hypoxia response": "低氧应答",
    "nutrient sensing": "营养感应",
    "insulin signaling": "胰岛素信号",
    "glucagon signaling": "胰高血糖素信号",
    "steroid hormone": "类固醇激素",
    "peptide hormone": "肽类激素",
    "thyroid hormone": "甲状腺激素",
    "retinoic acid": "视黄酸",
    "vitamin d": "维生素 D",
    "calcium ion": "钙离子",
    "iron ion": "铁离子",
    "zinc ion": "锌离子",
    "copper ion": "铜离子",
    "magnesium ion": "镁离子",
    "sodium ion": "钠离子",
    "potassium ion": "钾离子",
    "chloride ion": "氯离子",
    "hydrogen ion": "氢离子",
    "proton transport": "质子转运",
    "electron transport": "电子转运",
    "atp synthesis": "ATP 合成",
    "atp hydrolysis": "ATP 水解",
    "atp binding": "ATP 结合",
    "gtp binding": "GTP 结合",
    "gtp hydrolysis": "GTP 水解",
    "kinase activity": "激酶活性",
    "phosphatase activity": "磷酸酶活性",
    "ligase activity": "连接酶活性",
    "helicase activity": "解旋酶活性",
    "peptidase activity": "肽酶活性",
    "protease activity": "蛋白酶活性",
    "endonuclease activity": "核酸内切酶活性",
    "exonuclease activity": "核酸外切酶活性",
    "polymerase activity": "聚合酶活性",
    "transferase activity": "转移酶活性",
    "isomerase activity": "异构酶活性",
    "lyase activity": "裂解酶活性",
    "oxidoreductase activity": "氧化还原酶活性",
    "synthase activity": "合成酶活性",
    "transporter activity": "转运蛋白活性",
    "channel activity": "通道活性",
    "receptor activity": "受体活性",
    "transcription factor activity": "转录因子活性",
    "translation factor activity": "翻译因子活性",
    "rna binding": "RNA 结合",
    "dna binding": "DNA 结合",
    "metal ion binding": "金属离子结合",
    "calcium ion binding": "钙离子结合",
    "zinc ion binding": "锌离子结合",
    "magnesium ion binding": "镁离子结合",
    "nucleotide binding": "核苷酸结合",
    "nucleoside binding": "核苷结合",
    "fatty acid binding": "脂肪酸结合",
    "sterol binding": "固醇结合",
    "heme binding": "血红素结合",
    "flavin binding": "黄素结合",
    "s-adenosylmethionine binding": "S-腺苷甲硫氨酸结合",
    "folic acid binding": "叶酸结合",
    "biotin binding": "生物素结合",
    "coenzyme a binding": "辅酶 A 结合",
    "nad binding": "NAD 结合",
    "nadp binding": "NADP 结合",
    "fad binding": "FAD 结合",
    "fmn binding": "FMN 结合",
    "thiamine pyrophosphate binding": "硫胺素焦磷酸结合",
    "pyridoxal phosphate binding": "磷酸吡哆醛结合",
    "lipoic acid binding": "硫辛酸结合",
    "molybdopterin binding": "钼蝶呤结合",
    "iron-sulfur cluster binding": "铁硫簇结合",
    "2fe-2s cluster binding": "[2Fe-2S] 簇结合",
    "4fe-4s cluster binding": "[4Fe-4S] 簇结合",
    "structural constituent": "结构成分",
    "cytokine activity": "细胞因子活性",
    "growth factor activity": "生长因子活性",
    "hormone activity": "激素活性",
    "chemokine activity": "趋化因子活性",
    "interleukin": "白细胞介素",
    "interferon": "干扰素",
    "tumor necrosis factor": "肿瘤坏死因子",
    "transforming growth factor": "转化生长因子",
    "fibroblast growth factor": "成纤维细胞生长因子",
    "epidermal growth factor": "表皮生长因子",
    "vascular endothelial growth factor": "血管内皮生长因子",
    "platelet-derived growth factor": "血小板衍生生长因子",
    "nerve growth factor": "神经生长因子",
    "brain-derived neurotrophic factor": "脑源性神经营养因子",
    "colony stimulating factor": "集落刺激因子",
    "erythropoietin": "促红细胞生成素",
    "thrombopoietin": "促血小板生成素",
    "leptin": "瘦素",
    "adiponectin": "脂联素",
    "resistin": "抵抗素",
    "ghrelin": "胃饥饿素",
    "insulin-like growth factor": "胰岛素样生长因子",
    "parathyroid hormone": "甲状旁腺激素",
    "calcitonin": "降钙素",
    "osteocalcin": "骨钙素",
    "bone morphogenetic protein": "骨形态发生蛋白",
    "wnt protein": "Wnt 蛋白",
    "hedgehog protein": "Hedgehog 蛋白",
    "notch protein": "Notch 蛋白",
    "delta protein": "Delta 蛋白",
    "jagged protein": "Jagged 蛋白",
    "reelin": "Reelin 蛋白",
    "sonic hedgehog": "Sonic Hedgehog",
    "indian hedgehog": "Indian Hedgehog",
    "desert hedgehog": "Desert Hedgehog",
    "patched": "Patched",
    "smoothened": "Smoothened",
    "gli protein": "Gli 蛋白",
    "beta-catenin": "beta-catenin",
    "tcf/lef": "TCF/LEF",
    "dishevelled": "Dishevelled",
    "axin": "Axin",
    "apc protein": "APC 蛋白",
    "glycogen synthase kinase": "糖原合酶激酶",
    "casein kinase": "酪蛋白激酶",
    "polo-like kinase": "Polo 样激酶",
    "aurora kinase": "Aurora 激酶",
    "cyclin-dependent kinase": "细胞周期蛋白依赖性激酶",
    "cyclin": "细胞周期蛋白",
    "cdk inhibitor": "CDK 抑制剂",
    "retinoblastoma protein": "视网膜母细胞瘤蛋白",
    "e2f transcription factor": "E2F 转录因子",
    "foxo transcription factor": "FOXO 转录因子",
    "myc protein": "Myc 蛋白",
    "ras protein": "Ras 蛋白",
    "raf protein": "Raf 蛋白",
    "mek protein": "MEK 蛋白",
    "erk protein": "ERK 蛋白",
    "akt protein": "Akt 蛋白",
    "mtor protein": "mTOR 蛋白",
    "p70s6k": "p70S6K",
    "4e-bp1": "4E-BP1",
    "ulk1": "ULK1",
    "beclin-1": "Beclin-1",
    "lc3 protein": "LC3 蛋白",
    "p62 protein": "p62 蛋白",
    "parkin": "Parkin",
    "pink1": "PINK1",
    "dj-1": "DJ-1",
    "lrrk2": "LRRK2",
    "snca": "SNCA",
    "huntingtin": "Huntingtin",
    "app protein": "APP 蛋白",
    "psen1": "PSEN1",
    "psen2": "PSEN2",
    "bace1": "BACE1",
    "tau protein": "Tau 蛋白",
    "mapt": "MAPT",
    "bdnf": "BDNF",
    "ngf": "NGF",
    "nt-3": "NT-3",
    "nt-4": "NT-4",
    "gdnf": "GDNF",
    "igf-1": "IGF-1",
    "igf-2": "IGF-2",
    "insr": "INSR",
    "igf1r": "IGF1R",
    "egfr": "EGFR",
    "vegfr": "VEGFR",
    "fgfr": "FGFR",
    "pdgfr": "PDGFR",
    "ngfr": "NGFR",
    "trk receptor": "Trk 受体",
    "ret receptor": "RET 受体",
    "met receptor": "MET 受体",
    "alk receptor": "ALK 受体",
    "ros1": "ROS1",
    "her2": "HER2",
    "her3": "HER3",
    "her4": "HER4",
    "erbb receptor": "ErbB 受体",
    "insulin receptor substrate": "胰岛素受体底物",
    "grb2": "GRB2",
    "sos": "SOS",
    "shc protein": "Shc 蛋白",
    "gab protein": "GAB 蛋白",
    "crk protein": "Crk 蛋白",
    "shp phosphatase": "SHP 磷酸酶",
    "ptp phosphatase": "PTP 磷酸酶",
    "pten phosphatase": "PTEN 磷酸酶",
    "ship phosphatase": "SHIP 磷酸酶",
    "cbl protein": "CBL 蛋白",
    "soCS protein": "SOCS 蛋白",
    "stat protein": "STAT 蛋白",
    "smad protein": "SMAD 蛋白",
    "irf protein": "IRF 蛋白",
    "nf-kappa b": "NF-kappa B",
    "ikk complex": "IKK 复合物",
    "tbk1": "TBK1",
    "sting": "STING",
    "cgas": "cGAS",
    "aim2": "AIM2",
    "nlrp3": "NLRP3",
    "inflammasome": "炎症小体",
    "caspase": "Caspase",
    "bcl-2 family": "Bcl-2 家族",
    "bax protein": "Bax 蛋白",
    "bak protein": "Bak 蛋白",
    "bid protein": "Bid 蛋白",
    "bim protein": "Bim 蛋白",
    "puma protein": "PUMA 蛋白",
    "noxa protein": "Noxa 蛋白",
    "bad protein": "Bad 蛋白",
    "bak1": "BAK1",
    "bok protein": "Bok 蛋白",
    "mcl-1": "Mcl-1",
    "bcl-xL": "Bcl-xL",
    "bcl-w": "Bcl-w",
    "a1/bfl-1": "A1/Bfl-1",
    "boo/diva": "Boo/Diva",
    "apaf-1": "Apaf-1",
    "cytochrome c": "细胞色素 c",
    "diablo/smac": "Diablo/Smac",
    "htra2/omi": "HtrA2/Omi",
    "endonuclease g": "Endonuclease G",
    "aif protein": "AIF 蛋白",
    "parp protein": "PARP 蛋白",
    "xiap protein": "XIAP 蛋白",
    "ciap protein": "cIAP 蛋白",
    "survivin": "Survivin",
    "livin/ml-iap": "Livin/ML-IAP",
    "iap protein": "IAP 蛋白",
    "trail": "TRAIL",
    "fas ligand": "Fas 配体",
    "tnf-alpha": "TNF-alpha",
    "fas receptor": "Fas 受体",
    "death receptor": "死亡受体",
    "death domain": "死亡结构域",
    "p53 protein": "p53 蛋白",
    "mdm2 protein": "MDM2 蛋白",
    "arf protein": "ARF 蛋白",
    "atm kinase": "ATM 激酶",
    "atr kinase": "ATR 激酶",
    "chk1 kinase": "Chk1 激酶",
    "chk2 kinase": "Chk2 激酶",
    "brca1": "BRCA1",
    "brca2": "BRCA2",
    "palb2": "PALB2",
    "rad51": "RAD51",
    "rad52": "RAD52",
    "rad54": "RAD54",
    "xrcc protein": "XRCC 蛋白",
    "ku protein": "Ku 蛋白",
    "dna-pk": "DNA-PK",
    "ligase iv": "连接酶 IV",
    "xrcc4": "XRCC4",
    "xlF/ccernunnos": "XLF/Cernunnos",
    "pnkp": "PNKP",
    "aplx": "APLX",
    "aprataxin": "Aprataxin",
    "tyrosyl-dna phosphodiesterase": "酪氨酰-DNA 磷酸二酯酶",
    "mre11 complex": "Mre11 复合物",
    "ctip protein": "CtIP 蛋白",
    "exonuclease 1": "核酸外切酶 1",
    "flap endonuclease": "瓣状核酸内切酶",
    "dna glycosylase": "DNA 糖基化酶",
    " ap endonuclease": " AP 核酸内切酶",
    "dna ligase": "DNA 连接酶",
    "dna polymerase": "DNA 聚合酶",
    "primase": "引物酶",
    "topoisomerase": "拓扑异构酶",
    "helicase": "解旋酶",
    "recq helicase": "RecQ 解旋酶",
    "wrn helicase": "WRN 解旋酶",
    "blm helicase": "BLM 解旋酶",
    "rts helicase": "RTS 解旋酶",
    "recq5 helicase": "RecQ5 解旋酶",
    "dna2 helicase": "DNA2 解旋酶",
    "werner syndrome": "Werner 综合征",
    "bloom syndrome": "Bloom 综合征",
    "rothmund-thomson syndrome": "Rothmund-Thomson 综合征",
    "fanconi anemia": "范可尼贫血",
    "ataxia telangiectasia": "共济失调毛细血管扩张症",
    "nijmegen breakage syndrome": "Nijmegen 断裂综合征",
    "cockayne syndrome": "Cockayne 综合征",
    "xeroderma pigmentosum": "着色性干皮病",
    "trichothiodystrophy": "毛发硫营养不良",
    "lynch syndrome": "林奇综合征",
    "hereditary nonpolyposis colorectal cancer": "遗传性非息肉性结直肠癌",
    "li-fraumeni syndrome": "Li-Fraumeni 综合征",
    "cowden syndrome": "Cowden 综合征",
    "bannayan-riley-ruvalcaba syndrome": "Bannayan-Riley-Ruvalcaba 综合征",
    "peutz-jeghers syndrome": "Peutz-Jeghers 综合征",
    "von hippel-lindau disease": "von Hippel-Lindau 病",
    "neurofibromatosis": "神经纤维瘤病",
    "tuberous sclerosis": "结节性硬化症",
    "beckwith-wiedemann syndrome": "Beckwith-Wiedemann 综合征",
    "silver-russell syndrome": "Silver-Russell 综合征",
    "prader-willi syndrome": "Prader-Willi 综合征",
    "angelman syndrome": "Angelman 综合征",
    "williams syndrome": "Williams 综合征",
    "smith-magenis syndrome": "Smith-Magenis 综合征",
    "cri du chat syndrome": "猫叫综合征",
    "down syndrome": "唐氏综合征",
    "edwards syndrome": "Edwards 综合征",
    "patau syndrome": "Patau 综合征",
    "klinefelter syndrome": "Klinefelter 综合征",
    "turner syndrome": "Turner 综合征",
    "triple x syndrome": "XXX 综合征",
    "xYY syndrome": "XYY 综合征",
    "components of the": "的组成部分",
    "component of the": "的组成部分",
    "component of": "的组成部分",
    "part of the": "的组成部分",
    "functions as a": "作为...发挥功能",
    "functions as": "作为...发挥功能",
    "acts as a": "作为",
    "acts as": "作为",
    "plays a role in": "在...中发挥作用",
    "plays a critical role in": "在...中发挥关键作用",
    "plays an essential role in": "在...中发挥 essential 作用",
    "plays an important role in": "在...中发挥重要作用",
    "plays a major role in": "在...中发挥主要作用",
    "plays a minor role in": "在...中发挥次要作用",
    "plays a central role in": "在...中发挥中心作用",
    "plays a regulatory role in": "在...中发挥调控作用",
    "plays a protective role in": "在...中发挥保护作用",
    "is required for": "对...是必需的",
    "is essential for": "对...是 essential 的",
    "is critical for": "对...是关键的",
    "is important for": "对...是重要的",
    "is necessary for": "对...是必需的",
    "is involved in": "参与",
    "participates in": "参与",
    "contributes to": "有助于",
    "is implicated in": "与...有关",
    "has a role in": "在...中发挥作用",
    "catalyzes the": "催化",
    "catalytic activity": "催化活性",
    "promotes the": "促进",
    "induces the": "诱导",
    "inhibits the": "抑制",
    "represses the": "抑制",
    "activates the": "激活",
    "stimulates the": "刺激",
    "mediates the": "介导",
    "regulates the": "调控",
    "negatively regulates": "负向调控",
    "positively regulates": "正向调控",
    "directly regulates": "直接调控",
    "indirectly regulates": "间接调控",
    "cooperates with": "与...协同作用",
    "interacts with": "与...相互作用",
    "associates with": "与...相关联",
    "forms a complex with": "与...形成复合物",
    "binds to": "结合于",
    "specifically binds": "特异性结合",
    "directly binds": "直接结合",
    "indirectly binds": "间接结合",
    "degrades the": "降解",
    "destabilizes the": "去稳定化",
    "stabilizes the": "稳定化",
    "modulates the": "调节",
    "facilitates the": "促进",
    "enhances the": "增强",
    "attenuates the": "减弱",
    "antagonizes the": "拮抗",
    "synergizes with": "与...协同",
    "protects against": "保护免受",
    "defends against": "防御",
    "responds to": "响应",
    "senses": "感应",
    "recognizes": "识别",
    "discriminates": "区分",
    "selects": "选择",
    "sorts": "分选",
    "targets": "靶向",
    "directs": "引导",
    "guides": "引导",
    "scaffolds": "支架",
    "anchors": "锚定",
    "tethers": "拴系",
    "links": "连接",
    "bridges": "桥接",
    "couples": "偶联",
    "uncouples": "解偶联",
    "sequesters": "隔离",
    "stores": "储存",
    "releases": "释放",
    "exports": "输出",
    "imports": "输入",
    "translocates": "易位",
    "recruits": "募集",
    "assembles": "组装",
    "disassembles": "解组装",
    "polymerizes": "聚合",
    "depolymerizes": "解聚",
    "cross-links": "交联",
    "modifies": "修饰",
    "cleaves": "切割",
    "splits": "分裂",
    "fragments": "片段化",
    "ligates": "连接",
    "anneals": "退火",
    "melts": "熔解",
    "renatures": "复性",
    "denatures": "变性",
    "folds": "折叠",
    "unfolds": "去折叠",
    "refolds": "重折叠",
    "misfolds": "错误折叠",
    "aggregates": "聚集",
    "disaggregates": "解聚集",
    "solubilizes": "增溶",
    "precipitates": "沉淀",
    "crystallizes": "结晶",
    "dissolves": "溶解",
    " suspends": " 悬浮",
    "sediments": "沉降",
    "centrifuges": "离心",
    "filters": "过滤",
    "purifies": "纯化",
    "enriches": "富集",
    "depletes": "耗竭",
    "concentrates": "浓缩",
    "dilutes": "稀释",
    "mixes": "混合",
    "separates": "分离",
    "extracts": "提取",
    "isolates": "分离",
    "detects": "检测",
    "measures": "测量",
    "quantifies": "定量",
    "characterizes": "表征",
    "identifies": "鉴定",
    "validates": "验证",
    "confirms": "确认",
    "demonstrates": "证明",
    "shows": "显示",
    "reveals": "揭示",
    "suggests": "提示",
    "indicates": "表明",
    "implies": "暗示",
    "predicts": "预测",
    "correlates with": "与...相关",
    "overlaps with": "与...重叠",
    "co-localizes with": "与...共定位",
    "co-expresses with": "与...共表达",
    "co-purifies with": "与...共纯化",
    "co-immunoprecipitates with": "与...共免疫沉淀",
    "phosphorylates": "磷酸化",
    "dephosphorylates": "去磷酸化",
    "ubiquitinates": "泛素化",
    "deubiquitinates": "去泛素化",
    "sumoylates": "SUMO 化",
    "desumoylates": "去 SUMO 化",
    "acetylates": "乙酰化",
    "deacetylates": "去乙酰化",
    "methylates": "甲基化",
    "demethylates": "去甲基化",
    "glycosylates": "糖基化",
    "deglycosylates": "去糖基化",
    "hydroxylates": "羟基化",
    "dehydroxylates": "去羟基化",
    "oxidizes": "氧化",
    "reduces": "还原",
    "nitrosylates": "亚硝基化",
    "palmitoylates": "棕榈酰化",
    "myristoylates": "豆蔻酰化",
    "prenylates": "异戊烯化",
    "farnesylates": "法尼基化",
    "geranylgeranylates": "香叶基香叶基化",
    "ribosylates": "核糖基化",
    "adenylates": "腺苷酸化",
    "uridylates": "尿苷酸化",
    "glutathionylates": "谷胱甘肽化",
    "sulfates": "硫酸化",
    "sulfonates": "磺化",
    "phosphatidylates": "磷脂酰化",
    "activates": "激活",
    "inactivates": "失活",
    "upregulates": "上调",
    "downregulates": "下调",
    "overexpresses": "过表达",
    "underexpresses": "低表达",
    "knockdown": "敲低",
    "knockout": "敲除",
    "knockin": "敲入",
    "silences": "沉默",
    "complements": "互补",
    "rescues": "拯救",
    "suppresses": "抑制",
    "enhances": "增强",
    "augments": "增加",
    "diminishes": "减少",
    "abolishes": "消除",
    "restores": "恢复",
    "maintains": "维持",
    "preserves": "保存",
    "protects": "保护",
    "damages": "损伤",
    "injures": "伤害",
    "destroys": "破坏",
    "eliminates": "消除",
    "removes": "去除",
    "replaces": "替换",
    "substitutes": "替代",
    "exchanges": "交换",
    "transfers": "转移",
    "donates": "捐赠",
    "accepts": "接受",
    "transports": "运输",
    "channels": "通道",
    "pumps": "泵",
    "symports": "同向转运",
    "antiports": "反向转运",
    "uniports": "单向转运",
    "cotransports": "共转运",
    "endocytoses": "内吞",
    "exocytoses": "外排",
    "phagocytoses": "吞噬",
    "pinocytoses": "胞饮",
    "transcytoses": "转胞吞",
    "diacytoses": "穿胞",
    "engulfs": "吞没",
    "internalizes": "内化",
    "externalizes": "外化",
    "secretes": "分泌",
    "absorbs": "吸收",
    "endocytosed": "被内吞",
    "exocytosed": "被外排",
    "phagocytosed": "被吞噬",
    "pinocytosed": "被胞饮",
    "engulfed": "被吞没",
    "internalized": "被内化",
    "externalized": "被外化",
    "secreted": "被分泌",
    "absorbed": "被吸收",
    "uptaken": "被摄取",
    "taken up": "被摄取",
    "incorporated": "被整合",
    "integrated": "被整合",
    "embedded": "被嵌入",
    "inserted": "被插入",
    "translocated": "被易位",
    "transferred": "被转移",
    "transported": "被运输",
    "conducted": "被传导",
    "transmitted": "被传递",
    "propagated": "被传播",
    "amplified": "被放大",
    "attenuated": "被衰减",
    "modulated": "被调节",
    "regulated": "被调控",
    "controlled": "被控制",
    "governed": "被控制",
    "determined": "被决定",
    "specified": "被指定",
    "defined": "被定义",
    "established": "被建立",
    "initiated": "被启动",
    "terminated": "被终止",
    "completed": "被完成",
    "executed": "被执行",
    "performed": "被执行",
    "carried out": "被执行",
    "accomplished": "被完成",
    "achieved": "被实现",
    "realized": "被实现",
    "fulfilled": "被满足",
    "satisfied": "被满足",
    "met": "被满足",
    "fulfills": "满足",
    "satisfies": "满足",
    "meets": "满足",
    "requires": "需要",
    "needs": "需要",
    "demands": "要求",
    "depends on": "依赖于",
    "relies on": "依赖于",
    "is dependent on": "依赖于",
    "is independent of": "独立于",
    "is dispensable for": "对...是可有可无的",
    "is indispensable for": "对...是不可或缺的",
    "is sufficient for": "对...是充分的",
    "is insufficient for": "对...是不充分的",
    "is redundant with": "与...是冗余的",
    "is complementary to": "与...是互补的",
    "is additive to": "与...是叠加的",
    "is synergistic with": "与...是协同的",
    "is antagonistic to": "与...是拮抗的",
    "is epistatic to": "对...是上位性的",
    "is hypostatic to": "对...是下位性的",
    "is dominant over": "对...是显性的",
    "is recessive to": "对...是隐性的",
    "is semi-dominant": "是半显性的",
    "is co-dominant": "是共显性的",
    "is incompletely dominant": "是不完全显性的",
    "is haploinsufficient": "是单倍剂量不足的",
    "is haplosufficient": "是单倍剂量充足的",
    "is triplosensitive": "是三倍剂量敏感的",
    "is triploinsensitive": "是三倍剂量不敏感的",
    "is dosage-sensitive": "是剂量敏感的",
    "is dosage-insensitive": "是剂量不敏感的",
    "is essential": "是 essential 的",
    "is non-essential": "是非 essential 的",
    "is conditionally essential": "是条件性 essential 的",
    "is synthetic lethal with": "与...是合成致死的",
    "is synthetic sick with": "与...是合成病态的",
    "is synthetic rescue with": "与...是合成拯救的",
    "is paralogous to": "与...是旁系同源的",
    "is orthologous to": "与...是直系同源的",
    "is homologous to": "与...是同源的",
    "is analogous to": "与...是类似的",
    "is heterologous to": "与...是异源的",
    "is xenologous to": "与...是异种同源的",
    "is analogous": "是类似的",
    "is homologous": "是同源的",
    "is orthologous": "是直系同源的",
    "is paralogous": "是旁系同源的",
    "is xenologous": "是异种同源的",
    "is conserved": "是保守的",
    "is divergent": "是分歧的",
    "is specific": "是特异的",
    "is non-specific": "是非特异的",
    "is promiscuous": "是混杂的",
    "is selective": "是选择性的",
    "is permissive": "是允许的",
    "is restrictive": "是限制性的",
    "is constitutive": "是组成性的",
    "is inducible": "是可诱导的",
    "is repressible": "是可抑制的",
    "is facultative": "是兼性的",
    "is obligate": "是专性的",
    "is transient": "是瞬时的",
    "is stable": "是稳定的",
    "is unstable": "是不稳定的",
    "is dynamic": "是动态的",
    "is static": "是静态的",
    "is plastic": "是可塑的",
    "is rigid": "是刚性的",
    "is flexible": "是柔性的",
    "is modular": "是模块化的",
    "is integral": "是整合的",
    "is peripheral": "是外周的",
    "is central": "是中心的",
    "is nuclear": "是核的",
    "is cytoplasmic": "是胞质的",
    "is mitochondrial": "是线粒体的",
    "is peroxisomal": "是过氧化物酶体的",
    "is lysosomal": "是溶酶体的",
    "is endosomal": "是内体性的",
    "is golgi": "是高尔基体的",
    "is er": "是内质网的",
    "is plasma membrane": "是质膜的",
    "is membrane-bound": "是膜结合的",
    "is secreted": "是分泌的",
    "is extracellular": "是细胞外的",
    "is intracellular": "是细胞内的",
    "is intercellular": "是细胞间的",
    "is autocrine": "是自分泌的",
    "is paracrine": "是旁分泌的",
    "is endocrine": "是内分泌的",
    "is juxtacrine": "是近分泌的",
    "is synaptic": "是突触的",
    "is gap junction-mediated": "是缝隙连接介导的",
    "is contact-dependent": "是接触依赖的",
    "is ligand-dependent": "是配体依赖的",
    "is receptor-dependent": "是受体依赖的",
    "is kinase-dependent": "是激酶依赖的",
    "is phosphorylation-dependent": "是磷酸化依赖的",
    "is ubiquitination-dependent": "是泛素化依赖的",
    "is acetylation-dependent": "是乙酰化依赖的",
    "is methylation-dependent": "是甲基化依赖的",
    "is calcium-dependent": "是钙依赖的",
    "is atp-dependent": "是 ATP 依赖的",
    "is gtp-dependent": "是 GTP 依赖的",
    "is mg2+-dependent": "是 Mg2+ 依赖的",
    "is mn2+-dependent": "是 Mn2+ 依赖的",
    "is zn2+-dependent": "是 Zn2+ 依赖的",
    "is fe2+-dependent": "是 Fe2+ 依赖的",
    "is na+-dependent": "是 Na+ 依赖的",
    "is k+-dependent": "是 K+ 依赖的",
    "is cl--dependent": "是 Cl- 依赖的",
    "is ph-dependent": "是 pH 依赖的",
    "is temperature-dependent": "是温度依赖的",
    "is light-dependent": "是光依赖的",
    "is oxygen-dependent": "是氧依赖的",
    "is redox-dependent": "是氧化还原依赖的",
    "is voltage-dependent": "是电压依赖的",
    "is ligand-gated": "是配体门控的",
    "is voltage-gated": "是电压门控的",
    "is mechanically-gated": "是机械门控的",
    "is thermally-gated": "是热门控的",
    "is ph-gated": "是 pH 门控的",
    "is light-gated": "是光门控的",
    "is stretch-activated": "是牵张激活的",
    "is store-operated": "是 store-operated 的",
    "is receptor-operated": "是受体操作的",
    "is second messenger-operated": "是第二信使操作的",
    "is constitutively active": "是组成性活性的",
    "is basally active": "是基础活性的",
    "is inducibly active": "是可诱导活性的",
    "is transiently active": "是瞬时活性的",
    "is persistently active": "是持续活性的",
    "is cyclically active": "是周期性活性的",
    "is pulsatile": "是脉冲式的",
    "is oscillatory": "是振荡的",
    "is switch-like": "是开关式的",
    "is graded": "是渐变的",
    "is all-or-none": "是全或无的",
    "is digital": "是数字式的",
    "is analog": "是模拟式的",
    "is binary": "是二元的",
    "is ternary": "是三元的",
    "is multistate": "是多状态的",
    "is bistable": "是双稳态的",
    "is monostable": "是单稳态的",
    "is metastable": "是亚稳态的",
    "is irreversible": "是不可逆的",
    "is reversible": "是可逆的",
    "is unidirectional": "是单向的",
    "is bidirectional": "是双向的",
    "is polarized": "是极化的",
    "is depolarized": "是去极化的",
    "is hyperpolarized": "是超极化的",
    "is repolarized": "是复极化的",
    "is sensitized": "是敏化的",
    "is desensitized": "是脱敏的",
    "is primed": "是预激的",
    "is activated": "被激活",
    "is inactivated": "被失活",
    "is upregulated": "被上调",
    "is downregulated": "被下调",
    "is overexpressed": "被过表达",
    "is underexpressed": "被低表达",
    "is knocked down": "被敲低",
    "is knocked out": "被敲除",
    "is knocked in": "被敲入",
    "is silenced": "被沉默",
    "is complemented": "被互补",
    "is rescued": "被拯救",
    "is suppressed": "被抑制",
    "is enhanced": "被增强",
    "is augmented": "被增加",
    "is diminished": "被减少",
    "is abolished": "被消除",
    "is restored": "被恢复",
    "is maintained": "被维持",
    "is preserved": "被保存",
    "is protected": "被保护",
    "is damaged": "被损伤",
    "is injured": "被伤害",
    "is destroyed": "被破坏",
    "is eliminated": "被消除",
    "is removed": "被去除",
    "is replaced": "被替换",
    "is substituted": "被替代",
    "is exchanged": "被交换",
    "is transferred": "被转移",
    "is transported": "被运输",
    "is conducted": "被传导",
    "is transmitted": "被传递",
    "is propagated": "被传播",
    "is amplified": "被放大",
    "is attenuated": "被衰减",
    "is modulated": "被调节",
    "is regulated": "被调控",
    "is controlled": "被控制",
    "is governed": "被控制",
    "is determined": "被决定",
    "is specified": "被指定",
    "is defined": "被定义",
    "is established": "被建立",
    "is initiated": "被启动",
    "is terminated": "被终止",
    "is completed": "被完成",
    "is executed": "被执行",
    "is performed": "被执行",
    "is carried out": "被执行",
    "is accomplished": "被完成",
    "is achieved": "被实现",
    "is realized": "被实现",
    "is fulfilled": "被满足",
    "is satisfied": "被满足",
    "genome stability": "基因组稳定性",
    "genomic stability": "基因组稳定性",
    "genome integrity": "基因组完整性",
    "genomic integrity": "基因组完整性",
    "dna integrity": "DNA 完整性",
    "chromosomal stability": "染色体稳定性",
    "chromosomal integrity": "染色体完整性",
    "telomere maintenance": "端粒维持",
    "telomere length": "端粒长度",
    "telomerase activity": "端粒酶活性",
    "dna replication fidelity": "DNA 复制保真度",
    "transcription fidelity": "转录保真度",
    "translation fidelity": "翻译保真度",
    "protein synthesis": "蛋白合成",
    "protein quality control": "蛋白质量控制",
    "protein homeostasis": "蛋白稳态",
    "proteostasis": "蛋白质稳态",
    "cellular homeostasis": "细胞稳态",
    "tissue homeostasis": "组织稳态",
    "organ homeostasis": "器官稳态",
    "systemic homeostasis": "系统稳态",
    "metabolic homeostasis": "代谢稳态",
    "energy homeostasis": "能量稳态",
    "redox homeostasis": "氧化还原稳态",
    "calcium homeostasis": "钙稳态",
    "iron homeostasis": "铁稳态",
    "zinc homeostasis": "锌稳态",
    "copper homeostasis": "铜稳态",
    "magnesium homeostasis": "镁稳态",
    "sodium homeostasis": "钠稳态",
    "potassium homeostasis": "钾稳态",
    "chloride homeostasis": "氯稳态",
    "ph homeostasis": "pH 稳态",
    "osmotic homeostasis": "渗透压稳态",
    "volume homeostasis": "容量稳态",
    "pressure homeostasis": "压力稳态",
    "temperature homeostasis": "温度稳态",
    "immune homeostasis": "免疫稳态",
    "inflammatory homeostasis": "炎症稳态",
    "microbiome homeostasis": "微生物组稳态",
    "gut homeostasis": "肠道稳态",
    "skin homeostasis": "皮肤稳态",
    "bone homeostasis": "骨骼稳态",
    "cartilage homeostasis": "软骨稳态",
    "muscle homeostasis": "肌肉稳态",
    "neuronal homeostasis": "神经元稳态",
    "synaptic homeostasis": "突触稳态",
    "network homeostasis": "网络稳态",
    "circuit homeostasis": "回路稳态",
    "plasticity": "可塑性",
    "homeostatic plasticity": "稳态可塑性",
    "hebbian plasticity": "Hebbian 可塑性",
    "anti-hebbian plasticity": "Anti-Hebbian 可塑性",
    "structural plasticity": "结构可塑性",
    "functional plasticity": "功能可塑性",
    "synaptic scaling": "突触缩放",
    "metaplasticity": "元可塑性",
    "memory consolidation": "记忆巩固",
    "memory formation": "记忆形成",
    "memory retrieval": "记忆提取",
    "memory extinction": "记忆消退",
    "memory reconsolidation": "记忆再巩固",
    "long-term potentiation": "长时程增强",
    "long-term depression": "长时程抑制",
    "spike-timing-dependent plasticity": "锋电位时序依赖可塑性",
    "short-term plasticity": "短时程可塑性",
    "presynaptic plasticity": "突触前可塑性",
    "postsynaptic plasticity": "突触后可塑性",
    "transcriptional memory": "转录记忆",
    "epigenetic memory": "表观遗传记忆",
    "immunological memory": "免疫记忆",
    "metabolic memory": "代谢记忆",
    "mitochondrial memory": "线粒体记忆",
    "stress memory": "应激记忆",
    "priming": "预激",
    "trained immunity": "训练免疫",
    "innate immune memory": "先天性免疫记忆",
    "disease tolerance": "疾病耐受",
    "disease resistance": "疾病抵抗",
    "host defense": "宿主防御",
    "pathogen recognition": "病原体识别",
    "pattern recognition": "模式识别",
    "damage-associated molecular pattern": "损伤相关分子模式",
    "pathogen-associated molecular pattern": "病原体相关分子模式",
    "toll-like receptor": "Toll 样受体",
    "nod-like receptor": "NOD 样受体",
    "rig-i-like receptor": "RIG-I 样受体",
    "c-type lectin receptor": "C 型凝集素受体",
    "scavenger receptor": "清道夫受体",
    "complement receptor": "补体受体",
    "fc receptor": "Fc 受体",
    "t cell receptor": "T 细胞受体",
    "b cell receptor": "B 细胞受体",
    "natural killer cell receptor": "NK 细胞受体",
    "killer cell immunoglobulin-like receptor": "杀伤细胞免疫球蛋白样受体",
    "leukocyte immunoglobulin-like receptor": "白细胞免疫球蛋白样受体",
    "cd molecule": "CD 分子",
    "cluster of differentiation": "分化簇",
    "interleukin receptor": "白细胞介素受体",
    "interferon receptor": "干扰素受体",
    "tumor necrosis factor receptor": "肿瘤坏死因子受体",
    "transforming growth factor receptor": "转化生长因子受体",
    "chemokine receptor": "趋化因子受体",
    "growth factor receptor": "生长因子受体",
    "hormone receptor": "激素受体",
    "neurotransmitter receptor": "神经递质受体",
    "ionotropic receptor": "离子型受体",
    "metabotropic receptor": "代谢型受体",
    "nuclear receptor": "核受体",
    "orphan receptor": "孤儿受体",
    "adhesion receptor": "粘附受体",
    "notch receptor": "Notch 受体",
    "wnt receptor": "Wnt 受体",
    "hedgehog receptor": "Hedgehog 受体",
    "receptor tyrosine kinase": "受体酪氨酸激酶",
    "receptor serine/threonine kinase": "受体丝氨酸/苏氨酸激酶",
    "receptor guanylyl cyclase": "受体鸟苷酸环化酶",
    "receptor phosphatase": "受体磷酸酶",
    "decoy receptor": "诱饵受体",
    "co-receptor": "共受体",
    "accessory receptor": "辅助受体",
    "signaling receptor": "信号受体",
    "endocytic receptor": "内吞受体",
    "clearance receptor": "清除受体",
    "pattern recognition receptor": "模式识别受体",
    "scavenging receptor": "清除受体",
    "phagocytic receptor": "吞噬受体",
    "opsonic receptor": "调理受体",
    "non-opsonic receptor": "非调理受体",
    "activating receptor": "活化性受体",
    "inhibitory receptor": "抑制性受体",
    "costimulatory receptor": "共刺激受体",
    "coinhibitory receptor": "共抑制受体",
    "immune checkpoint receptor": "免疫检查点受体",
    "checkpoint inhibitor": "检查点抑制剂",
    "adoptive cell transfer": "过继细胞转移",
    "chimeric antigen receptor": "嵌合抗原受体",
    "bispecific antibody": "双特异性抗体",
    "antibody-drug conjugate": "抗体药物偶联物",
    "oncolytic virus": "溶瘤病毒",
    "cancer vaccine": "肿瘤疫苗",
    "immune adjuvant": "免疫佐剂",
    "personalized medicine": "精准医学",
    "companion diagnostic": "伴随诊断",
    "liquid biopsy": "液体活检",
    "circulating tumor cell": "循环肿瘤细胞",
    "circulating tumor dna": "循环肿瘤 DNA",
    "cell-free dna": "游离 DNA",
    "exosomal dna": "外泌体 DNA",
    "tumor mutational burden": "肿瘤突变负荷",
    "microsatellite instability": "微卫星不稳定性",
    "mismatch repair deficiency": "错配修复缺陷",
    "homologous recombination deficiency": "同源重组修复缺陷",
    "brcaness": "BRCAness",
    "synthetic lethality": "合成致死",
    "targeted therapy": "靶向治疗",
    "immunotherapy": "免疫治疗",
    "chemotherapy": "化学治疗",
    "radiotherapy": "放射治疗",
    "hormone therapy": "激素治疗",
    "gene therapy": "基因治疗",
    "cell therapy": "细胞治疗",
    "stem cell therapy": "干细胞治疗",
    "rna therapy": "RNA 治疗",
    "antisense therapy": "反义治疗",
    "sirna therapy": "siRNA 治疗",
    "mirna therapy": "miRNA 治疗",
    "mrna vaccine": "mRNA 疫苗",
    "crispr therapy": "CRISPR 治疗",
    "base editing": "碱基编辑",
    "prime editing": "先导编辑",
    "epigenetic editing": "表观遗传编辑",
    "translational regulation": "翻译调控",
    "post-transcriptional regulation": "转录后调控",
    "post-translational regulation": "翻译后调控",
    "allosteric regulation": "变构调控",
    "covalent modification": "共价修饰",
    "non-covalent interaction": "非共价相互作用",
    "electrostatic interaction": "静电相互作用",
    "hydrophobic interaction": "疏水相互作用",
    "van der waals interaction": "范德华相互作用",
    "hydrogen bond": "氢键",
    "disulfide bond": "二硫键",
    "peptide bond": "肽键",
    "glycosidic bond": "糖苷键",
    "phosphodiester bond": "磷酸二酯键",
    "high-energy bond": "高能键",
    "low-energy bond": "低能键",
    "covalent bond": "共价键",
    "ionic bond": "离子键",
    "coordinate bond": "配位键",
    "metal-ligand bond": "金属-配体键",
    "carbon-carbon bond": "碳-碳键",
    "carbon-nitrogen bond": "碳-氮键",
    "carbon-oxygen bond": "碳-氧键",
    "phosphorus-oxygen bond": "磷-氧键",
    "sulfur-sulfur bond": "硫-硫键",
    "nucleophilic attack": "亲核攻击",
    "electrophilic attack": "亲电攻击",
    "radical reaction": "自由基反应",
    "redox reaction": "氧化还原反应",
    "condensation reaction": "缩合反应",
    "hydrolysis reaction": "水解反应",
    "phosphorylation reaction": "磷酸化反应",
    "dephosphorylation reaction": "去磷酸化反应",
    "transfer reaction": "转移反应",
    "isomerization reaction": "异构化反应",
    "elimination reaction": "消除反应",
    "addition reaction": "加成反应",
    "substitution reaction": "取代反应",
    "rearrangement reaction": "重排反应",
    "cyclization reaction": "环化反应",
    "decyclization reaction": "开环反应",
    "polymerization reaction": "聚合反应",
    "depolymerization reaction": "解聚反应",
    "oxidation reaction": "氧化反应",
    "reduction reaction": "还原反应",
    "half-reaction": "半反应",
    "rate-limiting step": "限速步骤",
    "transition state": "过渡态",
    "activation energy": "活化能",
    "free energy": "自由能",
    "binding energy": "结合能",
    "kinetic energy": "动能",
    "potential energy": "势能",
    "enthalpy": "焓",
    "entropy": "熵",
    "gibbs free energy": "Gibbs 自由能",
    "equilibrium constant": "平衡常数",
    "dissociation constant": "解离常数",
    "association constant": "结合常数",
    "inhibitory constant": "抑制常数",
    "michaelis constant": "Michaelis 常数",
    "turnover number": "转换数",
    "catalytic efficiency": "催化效率",
    "specific activity": "比活性",
    "enzyme concentration": "酶浓度",
    "substrate concentration": "底物浓度",
    "product concentration": "产物浓度",
    "inhibitor concentration": "抑制剂浓度",
    "activator concentration": "激活剂浓度",
    "competitive inhibition": "竞争性抑制",
    "non-competitive inhibition": "非竞争性抑制",
    "uncompetitive inhibition": "反竞争性抑制",
    "mixed inhibition": "混合型抑制",
    "allosteric inhibition": "变构抑制",
    "allosteric activation": "变构激活",
    "feedback inhibition": "反馈抑制",
    "feedback activation": "反馈激活",
    "feedforward activation": "前馈激活",
    "cooperative binding": "协同结合",
    "positive cooperativity": "正协同性",
    "negative cooperativity": "负协同性",
    "hill coefficient": "Hill 系数",
    "sigmoidal kinetics": "S 型动力学",
    "hyperbolic kinetics": "双曲线动力学",
    "zero-order kinetics": "零级动力学",
    "first-order kinetics": "一级动力学",
    "second-order kinetics": "二级动力学",
    "michaelis-menten kinetics": "Michaelis-Menten 动力学",
    "briggs-haldane kinetics": "Briggs-Haldane 动力学",
    "ping-pong mechanism": "乒乓机制",
    "ordered mechanism": "有序机制",
    "random mechanism": "随机机制",
    "theorell-chance mechanism": "Theorell-Chance 机制",
    "steady-state": "稳态",
    "pre-steady-state": "预稳态",
    "rapid equilibrium": "快速平衡",
    "slow equilibrium": "慢平衡",
    "irreversible step": "不可逆步骤",
    "reversible step": "可逆步骤",
    "rate-determining step": "决速步骤",
    "bottleneck": "瓶颈",
    "commitment step": "承诺步骤",
    "branch point": "分支点",
    "crossroad": "十字路口",
    "checkpoint": "检查点",
    "surveillance mechanism": "监视机制",
    "quality control mechanism": "质量控制机制",
    "proofreading mechanism": "校对机制",
    "editing mechanism": "编辑机制",
    "repair mechanism": "修复机制",
    "rescue mechanism": "拯救机制",
    "backup mechanism": "备份机制",
    "redundancy": "冗余",
    "robustness": "鲁棒性",
    "fragility": "脆弱性",
    "adaptability": "适应性",
    "flexibility": "灵活性",
    "evolvability": "可进化性",
    "modularity": "模块性",
    "hierarchy": "层级性",
    "emergence": "涌现性",
    "self-organization": "自组织",
    "self-assembly": "自组装",
    "self-replication": "自复制",
    "self-renewal": "自我更新",
    "self-maintenance": "自我维持",
    "negative feedback": "负反馈",
    "positive feedback": "正反馈",
    "feedforward loop": "前馈环路",
    "feedback loop": "反馈环路",
    "regulatory circuit": "调控回路",
    "signaling network": "信号网络",
    "gene regulatory network": "基因调控网络",
    "protein interaction network": "蛋白相互作用网络",
    "metabolic network": "代谢网络",
    "transcriptional network": "转录网络",
    "post-translational modification network": "翻译后修饰网络",
    "epigenetic network": "表观遗传网络",
    "chromatin interaction network": "染色质相互作用网络",
    "spatial organization": "空间组织",
    "temporal organization": "时间组织",
    "spatiotemporal organization": "时空组织",
    "compartmentalization": "区室化",
    "microcompartment": "微区室",
    "nanocompartment": "纳区室",
    "membraneless organelle": "无膜细胞器",
    "biomolecular condensate": "生物分子凝聚体",
    "phase separation": "相分离",
    "liquid-liquid phase separation": "液-液相分离",
    "liquid-solid phase separation": "液-固相分离",
    "gelation": "凝胶化",
    "amyloid formation": "淀粉样形成",
    "prion-like": "朊病毒样",
    "nucleation": "成核",
    "elongation": "延伸",
    "fragmentation": "断裂",
    "coalescence": "聚并",
    "ripening": "熟化",
    "wetting": "润湿",
    "dewetting": "去润湿",
    "surface tension": "表面张力",
    "interfacial tension": "界面张力",
    "line tension": "线张力",
    "curvature": "曲率",
    "topology": "拓扑",
    "geometry": "几何",
    "symmetry": "对称性",
    "asymmetry": "不对称性",
    "polarity": "极性",
    "gradient": "梯度",
    "concentration gradient": "浓度梯度",
    "electrochemical gradient": "电化学梯度",
    "proton gradient": "质子梯度",
    "sodium gradient": "钠梯度",
    "potassium gradient": "钾梯度",
    "calcium gradient": "钙梯度",
    "chloride gradient": "氯梯度",
    "ph gradient": "pH 梯度",
    "osmotic gradient": "渗透压梯度",
    "thermodynamic gradient": "热力学梯度",
    "mechanical force": "机械力",
    "tensile force": "张力",
    "compressive force": "压力",
    "shear force": "剪切力",
    "torque": "扭矩",
    "bending force": "弯曲力",
    "twisting force": "扭转力",
    "pulling force": "拉力",
    "pushing force": "推力",
    "adhesive force": "粘附力",
    "cohesive force": "内聚力",
    "frictional force": "摩擦力",
    "viscous force": "粘性力",
    "inertial force": "惯性力",
    "gravitational force": "重力",
    "electromagnetic force": "电磁力",
    "electrostatic force": "静电力",
    "van der waals force": "范德华力",
    "steric force": "位阻力",
    "depletion force": "耗尽力",
    "hydrodynamic force": "流体力",
    "osmotic force": "渗透力",
    "entropic force": "熵力",
    "chemical potential": "化学势",
    "electrochemical potential": "电化学势",
    "proton motive force": "质子驱动力",
    "sodium motive force": "钠驱动力",
    "membrane potential": "膜电位",
    "resting potential": "静息电位",
    "action potential": "动作电位",
    "receptor potential": "感受器电位",
    "synaptic potential": "突触电位",
    "graded potential": "分级电位",
    "threshold potential": "阈电位",
    "overshoot": "超射",
    "undershoot": "低射",
    "afterhyperpolarization": "后超极化",
    "afterdepolarization": "后去极化",
    "refractory period": "不应期",
    "absolute refractory period": "绝对不应期",
    "relative refractory period": "相对不应期",
    "excitability": "兴奋性",
    "conductivity": "传导性",
    "contractility": "收缩性",
    "automaticity": "自律性",
    "rhythmicity": "节律性",
    "pacemaker activity": "起搏活动",
    "ectopic activity": "异位活动",
    "reentry": "折返",
    "triggered activity": "触发活动",
    "early afterdepolarization": "早期后去极化",
    "delayed afterdepolarization": "延迟后去极化",
    "conduction velocity": "传导速度",
    "refractoriness": "不应性",
    "wavelength": "波长",
    "vulnerable period": "易损期",
    "supernormal period": "超常期",
    "subnormal period": "亚常期",
    "accommodation": "适应",
    "adaptation": "适应",
    "habituation": "习惯化",
    "sensitization": "敏感化",
    "dishabituation": "去习惯化",
    "potentiation": "增强",
    "facilitation": "易化",
    "depression": "抑制",
    "fatigue": "疲劳",
    "rebound": "反跳",
    "oscillation": "振荡",
    "resonance": "共振",
    "entrainment": "夹带",
    "synchronization": "同步化",
    "desynchronization": "去同步化",
    "phase locking": "相位锁定",
    "phase resetting": "相位重置",
    "phase response": "相位响应",
    "phase response curve": "相位响应曲线",
    "limit cycle": "极限环",
    "attractor": "吸引子",
    "strange attractor": "奇异吸引子",
    "chaos": "混沌",
    "bifurcation": "分岔",
    "hysteresis": "滞后",
    "noise": "噪声",
    "stochasticity": "随机性",
    "determinism": "确定性",
    "supervenience": "随附性",
    "reductionism": "还原论",
    "holism": "整体论",
    "systems biology": "系统生物学",
    "synthetic biology": "合成生物学",
    "computational biology": "计算生物学",
    "structural biology": "结构生物学",
    "molecular biology": "分子生物学",
    "cell biology": "细胞生物学",
    "developmental biology": "发育生物学",
    "evolutionary biology": "进化生物学",
    "ecology": "生态学",
    "microbiology": "微生物学",
    "virology": "病毒学",
    "immunology": "免疫学",
    "neuroscience": "神经科学",
    "endocrinology": "内分泌学",
    "cardiology": "心脏病学",
    "oncology": "肿瘤学",
    "genetics": "遗传学",
    "genomics": "基因组学",
    "proteomics": "蛋白质组学",
    "transcriptomics": "转录组学",
    "metabolomics": "代谢组学",
    "lipidomics": "脂质组学",
    "glycomics": "糖组学",
    "epigenomics": "表观基因组学",
    "pharmacogenomics": "药物基因组学",
    "toxicogenomics": "毒理基因组学",
    "nutrigenomics": "营养基因组学",
    "radiogenomics": "放射基因组学",
    "immunogenomics": "免疫基因组学",
    "microbiomics": "微生物组学",
    "phenomics": "表型组学",
    "connectomics": "连接组学",
    "cytomics": "细胞组学",
    "histomics": "组织组学",
    "toponomics": "拓扑组学",
    "fluxomics": "流量组学",
    "interactomics": "相互作用组学",
    "structuromics": "结构组学",
    "functiomics": "功能组学",
    "regulomics": "调控组学",
    "localizomics": "定位组学",
    "tempomics": "时间组学",
    "spatiomics": "空间组学",
    "crispr screening": "CRISPR 筛选",
    "rna interference screening": "RNA 干扰筛选",
    "high-throughput screening": "高通量筛选",
    "phenotypic screening": "表型筛选",
    "target-based screening": "基于靶点的筛选",
    "fragment-based screening": "基于片段的筛选",
    "virtual screening": "虚拟筛选",
    "structure-based drug design": "基于结构的药物设计",
    "ligand-based drug design": "基于配体的药物设计",
    "de novo drug design": "从头药物设计",
    "drug repurposing": "药物重定位",
    "drug rescue": "药物拯救",
    "drug combination": "药物联合",
    "drug synergy": "药物协同",
    "drug antagonism": "药物拮抗",
    "drug resistance": "耐药性",
    "acquired resistance": "获得性耐药",
    "intrinsic resistance": "内在耐药",
    "adaptive resistance": "适应性耐药",
    "cross-resistance": "交叉耐药",
    "collateral sensitivity": "附带敏感性",
    "pharmacodynamics": "药效学",
    "pharmacokinetics": "药代动力学",
    "absorption": "吸收",
    "distribution": "分布",
    "metabolism": "代谢",
    "excretion": "排泄",
    "bioavailability": "生物利用度",
    "half-life": "半衰期",
    "clearance": "清除率",
    "volume of distribution": "分布容积",
    "area under the curve": "曲线下面积",
    "maximum concentration": "最大浓度",
    "minimum concentration": "最小浓度",
    "therapeutic window": "治疗窗",
    "therapeutic index": "治疗指数",
    "median effective dose": "中位有效剂量",
    "median lethal dose": "中位致死剂量",
    "no observed adverse effect level": "未观察到不良反应剂量",
    "lowest observed adverse effect level": "最低观察到不良反应剂量",
    "maximum tolerated dose": "最大耐受剂量",
    "recommended phase 2 dose": "推荐 II 期剂量",
    "dose-limiting toxicity": "剂量限制性毒性",
    "adverse event": "不良事件",
    "serious adverse event": "严重不良事件",
    "dose-response relationship": "剂量-反应关系",
    "concentration-response relationship": "浓度-反应关系",
    "time-response relationship": "时间-反应关系",
    "structure-activity relationship": "构效关系",
    "quantitative structure-activity relationship": "定量构效关系",
    "pharmacophore": "药效团",
    "lead compound": "先导化合物",
    "hit compound": "苗头化合物",
    "clinical candidate": "临床候选药物",
    "investigational new drug": "研究性新药",
    "new drug application": "新药申请",
    "biologics license application": "生物制品许可申请",
    "abbreviated new drug application": "简化新药申请",
    "over-the-counter drug": "非处方药",
    "prescription drug": "处方药",
    "orphan drug": "孤儿药",
    "breakthrough therapy": "突破性疗法",
    "fast track": "快速通道",
    "priority review": "优先审评",
    "accelerated approval": "加速批准",
    "conditional approval": "有条件批准",
    "expanded access": "扩大使用",
    "compassionate use": "同情使用",
    "right to try": "尝试权",
    "off-label use": "超说明书使用",
    "drug interaction": "药物相互作用",
    "food-drug interaction": "食物-药物相互作用",
    "herb-drug interaction": "草药-药物相互作用",
    "drug-drug interaction": "药物-药物相互作用",
    "drug-gene interaction": "药物-基因相互作用",
    "drug-disease interaction": "药物-疾病相互作用",
    "drug-laboratory test interaction": "药物-实验室检查相互作用",
    "contraindication": "禁忌证",
    "precaution": "注意事项",
    "warning": "警告",
    "black box warning": "黑框警告",
    "boxed warning": "带框警告",
    "medication guide": "用药指南",
    "patient package insert": "患者说明书",
    "summary of product characteristics": "产品特性摘要",
    "prescribing information": "处方信息",
    "labeling": "标签",
    "package insert": "包装说明书",
    "drug monograph": "药物专论",
    "formulary": "处方集",
    "compendium": "汇编",
    "pharmacopeia": "药典",
    "good manufacturing practice": "药品生产质量管理规范",
    "good clinical practice": "药物临床试验质量管理规范",
    "good laboratory practice": "药物非临床研究质量管理规范",
    "good pharmacovigilance practice": "药物警戒质量管理规范",
    "good distribution practice": "药品经营质量管理规范",
    "good storage practice": "药品储存质量管理规范",
    "good dispensing practice": "药品调剂质量管理规范",
    "good compounding practice": "药品配制质量管理规范",
    "good aseptic practice": "无菌操作质量管理规范",
    "good tissue practice": "组织质量管理规范",
    "good cell culture practice": "细胞培养质量管理规范",
    "good blood banking practice": "血液 banking 质量管理规范",
    "good transfusion practice": "输血质量管理规范",
    "good procurement practice": "采购质量管理规范",
    "good donation practice": "捐献质量管理规范",
    "good testing practice": "检测质量管理规范",
    "good release practice": "放行质量管理规范",
    "good recall practice": "召回质量管理规范",
    "good documentation practice": "文件管理质量管理规范",
    "good validation practice": "验证质量管理规范",
    "good qualification practice": "确认质量管理规范",
    "good calibration practice": "校准质量管理规范",
    "good maintenance practice": "维护质量管理规范",
    "good cleaning practice": "清洁质量管理规范",
    "good sanitization practice": "卫生质量管理规范",
    "good sterilization practice": "灭菌质量管理规范",
    "good packaging practice": "包装质量管理规范",
    "good labeling practice": "标签质量管理规范",
    "good shipping practice": "运输质量管理规范",
    "good receiving practice": "接收质量管理规范",
    "good inventory practice": "库存质量管理规范",
    "good waste management practice": "废弃物管理质量管理规范",
    "good environmental practice": "环境质量管理规范",
    "good safety practice": "安全质量管理规范",
    "good health practice": "健康质量管理规范",
    "good hygiene practice": "卫生质量管理规范",
    "good personal practice": "个人质量管理规范",
    "good professional practice": "职业质量管理规范",
    "good ethical practice": "伦理质量管理规范",
    "good legal practice": "法律质量管理规范",
    "good regulatory practice": "法规质量管理规范",
    "good scientific practice": "科学质量管理规范",
    "good research practice": "研究质量管理规范",
    "good publication practice": "发表质量管理规范",
    "good peer review practice": "同行评审质量管理规范",
    "good editorial practice": "编辑质量管理规范",
    "good authorship practice": "作者质量管理规范",
    "good data management practice": "数据管理质量管理规范",
    "good statistical practice": "统计质量管理规范",
    "good bioinformatics practice": "生物信息学质量管理规范",
    "good computational practice": "计算质量管理规范",
    "good modeling practice": "建模质量管理规范",
    "good simulation practice": "模拟质量管理规范",
    "good visualization practice": "可视化质量管理规范",
    "good reporting practice": "报告质量管理规范",
    "good presentation practice": "展示质量管理规范",
    "good communication practice": "沟通质量管理规范",
    "good collaboration practice": "合作质量管理规范",
    "good teamwork practice": "团队质量管理规范",
    "good leadership practice": "领导质量管理规范",
    "good management practice": "管理质量管理规范",
    "good governance practice": "治理质量管理规范",
    "good oversight practice": "监督质量管理规范",
    "good monitoring practice": "监查质量管理规范",
    "good auditing practice": "审计质量管理规范",
    "good inspection practice": "检查质量管理规范",
    "good investigation practice": "调查质量管理规范",
    "good enforcement practice": "执法质量管理规范",
    "good compliance practice": "合规质量管理规范",
    "good risk management practice": "风险管理质量管理规范",
    "good quality management practice": "质量管理质量管理规范",
    "good change management practice": "变更管理质量管理规范",
    "good crisis management practice": "危机管理质量管理规范",
    "good disaster management practice": "灾难管理质量管理规范",
    "good emergency management practice": "应急管理质量管理规范",
    "good contingency management practice": "应急管理质量管理规范",
    "good business continuity practice": "业务连续性质量管理规范",
    "good supply chain management practice": "供应链管理质量管理规范",
    "good vendor management practice": "供应商管理质量管理规范",
    "good contract management practice": "合同管理质量管理规范",
    "good project management practice": "项目管理质量管理规范",
    "good program management practice": "方案管理质量管理规范",
    "good portfolio management practice": "组合管理质量管理规范",
    "good resource management practice": "资源管理质量管理规范",
    "good time management practice": "时间管理质量管理规范",
    "good cost management practice": "成本管理质量管理规范",
    "good scope management practice": "范围管理质量管理规范",
    "good schedule management practice": "进度管理质量管理规范",
    "good budget management practice": "预算管理质量管理规范",
    "good financial management practice": "财务管理质量管理规范",
    "good accounting practice": "会计质量管理规范",
    "good tax practice": "税务质量管理规范",
    "good human resources practice": "人力资源质量管理规范",
    "good talent management practice": "人才管理质量管理规范",
    "good knowledge management practice": "知识管理质量管理规范",
    "good information management practice": "信息管理质量管理规范",
    "good technology management practice": "技术管理质量管理规范",
    "good innovation management practice": "创新管理质量管理规范",
    "good intellectual property practice": "知识产权质量管理规范",
    "good patent practice": "专利质量管理规范",
    "good trademark practice": "商标质量管理规范",
    "good copyright practice": "版权质量管理规范",
    "good trade secret practice": "商业秘密质量管理规范",
    "good data protection practice": "数据保护质量管理规范",
    "good privacy practice": "隐私质量管理规范",
    "good security practice": "安全质量管理规范",
    "good cybersecurity practice": "网络安全质量管理规范",
    "good information security practice": "信息安全质量管理规范",
    "good physical security practice": "物理安全质量管理规范",
    "good personnel security practice": "人员安全质量管理规范",
    "good facility security practice": "设施安全质量管理规范",
    "good equipment security practice": "设备安全质量管理规范",
    "good material security practice": "物料安全质量管理规范",
    "good product security practice": "产品安全质量管理规范",
    "good process security practice": "过程安全质量管理规范",
    "good system security practice": "系统安全质量管理规范",
    "good network security practice": "网络安全质量管理规范",
    "good application security practice": "应用安全质量管理规范",
    "good database security practice": "数据库安全质量管理规范",
    "good cloud security practice": "云安全质量管理规范",
    "good mobile security practice": "移动安全质量管理规范",
    "good endpoint security practice": "终端安全质量管理规范",
    "good identity management practice": "身份管理质量管理规范",
    "good access management practice": "访问管理质量管理规范",
    "good authentication practice": "认证质量管理规范",
    "good authorization practice": "授权质量管理规范",
    "good encryption practice": "加密质量管理规范",
    "good key management practice": "密钥管理质量管理规范",
    "good certificate management practice": "证书管理质量管理规范",
    "good password management practice": "密码管理质量管理规范",
    "good token management practice": "令牌管理质量管理规范",
    "good session management practice": "会话管理质量管理规范",
    "good cookie management practice": "Cookie 管理质量管理规范",
    "good cache management practice": "缓存管理质量管理规范",
    "good backup management practice": "备份管理质量管理规范",
    "good recovery management practice": "恢复管理质量管理规范",
    "good archive management practice": "归档管理质量管理规范",
    "good retention management practice": "保留管理质量管理规范",
    "good disposal management practice": "处置管理质量管理规范",
    "good destruction management practice": "销毁管理质量管理规范",
    "good decommissioning practice": "退役质量管理规范",
    "good migration practice": "迁移质量管理规范",
    "good upgrade practice": "升级质量管理规范",
    "good patch management practice": "补丁管理质量管理规范",
    "good version management practice": "版本管理质量管理规范",
    "good configuration management practice": "配置管理质量管理规范",
    "good release management practice": "发布管理质量管理规范",
    "good deployment management practice": "部署管理质量管理规范",
    "good integration management practice": "集成管理质量管理规范",
    "good testing management practice": "测试管理质量管理规范",
    "good quality assurance practice": "质量保证质量管理规范",
    "good quality control practice": "质量控制质量管理规范",
    "good verification practice": "验证质量管理规范",
    "good certification practice": "认证质量管理规范",
    "good accreditation practice": "认可质量管理规范",
    "good standardization practice": "标准化质量管理规范",
    "good harmonization practice": "协调质量管理规范",
    "good interoperability practice": "互操作性质量管理规范",
    "good compatibility practice": "兼容性质量管理规范",
    "good portability practice": "可移植性质量管理规范",
    "good scalability practice": "可扩展性质量管理规范",
    "good maintainability practice": "可维护性质量管理规范",
    "good reliability practice": "可靠性质量管理规范",
    "good availability practice": "可用性质量管理规范",
    "good usability practice": "可用性质量管理规范",
    "good accessibility practice": "可及性质量管理规范",
    "good performance practice": "性能质量管理规范",
    "good efficiency practice": "效率质量管理规范",
    "good effectiveness practice": "效果质量管理规范",
    "good accuracy practice": "准确性质量管理规范",
    "good precision practice": "精密度质量管理规范",
    "good sensitivity practice": "敏感性质量管理规范",
    "good specificity practice": "特异性质量管理规范",
    "good robustness practice": "稳健性质量管理规范",
    "good resilience practice": "弹性质量管理规范",
    "good fault tolerance practice": "容错质量管理规范",
    "good error handling practice": "错误处理质量管理规范",
    "good exception handling practice": "异常处理质量管理规范",
    "good logging practice": "日志质量管理规范",
    "good tracing practice": "追踪质量管理规范",
    "good alerting practice": "告警质量管理规范",
    "good notification practice": "通知质量管理规范",
    "good escalation practice": "升级质量管理规范",
    "good incident management practice": "事件管理质量管理规范",
    "good problem management practice": "问题管理质量管理规范",
    "good service management practice": "服务管理质量管理规范",
    "good asset management practice": "资产管理质量管理规范",
    "good capacity management practice": "容量管理质量管理规范",
    "good performance management practice": "性能管理质量管理规范",
    "good workload management practice": "工作负载管理质量管理规范",
    "good traffic management practice": "流量管理质量管理规范",
    "good load balancing practice": "负载均衡质量管理规范",
    "good resource allocation practice": "资源分配质量管理规范",
    "good scheduling practice": "调度质量管理规范",
    "good orchestration practice": "编排质量管理规范",
    "good automation practice": "自动化质量管理规范",
    "good choreography practice": "编舞质量管理规范",
    "good composition practice": "组合质量管理规范",
    "good decomposition practice": "分解质量管理规范",
    "good modularization practice": "模块化质量管理规范",
    "good encapsulation practice": "封装质量管理规范",
    "good abstraction practice": "抽象质量管理规范",
    "good inheritance practice": "继承质量管理规范",
    "good polymorphism practice": "多态质量管理规范",
    "good interface practice": "接口质量管理规范",
    "good implementation practice": "实现质量管理规范",
    "good design practice": "设计质量管理规范",
    "good architecture practice": "架构质量管理规范",
    "good pattern practice": "模式质量管理规范",
    "good anti-pattern practice": "反模式质量管理规范",
    "good refactoring practice": "重构质量管理规范",
    "good optimization practice": "优化质量管理规范",
    "good tuning practice": "调优质量管理规范",
    "good benchmarking practice": "基准测试质量管理规范",
    "good profiling practice": "性能分析质量管理规范",
    "good debugging practice": "调试质量管理规范",
    "good troubleshooting practice": "故障排除质量管理规范",
    "good root cause analysis practice": "根本原因分析质量管理规范",
    "good failure mode analysis practice": "失效模式分析质量管理规范",
    "good hazard analysis practice": "危害分析质量管理规范",
    "good risk analysis practice": "风险分析质量管理规范",
    "good threat analysis practice": "威胁分析质量管理规范",
    "good vulnerability analysis practice": "脆弱性分析质量管理规范",
    "good impact analysis practice": "影响分析质量管理规范",
    "good dependency analysis practice": "依赖分析质量管理规范",
    "good compatibility analysis practice": "兼容性分析质量管理规范",
    "good interoperability analysis practice": "互操作性分析质量管理规范",
    "good performance analysis practice": "性能分析质量管理规范",
    "good scalability analysis practice": "可扩展性分析质量管理规范",
    "good capacity analysis practice": "容量分析质量管理规范",
    "good throughput analysis practice": "吞吐量分析质量管理规范",
    "good latency analysis practice": "延迟分析质量管理规范",
    "good bandwidth analysis practice": "带宽分析质量管理规范",
    "good utilization analysis practice": "利用率分析质量管理规范",
    "good efficiency analysis practice": "效率分析质量管理规范",
    "good effectiveness analysis practice": "效果分析质量管理规范",
    "good productivity analysis practice": "生产率分析质量管理规范",
    "good quality analysis practice": "质量分析质量管理规范",
    "good cost analysis practice": "成本分析质量管理规范",
    "good benefit analysis practice": "效益分析质量管理规范",
    "good value analysis practice": "价值分析质量管理规范",
    "good return on investment analysis practice": "投资回报率分析质量管理规范",
    "good total cost of ownership analysis practice": "总拥有成本分析质量管理规范",
    "good life cycle cost analysis practice": "生命周期成本分析质量管理规范",
    "good cost-benefit analysis practice": "成本效益分析质量管理规范",
    "good cost-effectiveness analysis practice": "成本效果分析质量管理规范",
    "good cost-utility analysis practice": "成本效用分析质量管理规范",
    "good budget impact analysis practice": "预算影响分析质量管理规范",
    "good health technology assessment practice": "卫生技术评估质量管理规范",
    "good comparative effectiveness research practice": "比较效果研究质量管理规范",
    "good patient-centered outcomes research practice": "以患者为中心的结果研究质量管理规范",
    "good real-world evidence practice": "真实世界证据质量管理规范",
    "good pragmatic clinical trial practice": "实用性临床试验质量管理规范",
    "good adaptive clinical trial practice": "适应性临床试验质量管理规范",
    "good platform clinical trial practice": "平台临床试验质量管理规范",
    "good umbrella clinical trial practice": "伞式临床试验质量管理规范",
    "good basket clinical trial practice": "篮式临床试验质量管理规范",
    "good master protocol practice": "主方案质量管理规范",
    "good external control practice": "外部对照质量管理规范",
    "good synthetic control practice": "合成对照质量管理规范",
    "good historical control practice": "历史对照质量管理规范",
    "good concurrent control practice": "同期对照质量管理规范",
    "good crossover design practice": "交叉设计质量管理规范",
    "good factorial design practice": "析因设计质量管理规范",
    "good cluster randomized design practice": "整群随机设计质量管理规范",
    "good stepped wedge design practice": "阶梯楔形设计质量管理规范",
    "good interrupted time series design practice": "中断时间序列设计质量管理规范",
    "good difference-in-differences design practice": "双重差分设计质量管理规范",
    "good regression discontinuity design practice": "断点回归设计质量管理规范",
    "good instrumental variable design practice": "工具变量设计质量管理规范",
    "good propensity score design practice": "倾向评分设计质量管理规范",
    "good matching design practice": "匹配设计质量管理规范",
    "good stratification design practice": "分层设计质量管理规范",
    "good minimization design practice": "最小化设计质量管理规范",
    "good response-adaptive design practice": "反应适应性设计质量管理规范",
    "good dose-escalation design practice": "剂量递增设计质量管理规范",
    "good dose-finding design practice": "剂量探索设计质量管理规范",
    "good phase i design practice": "I 期设计质量管理规范",
    "good phase ii design practice": "II 期设计质量管理规范",
    "good phase iii design practice": "III 期设计质量管理规范",
    "good phase iv design practice": "IV 期设计质量管理规范",
    "good phase 0 design practice": "0 期设计质量管理规范",
    "good first-in-human design practice": "首次人体设计质量管理规范",
    "good proof-of-concept design practice": "概念验证设计质量管理规范",
    "good exploratory design practice": "探索性设计质量管理规范",
    "good confirmatory design practice": "确证性设计质量管理规范",
    "good pivotal design practice": "关键性设计质量管理规范",
    "good registration design practice": "注册性设计质量管理规范",
    "good post-marketing design practice": "上市后设计质量管理规范",
    "good observational study practice": "观察性研究质量管理规范",
    "good cohort study practice": "队列研究质量管理规范",
    "good case-control study practice": "病例对照研究质量管理规范",
    "good cross-sectional study practice": "横断面研究质量管理规范",
    "good nested case-control study practice": "巢式病例对照研究质量管理规范",
    "good case-cohort study practice": "病例队列研究质量管理规范",
    "good case-crossover study practice": "病例交叉研究质量管理规范",
    "good self-controlled study practice": "自身对照研究质量管理规范",
    "good propensity-matched study practice": "倾向匹配研究质量管理规范",
    "good instrumental variable study practice": "工具变量研究质量管理规范",
    "good mendelian randomization study practice": "孟德尔随机化研究质量管理规范",
    "good genome-wide association study practice": "全基因组关联研究质量管理规范",
    "good exome-wide association study practice": "全外显子关联研究质量管理规范",
    "good phenome-wide association study practice": "全表型关联研究质量管理规范",
    "good transcriptome-wide association study practice": "全转录组关联研究质量管理规范",
    "good proteome-wide association study practice": "全蛋白质组关联研究质量管理规范",
    "good metabolome-wide association study practice": "全代谢组关联研究质量管理规范",
    "good epigenome-wide association study practice": "全表观基因组关联研究质量管理规范",
    "good microbiome-wide association study practice": "全微生物组关联研究质量管理规范",
    "good exposome-wide association study practice": "全暴露组关联研究质量管理规范",
    "good environment-wide association study practice": "全环境关联研究质量管理规范",
    "good drug-wide association study practice": "全药物关联研究质量管理规范",
    "good target-wide association study practice": "全靶点关联研究质量管理规范",
    "good pathway-wide association study practice": "全通路关联研究质量管理规范",
    "good network-wide association study practice": "全网络关联研究质量管理规范",
    "good disease-wide association study practice": "全疾病关联研究质量管理规范",
    "good symptom-wide association study practice": "全症状关联研究质量管理规范",
    "good sign-wide association study practice": "全体征关联研究质量管理规范",
    "good biomarker-wide association study practice": "全生物标志物关联研究质量管理规范",
    "good imaging-wide association study practice": "全影像关联研究质量管理规范",
    "good electrophysiology-wide association study practice": "全电生理关联研究质量管理规范",
    "good neuroimaging-wide association study practice": "全神经影像关联研究质量管理规范",
    "good psychiatric genetics study practice": "精神遗传学研究质量管理规范",
    "good behavioral genetics study practice": "行为遗传学研究质量管理规范",
    "good quantitative genetics study practice": "数量遗传学研究质量管理规范",
    "good population genetics study practice": "群体遗传学研究质量管理规范",
    "good evolutionary genetics study practice": "进化遗传学研究质量管理规范",
    "good medical genetics study practice": "医学遗传学研究质量管理规范",
    "good clinical genetics study practice": "临床遗传学研究质量管理规范",
    "good cancer genetics study practice": "肿瘤遗传学研究质量管理规范",
    "good cardiovascular genetics study practice": "心血管遗传学研究质量管理规范",
    "good neurogenetics study practice": "神经遗传学研究质量管理规范",
    "good pharmacogenetics study practice": "药物遗传学研究质量管理规范",
    "good toxicogenetics study practice": "毒理遗传学研究质量管理规范",
    "good nutrigenetics study practice": "营养遗传学研究质量管理规范",
    "good immunogenetics study practice": "免疫遗传学研究质量管理规范",
    "good reproductive genetics study practice": "生殖遗传学研究质量管理规范",
    "good developmental genetics study practice": "发育遗传学研究质量管理规范",
    "good aging genetics study practice": "衰老遗传学研究质量管理规范",
    "good psychiatric genomics study practice": "精神基因组学研究质量管理规范",
    "good cancer genomics study practice": "肿瘤基因组学研究质量管理规范",
    "good cardiovascular genomics study practice": "心血管基因组学研究质量管理规范",
    "good neurogenomics study practice": "神经基因组学研究质量管理规范",
    "good pharmacogenomics study practice": "药物基因组学研究质量管理规范",
    "good toxicogenomics study practice": "毒理基因组学研究质量管理规范",
    "good nutrigenomics study practice": "营养基因组学研究质量管理规范",
    "good immunogenomics study practice": "免疫基因组学研究质量管理规范",
    "good reproductive genomics study practice": "生殖基因组学研究质量管理规范",
    "good developmental genomics study practice": "发育基因组学研究质量管理规范",
    "good aging genomics study practice": "衰老基因组学研究质量管理规范",
    "good metagenomics study practice": "宏基因组学研究质量管理规范",
    "good epigenomics study practice": "表观基因组学研究质量管理规范",
    "good transcriptomics study practice": "转录组学研究质量管理规范",
    "good proteomics study practice": "蛋白质组学研究质量管理规范",
    "good metabolomics study practice": "代谢组学研究质量管理规范",
    "good lipidomics study practice": "脂质组学研究质量管理规范",
    "good glycomics study practice": "糖组学研究质量管理规范",
    "good interactomics study practice": "相互作用组学研究质量管理规范",
    "good localizomics study practice": "定位组学研究质量管理规范",
    "good tempomics study practice": "时间组学研究质量管理规范",
    "good spatiomics study practice": "空间组学研究质量管理规范",
    "good fluxomics study practice": "流量组学研究质量管理规范",
    "good structuromics study practice": "结构组学研究质量管理规范",
    "good functiomics study practice": "功能组学研究质量管理规范",
    "good regulomics study practice": "调控组学研究质量管理规范",
    "good phenomics study practice": "表型组学研究质量管理规范",
    "good connectomics study practice": "连接组学研究质量管理规范",
    "good cytomics study practice": "细胞组学研究质量管理规范",
    "good histomics study practice": "组织组学研究质量管理规范",
    "good toponomics study practice": "拓扑组学研究质量管理规范",
    "good radiomics study practice": "影像组学研究质量管理规范",
    "good pathomics study practice": "病理组学研究质量管理规范",
    "good immunomics study practice": "免疫组学研究质量管理规范",
    "good microbiomics study practice": "微生物组学研究质量管理规范",
    "good exposomics study practice": "暴露组学研究质量管理规范",
    "good environomics study practice": "环境组学研究质量管理规范",
    "good foodomics study practice": "食品组学研究质量管理规范",
    "good petabolomics study practice": "宠物代谢组学研究质量管理规范",
    "good chronomics study practice": "时间生物学研究质量管理规范",
    "good circadian study practice": "昼夜节律研究质量管理规范",
    "good ultradian study practice": "超日节律研究质量管理规范",
    "good infradian study practice": "亚日节律研究质量管理规范",
    "good seasonal study practice": "季节性研究质量管理规范",
    "good menstrual study practice": "月经研究质量管理规范",
    "good sleep study practice": "睡眠研究质量管理规范",
    "good hibernation study practice": "冬眠研究质量管理规范",
    "good torpor study practice": "蛰伏研究质量管理规范",
    "good estivation study practice": "夏眠研究质量管理规范",
    "good diapause study practice": "滞育研究质量管理规范",
    "good dormancy study practice": "休眠研究质量管理规范",
    "good quiescence study practice": "静止研究质量管理规范",
    "good senescence study practice": "衰老研究质量管理规范",
    "good aging study practice": "衰老研究质量管理规范",
    "good longevity study practice": "长寿研究质量管理规范",
    "good life span study practice": "寿命研究质量管理规范",
    "good health span study practice": "健康寿命研究质量管理规范",
    "good disease span study practice": "疾病寿命研究质量管理规范",
    "good frailty study practice": "衰弱研究质量管理规范",
    "good sarcopenia study practice": "肌少症研究质量管理规范",
    "good osteoporosis study practice": "骨质疏松研究质量管理规范",
    "good osteoarthritis study practice": "骨关节炎研究质量管理规范",
    "good rheumatoid arthritis study practice": "类风湿关节炎研究质量管理规范",
    "good systemic lupus erythematosus study practice": "系统性红斑狼疮研究质量管理规范",
    "good multiple sclerosis study practice": "多发性硬化研究质量管理规范",
    "good amyotrophic lateral sclerosis study practice": "肌萎缩侧索硬化研究质量管理规范",
    "good parkinson disease study practice": "帕金森病研究质量管理规范",
    "good alzheimer disease study practice": "阿尔茨海默病研究质量管理规范",
    "good huntington disease study practice": "亨廷顿病研究质量管理规范",
    "good prion disease study practice": "朊病毒病研究质量管理规范",
    "good creutzfeldt-jakob disease study practice": "克雅氏病研究质量管理规范",
    "good spinocerebellar ataxia study practice": "脊髓小脑共济失调研究质量管理规范",
    "good friedreich ataxia study practice": "弗里德赖希共济失调研究质量管理规范",
    "good machado-joseph disease study practice": "马查多-约瑟夫病研究质量管理规范",
    "good myotonic dystrophy study practice": "强直性肌营养不良研究质量管理规范",
    "good duchenne muscular dystrophy study practice": "杜氏肌营养不良研究质量管理规范",
    "good becker muscular dystrophy study practice": "贝氏肌营养不良研究质量管理规范",
    "good facioscapulohumeral muscular dystrophy study practice": "面肩肱型肌营养不良研究质量管理规范",
    "good limb-girdle muscular dystrophy study practice": "肢带型肌营养不良研究质量管理规范",
    "good congenital muscular dystrophy study practice": "先天性肌营养不良研究质量管理规范",
    "good distal muscular dystrophy study practice": "远端型肌营养不良研究质量管理规范",
    "good emery-dreifuss muscular dystrophy study practice": "埃默里-德赖弗斯肌营养不良研究质量管理规范",
    "good oculopharyngeal muscular dystrophy study practice": "眼咽型肌营养不良研究质量管理规范",
    "good spinal muscular atrophy study practice": "脊髓性肌萎缩研究质量管理规范",
    "good charcot-marie-tooth disease study practice": "腓骨肌萎缩症研究质量管理规范",
    "good hereditary motor and sensory neuropathy study practice": "遗传性运动感觉神经病研究质量管理规范",
    "good hereditary sensory and autonomic neuropathy study practice": "遗传性感觉自主神经病研究质量管理规范",
    "good familial dysautonomia study practice": "家族性自主神经功能障碍研究质量管理规范",
    "good small fiber neuropathy study practice": "小纤维神经病研究质量管理规范",
    "good giant axonal neuropathy study practice": "巨轴索神经病研究质量管理规范",
    "good dejerine-sottas disease study practice": "Dejerine-Sottas 病研究质量管理规范",
    "good congenital hypomyelinating neuropathy study practice": "先天性髓鞘形成低下性神经病研究质量管理规范",
    "good hereditary neuropathy with liability to pressure palsies study practice": "遗传性压迫易感性神经病研究质量管理规范",
    "good chronic inflammatory demyelinating polyneuropathy study practice": "慢性炎症性脱髓鞘性多发性神经病研究质量管理规范",
    "good guillain-barre syndrome study practice": "吉兰-巴雷综合征研究质量管理规范",
    "good miller fisher syndrome study practice": "Miller Fisher 综合征研究质量管理规范",
    "good multifocal motor neuropathy study practice": "多灶性运动神经病研究质量管理规范",
    "good paraproteinemic neuropathy study practice": "副蛋白血症神经病研究质量管理规范",
    "good amyloid neuropathy study practice": "淀粉样变性神经病研究质量管理规范",
    "good diabetic neuropathy study practice": "糖尿病神经病研究质量管理规范",
    "good toxic neuropathy study practice": "中毒性神经病研究质量管理规范",
    "good drug-induced neuropathy study practice": "药物诱导神经病研究质量管理规范",
    "good radiation-induced neuropathy study practice": "辐射诱导神经病研究质量管理规范",
    "good chemotherapy-induced peripheral neuropathy study practice": "化疗诱导周围神经病研究质量管理规范",
    "good immune checkpoint inhibitor-related neuropathy study practice": "免疫检查点抑制剂相关神经病研究质量管理规范",
    "good critical illness neuropathy study practice": "危重病神经病研究质量管理规范",
    "good porphyric neuropathy study practice": "卟啉病神经病研究质量管理规范",
    "good leber hereditary optic neuropathy study practice": "Leber 遗传性视神经病研究质量管理规范",
    "good dominant optic atrophy study practice": "显性视神经萎缩研究质量管理规范",
    "good ber optic neuropathy study practice": "ber 视神经病研究质量管理规范",
    "good toxic optic neuropathy study practice": "中毒性视神经病研究质量管理规范",
    "good nutritional optic neuropathy study practice": "营养性视神经病研究质量管理规范",
    "good compressive optic neuropathy study practice": "压迫性视神经病研究质量管理规范",
    "good glaucomatous optic neuropathy study practice": "青光眼性视神经病研究质量管理规范",
    "good ischemic optic neuropathy study practice": "缺血性视神经病研究质量管理规范",
    "good traumatic optic neuropathy study practice": "外伤性视神经病研究质量管理规范",
    "good hereditary spastic paraplegia study practice": "遗传性痉挛性截瘫研究质量管理规范",
    "good primary lateral sclerosis study practice": "原发性侧索硬化研究质量管理规范",
    "good progressive muscular atrophy study practice": "进行性肌萎缩研究质量管理规范",
    "good bulbospinal muscular atrophy study practice": "延髓脊髓肌萎缩研究质量管理规范",
    "good spinal and bulbar muscular atrophy study practice": "脊髓延髓肌萎缩研究质量管理规范",
    "good kennedy disease study practice": "Kennedy 病研究质量管理规范",
    "good scapuloperoneal muscular atrophy study practice": "肩胛腓骨肌萎缩研究质量管理规范",
    "good distal spinal muscular atrophy study practice": "远端型脊髓肌萎缩研究质量管理规范",
    "good juvenile spinal muscular atrophy study practice": "青少年型脊髓肌萎缩研究质量管理规范",
    "good adult spinal muscular atrophy study practice": "成人型脊髓肌萎缩研究质量管理规范",
    "good x-linked spinal muscular atrophy study practice": "X 连锁脊髓肌萎缩研究质量管理规范",
    "good arthrogryposis multiplex congenita study practice": "先天性多发性关节挛缩研究质量管理规范",
    "good nemaline myopathy study practice": "杆状体肌病研究质量管理规范",
    "good central core disease study practice": "中央轴空病研究质量管理规范",
    "good multi-minicore disease study practice": "多微小轴空病研究质量管理规范",
    "good centronuclear myopathy study practice": "中央核肌病研究质量管理规范",
    "good myotubular myopathy study practice": "肌管肌病研究质量管理规范",
    "good congenital fiber type disproportion study practice": "先天性肌纤维类型不均衡研究质量管理规范",
    "good hyaline body myopathy study practice": "透明体肌病研究质量管理规范",
    "good reducing body myopathy study practice": "还原体肌病研究质量管理规范",
    "good cytoplasmic body myopathy study practice": "胞质体肌病研究质量管理规范",
    "good fingerprint body myopathy study practice": "指纹体肌病研究质量管理规范",
    "good sarcotubular myopathy study practice": "肌小管肌病研究质量管理规范",
    "good zebra body myopathy study practice": "斑马体肌病研究质量管理规范",
    "good tubular aggregate myopathy study practice": "管状聚集性肌病研究质量管理规范",
    "good cap disease study practice": "帽状病研究质量管理规范",
    "good trichinosis study practice": "旋毛虫病研究质量管理规范",
    "good toxoplasmosis study practice": "弓形虫病研究质量管理规范",
    "good malaria study practice": "疟疾研究质量管理规范",
    "good leishmaniasis study practice": "利什曼病研究质量管理规范",
    "good trypanosomiasis study practice": "锥虫病研究质量管理规范",
    "good schistosomiasis study practice": "血吸虫病研究质量管理规范",
    "good filariasis study practice": "丝虫病研究质量管理规范",
    "good onchocerciasis study practice": "盘尾丝虫病研究质量管理规范",
    "good loiasis study practice": "罗阿丝虫病研究质量管理规范",
    "good dracunculiasis study practice": "麦地那龙线虫病研究质量管理规范",
    "good strongyloidiasis study practice": "类圆线虫病研究质量管理规范",
    "good hookworm infection study practice": "钩虫感染研究质量管理规范",
    "good ascariasis study practice": "蛔虫病研究质量管理规范",
    "good trichuriasis study practice": "鞭虫病研究质量管理规范",
    "good enterobiasis study practice": "蛲虫病研究质量管理规范",
    "good hymenolepiasis study practice": "膜壳绦虫病研究质量管理规范",
    "good taeniasis study practice": "带绦虫病研究质量管理规范",
    "good echinococcosis study practice": "棘球蚴病研究质量管理规范",
    "good cysticercosis study practice": "囊尾蚴病研究质量管理规范",
    "good sparganosis study practice": "裂头蚴病研究质量管理规范",
    "good diphyllobothriasis study practice": "裂头绦虫病研究质量管理规范",
    "good dipylidiasis study practice": "复孔绦虫病研究质量管理规范",
    "good fascioliasis study practice": "片吸虫病研究质量管理规范",
    "good fasciolopsiasis study practice": "姜片虫病研究质量管理规范",
    "good paragonimiasis study practice": "并殖吸虫病研究质量管理规范",
    "good clonorchiasis study practice": "华支睾吸虫病研究质量管理规范",
    "good opisthorchiasis study practice": "后睾吸虫病研究质量管理规范",
    "good metagonimiasis study practice": "次睾吸虫病研究质量管理规范",
    "good heterophyiasis study practice": "异形吸虫病研究质量管理规范",
    "good nanophyetiasis study practice": "侏形吸虫病研究质量管理规范",
    "good cryptosporidiosis study practice": "隐孢子虫病研究质量管理规范",
    "good giardiasis study practice": "贾第虫病研究质量管理规范",
    "good amebiasis study practice": "阿米巴病研究质量管理规范",
    "good balantidiasis study practice": "结肠小袋纤毛虫病研究质量管理规范",
    "good blastocystosis study practice": "芽囊原虫病研究质量管理规范",
    "good dientamoebiasis study practice": "双核阿米巴病研究质量管理规范",
    "good entamoebiasis study practice": "内阿米巴病研究质量管理规范",
    "good isosporiasis study practice": "等孢子虫病研究质量管理规范",
    "good cyclosporiasis study practice": "环孢子虫病研究质量管理规范",
    "good sarcocystosis study practice": "肉孢子虫病研究质量管理规范",
    "good babesiosis study practice": "巴贝斯虫病研究质量管理规范",
    "good theileriosis study practice": "泰勒虫病研究质量管理规范",
    "good cytauxzoonosis study practice": "胞浆虫病研究质量管理规范",
    "good hepatozoonosis study practice": "肝簇虫病研究质量管理规范",
    "good anaplasmosis study practice": "无形体病研究质量管理规范",
    "good ehrlichiosis study practice": "埃立克体病研究质量管理规范",
    "good neorickettsiosis study practice": "新立克次体病研究质量管理规范",
    "good rickettsiosis study practice": "立克次体病研究质量管理规范",
    "good scrub typhus study practice": "恙虫病研究质量管理规范",
    "good murine typhus study practice": "鼠型斑疹伤寒研究质量管理规范",
    "good epidemic typhus study practice": "流行性斑疹伤寒研究质量管理规范",
    "good rocky mountain spotted fever study practice": "落基山斑点热研究质量管理规范",
    "good mediterranean spotted fever study practice": "地中海斑点热研究质量管理规范",
    "good african tick bite fever study practice": "非洲蜱咬热研究质量管理规范",
    "good queensland tick typhus study practice": "昆士兰蜱传斑疹伤寒研究质量管理规范",
    "good flinders island spotted fever study practice": "弗林德斯岛斑点热研究质量管理规范",
    "good japanese spotted fever study practice": "日本斑点热研究质量管理规范",
    "good rickettsialpox study practice": "立克次体痘研究质量管理规范",
    "good trench fever study practice": "战壕热研究质量管理规范",
    "good cat scratch disease study practice": "猫抓病研究质量管理规范",
    "good bacillary angiomatosis study practice": "杆菌性血管瘤病研究质量管理规范",
    "good peliosis hepatis study practice": "紫癜性肝炎研究质量管理规范",
    "good oroya fever study practice": "奥罗亚热研究质量管理规范",
    "good verruga peruana study practice": "秘鲁疣研究质量管理规范",
    "good Carrion disease study practice": "卡里翁病研究质量管理规范",
    "good bartonellosis study practice": "巴尔通体病研究质量管理规范",
    "good bartonella quintana infection study practice": "五日热巴尔通体感染研究质量管理规范",
    "good bartonella henselae infection study practice": "汉赛巴尔通体感染研究质量管理规范",
    "good bartonella bacilliformis infection study practice": "杆状巴尔通体感染研究质量管理规范",
    "good bartonella vinsonii infection study practice": "文森巴尔通体感染研究质量管理规范",
    "good bartonella elizabethae infection study practice": "伊丽莎白巴尔通体感染研究质量管理规范",
    "good bartonella koehlerae infection study practice": "科勒巴尔通体感染研究质量管理规范",
    "good bartonella clarridgeiae infection study practice": "克拉里奇巴尔通体感染研究质量管理规范",
    "good bartonella rochalimae infection study practice": "罗查利马巴尔通体感染研究质量管理规范",
    "good bartonella bovis infection study practice": "牛巴尔通体感染研究质量管理规范",
    "good bartonella alsatica infection study practice": "阿尔萨斯巴尔通体感染研究质量管理规范",
    "good bartonella taylorii infection study practice": "泰勒巴尔通体感染研究质量管理规范",
    "good bartonella tribocorum infection study practice": "特利波科拉姆巴尔通体感染研究质量管理规范",
    "good bartonella grahamii infection study practice": "格雷厄姆巴尔通体感染研究质量管理规范",
    "good bartonella doshiae infection study practice": "多希巴尔通体感染研究质量管理规范",
    "good bartonella schoenbuchensis infection study practice": "舍恩布亨巴尔通体感染研究质量管理规范",
    "good bartonella capreoli infection study practice": "卡普雷奥利巴尔通体感染研究质量管理规范",
    "good bartonella birtlesii infection study practice": "伯特尔斯巴尔通体感染研究质量管理规范",
    "good bartonella washoensis infection study practice": "瓦肖巴尔通体感染研究质量管理规范",
    "good bartonella vulpes infection study practice": "狐巴尔通体感染研究质量管理规范",
    "good bartonella rattimassiliensis infection study practice": "拉蒂马赛巴尔通体感染研究质量管理规范",
    "good bartonella queenslandensis infection study practice": "昆士兰巴尔通体感染研究质量管理规范",
    "good bartonella krasnovii infection study practice": "克拉斯诺夫巴尔通体感染研究质量管理规范",
    "good bartonella jaculi infection study practice": "雅库利巴尔通体感染研究质量管理规范",
    "good bartonella senegalensis infection study practice": "塞内加尔巴尔通体感染研究质量管理规范",
  };

  // Replace phrase-by-phrase (longer first) with word-boundary matching
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  let result = func;
  for (const key of sortedKeys) {
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    result = result.replace(re, dict[key]!);
  }
  // If no substitution happened, don't use it
  return result !== func ? result : undefined;
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
  const gtex = vep.gtex_expression;

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
  if (gtex && Object.keys(gtex).length > 0) {
    lines.push("", "## 3. GTEx 组织表达 (mRNA TPM)", "");
    lines.push("| 组织 | TPM |", "|------|-----|");
    const sorted = Object.entries(gtex).sort((a, b) => b[1] - a[1]);
    for (const [tissue, tpm] of sorted.slice(0, 8)) {
      lines.push(`| ${tissue} | ${tpm} |`);
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
