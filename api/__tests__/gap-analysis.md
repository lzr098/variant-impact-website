# Part 3: Suggested New Analyses — Gap Analysis & Implementation Plans

> Updated: 2026-06-29 | Part of variant-impact-website testing plan
> ✅ Implemented: P0 + Item 3 (PM1, PM4, BP7), Bug fixes (HGVS parser, ClinVar LP)

---

## ✅ Implemented (2026-06-29)

### Bug Fixes
1. **Parser: HGVS space format** — `chr11:g.121567110 C>G` now parses correctly by detecting `g.<pos>` token joined after split
2. **ClinVar LP substring bug** — Changed `includes("pathogenic")` to `===` comparison; "Likely pathogenic" now correctly triggers PP5_Moderate

### New ACMG Rules
3. **PM1** — Protein domain impact (missense in active site/binding/domain) using UniProt features
4. **PM4** — Inframe indel evidence in non-repeat regions
5. **BP7** — Silent synonymous evidence (no splicing impact detected by SpliceAI)

### Test Coverage
- ACMG tests: 70 cases (was 54) — added 16 new tests for PM1/PM4/BP7 + ClinVar fix

## Summary of Test Coverage Gap

Current tests now cover the **complete ACMG evidence engine** (54 test cases) and **input parser** (37 test cases). These tests expose patterns that validate the need for the 7 additional analyses identified below.

---

## 1. Missense Variants — Protein Domain Impact (PM1)

**Current Gap:**
UniProt already queries `features_near_variant` but the ACMG engine does not use this data at all (`_uniprot` parameter is unused).

**Evidence from Tests:**
- ACMG test "missense + REVEL>0.75 → PP3 Supporting" misses the domain context
- A missense in a critical active site should get **PM1_Strong (+4)** vs. generic PP3 (+1)
- ACMG test data doesn't include UniProt features — confirming the gap

**Implementation Plan (难度: 中等):**
```
1. In buildAcmgEvidence, accept uniprot parameter actively
2. Check if protein_start falls within any critical domain:
   - "Active site" → PM1_Strong (+4 pts)
   - "Binding site" → PM1_Moderate (+2 pts) 
   - "Domain" (functional) → PM1_Supporting (+1 pt)
3. In buildMarkdown, add a new row "## 7a. 蛋白结构域影响" with domain hit info
```

**Files to modify:**
- `api/services/variantAnalyzer.ts` — `buildAcmgEvidence()` lines 886-1024
- `api/services/variantAnalyzer.ts` — `buildMarkdown()` add domain section

---

## 2. Inframe Insertion/Deletion — PM4 Evidence

**Current Gap:**
`isLofVariant()` excludes `inframe_insertion` / `inframe_deletion`. No PM4 implementation exists.

**Evidence from Tests:**
- Parser test confirms inframe indels parse correctly (e.g., `chr7:117559591:C:CTTTT` → `ref:"-", alt:"TTTT"`)
- ACMG test "synonymous + AF=0.005 → VUS" shows no criteria fire for variants without LOF or missense
- An inframe indel with 3+ residues changed in a non-repeat region should get **PM4_Strong (+4)**

**Implementation Plan (难度: 低):**
```
1. Add isInframeIndel(vep) helper:
   - consequence_terms includes inframe_insertion or inframe_deletion
2. In buildAcmgEvidence, after PVS1 block:
   - if isInframeIndel && not in repeat region:
     - change >= 2 residues → PM4_Strong (+4)
     - change = 1 residue → PM4_Moderate (+2)
3. Check UniProt features for Repeat region exclusion
```

**Files to modify:**
- `api/services/variantAnalyzer.ts` — add `isInframeIndel()` and PM4 block

---

## 3. Synonymous Variants — BP7 Evidence

**Current Gap:**
Synonymous variants always get VUS classification. No splice assessment for synonymous.

**Evidence from Tests:**
- ACMG test confirms: synonymous + AF=0.005 → VUS (0 evidence items)
- But a truly silent variant (spliceAI max < 0.1, not in ±20bp of exon) should get **BP7 (+1)**
- Message: "This is a silent variant with predicted minimal splicing impact"

**Implementation Plan (难度: 低):**
```
1. Add isSilentSynonymous(vep) helper:
   - consequence_terms includes "synonymous_variant"
   - SpliceAI max_delta < 0.1
   - Not within 20bp of exon boundary (check cDNA position from VEP)
2. In ACMG, after PP3 block:
   - if isSilentSynonymous → BP7 (+1)
3. Warning in report: "同义突变，预测无剪接影响"
```

**Files to modify:**
- `api/services/variantAnalyzer.ts` — add `isSilentSynonymous()` and BP7 block

---

## 4. Splice Site Variants — Alternative Splice Site Assessment

**Current Gap:**
`isSpliceAltered()` uses only SpliceAI raw scores. No exon-level context.

**Evidence from Tests:**
- ACMG test: splice donor + no constraint → PVS1_Moderate (2 pts)
- The engine doesn't check if the affected exon is constitutively spliced across all transcripts

**Implementation Plan (难度: 高):**
```
1. From VEP all_transcript_consequences, check:
   - How many transcripts include this exon?
   - In transcripts that skip this exon, what's the reading frame impact?
2. Classification:
   - Constitutive exon (all transcripts) → full PVS1 strength
   - Alternative exon (some transcripts skip) → downgrade PVS1 by one level
   - Optional exon (most transcripts skip) → PVS1_Moderate only
3. Requires per-exon annotation data (GENCODE exon database)
```

**Files to modify:**
- New external data source needed (GENCODE exon annotation)
- `api/services/variantAnalyzer.ts` — modify PVS1 logic

---

## 5. Structural Variants — Basic Support (Phase 1)

**Current Gap:**
README states SV unsupported. No parsing or analysis for CNV/del/dup.

**Evidence from Tests:**
- Parser edge case test confirms unsupported format throws error
- No ACMG tests cover SV scenarios by design

**Implementation Plan — Phase 1 (难度: 高):**
```
1. New input format: chr:pos:type:size
   - e.g., "chr7:55000000:DEL:10000", "chr22:20000000:DUP:500000"
2. parseVariant: add SV format handling
3. For DEL/DUP:
   - Query Ensembl region API for overlapping genes
   - If SV spans entire gene → "Gene deletion" / "Gene duplication" annotation
4. No ACMG scoring — informational annotation only
5. Report section: "## SV 结构变异注释"
```

**Files to modify:**
- `api/services/variantAnalyzer.ts` — `parseVariant()` and new SV analysis

---

## 6. Gene-Level Constraint Enhancement — DECIPHER

**Current Gap:**
Only gnomAD constraint (pLI/LOEUF) is queried. No dosage sensitivity data.

**Evidence from Tests:**
- ACMG test: LOF + high pLI → PVS1 (Very Strong) is correct
- But a gene with DECIPHER HI score=1 (haploinsufficient) AND ACMG-consensus should get an additional supporting evidence
- Missing PP2 (low benign missense rate) — needs DOMINO or similar score

**Implementation Plan (难度: 中等):**
```
1. Query DECIPHER API for gene dosage sensitivity:
   - GET https://decipher.sanger.ac.uk/api/genes/{gene_symbol}
   - Extract: hi_score (haploinsufficiency), ts_score (triplosensitivity)
2. In ACMG:
   - If hi_score >= 0.9 → evidence supporting PVS1 strength
   - If gene has ACMG evidence tag → add PP2_Supporting for missense
3. Report: add constraint enrichment row in "功能预测" section
```

**Files to modify:**
- New function `queryDecipher()` in `variantAnalyzer.ts`
- `api/services/variantAnalyzer.ts` — ACMG section

---

## 7. HGVS Expression Relay — VariantValidator

**Current Gap:**
NM_:c. inputs parse but cannot be analyzed (pos=0, chrom="").

**Evidence from Tests:**
- Parser test confirms: NM_:c. parsed → hgvs_g="NM_000492.4:c.1521_1523delCTT", chrom="", pos=0
- analyzeVariant would fail at "Could not determine variant coordinates"

**Implementation Plan (难度: 中等):**
```
1. In analyzeVariant(), after NM_:c. detection:
   - Call VariantValidator API: GET https://rest.variantvalidator.org/VariantValidator/variant_validator/hg38/{hgvs_c}
   - Parse response to extract genomic g. coordinates
   - Set variant.chrom, variant.pos, variant.hgvs_g from response
2. Fallback: if validation fails, return clear error message
3. Report: note "HGVS expression validated via VariantValidator"
```

**Files to modify:**
- `api/services/variantAnalyzer.ts` — `analyzeVariant()` resolve step

---

## Implementation Priority

| Priority | Analysis | Impact | Effort | Rationale |
|----------|----------|--------|--------|-----------|
| **P0** | PM1 (Domain) | High | Medium | UniProt data already queried; ACMG rule ready |
| **P0** | PM4 (Inframe indel) | Medium | Low | Simple consequence check; no new API needed |
| **P1** | BP7 (Synonymous) | Medium | Low | Reduces VUS rate for silent variants |
| **P1** | HGVS Relay | High | Medium | Enables NM_:c. input analysis end-to-end |
| **P2** | DECIPHER Constraint | Medium | Medium | New API; incremental evidence weight |
| **P2** | PM1 fine-tuning | Medium | Medium | Requires domain boundary enrichment |
| **P3** | Alt Splice Assessment | Low | High | Complex; needs external data |
| **P3** | SV Support | Low | High | Entirely new analysis pipeline |

## Test Implications

For each new analysis, the test plan would add:

1. **PM1 Tests** (5-8 cases): domain hit/empty/no overlap
2. **PM4 Tests** (4-6 cases): 1-residue/multi-residue/repeat region exclusion
3. **BP7 Tests** (3-4 cases): true silent/synonymous-with-splice-impact/not-near-exon
4. **VariantValidator Tests** (3-4 cases): valid NM_/invalid NM_/API failure
5. **DECIPHER Tests** (3-4 cases): hi_score thresholds/missing gene/API errors
6. **SV Tests** (4-6 cases): DEL/DUP/boundary/overlapping-genes
7. **Alt Splice Tests** (4-5 cases): constitutive/alternative/optional exon
