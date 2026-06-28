import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dna, AlertCircle } from "lucide-react";
import type { FullResult } from "@contracts/variant";

// ═══════════════════════════════════════════════════════════════════
// GTEx tissue → organ system mapping (GTEx v8)
// ═══════════════════════════════════════════════════════════════════
const TISSUE_SYSTEM_MAP: Record<string, string> = {
  // 神经系统
  "Brain - Cortex": "神经系统",
  "Brain - Cerebellum": "神经系统",
  "Brain - Cerebellar Hemisphere": "神经系统",
  "Brain - Frontal Cortex (BA9)": "神经系统",
  "Brain - Anterior cingulate cortex (BA24)": "神经系统",
  "Brain - Hippocampus": "神经系统",
  "Brain - Hypothalamus": "神经系统",
  "Brain - Amygdala": "神经系统",
  "Brain - Putamen (basal ganglia)": "神经系统",
  "Brain - Caudate (basal ganglia)": "神经系统",
  "Brain - Nucleus accumbens (basal ganglia)": "神经系统",
  "Brain - Substantia nigra": "神经系统",
  "Brain - Spinal cord (cervical c-1)": "神经系统",
  // 心血管系统
  "Heart - Left Ventricle": "心血管系统",
  "Heart - Atrial Appendage": "心血管系统",
  "Artery - Aorta": "心血管系统",
  "Artery - Coronary": "心血管系统",
  "Artery - Tibial": "心血管系统",
  // 消化系统
  "Esophagus - Mucosa": "消化系统",
  "Esophagus - Muscularis": "消化系统",
  "Esophagus - Gastroesophageal Junction": "消化系统",
  "Stomach": "消化系统",
  "Colon - Sigmoid": "消化系统",
  "Colon - Transverse": "消化系统",
  "Small Intestine - Terminal Ileum": "消化系统",
  "Liver": "消化系统",
  // 内分泌系统
  "Pituitary": "内分泌系统",
  "Thyroid": "内分泌系统",
  "Adrenal Gland": "内分泌系统",
  "Pancreas": "内分泌系统",
  // 免疫系统
  "Whole Blood": "免疫系统",
  "Spleen": "免疫系统",
  "Cells - EBV-transformed lymphocytes": "免疫系统",
  "Appendix": "免疫系统",
  // 呼吸系统
  "Lung": "呼吸系统",
  // 肌肉骨骼系统
  "Muscle - Skeletal": "肌肉骨骼系统",
  // 皮肤系统
  "Skin - Sun Exposed (Lower leg)": "皮肤系统",
  "Skin - Not Sun Exposed (Suprapubic)": "皮肤系统",
  // 泌尿生殖系统
  "Breast - Mammary Tissue": "泌尿生殖系统",
  "Kidney - Cortex": "泌尿生殖系统",
  "Bladder": "泌尿生殖系统",
  "Uterus": "泌尿生殖系统",
  "Ovary": "泌尿生殖系统",
  "Prostate": "泌尿生殖系统",
  "Testis": "泌尿生殖系统",
  "Fallopian Tube": "泌尿生殖系统",
  "Cervix - Endocervix": "泌尿生殖系统",
  "Cervix - Ectocervix": "泌尿生殖系统",
  "Vagina": "泌尿生殖系统",
  // 脂肪 / 其他
  "Adipose - Subcutaneous": "脂肪组织",
  "Adipose - Visceral (Omentum)": "脂肪组织",
  "Nerve - Tibial": "外周神经",
  "Cells - Cultured fibroblasts": "细胞培养",
  "Minor Salivary Gland": "唾液腺",
};

// ═══════════════════════════════════════════════════════════════════
// SO consequence terms → Chinese
// ═══════════════════════════════════════════════════════════════════
const CONSEQ_MAP: Record<string, string> = {
  missense_variant: "错义突变",
  stop_gained: "无义突变",
  frameshift_variant: "移码突变",
  splice_donor_variant: "剪接供体变异",
  splice_acceptor_variant: "剪接受体变异",
  splice_region_variant: "剪接区域变异",
  start_lost: "起始密码子丢失",
  stop_lost: "终止密码子丢失",
  inframe_insertion: "框内插入",
  inframe_deletion: "框内缺失",
  synonymous_variant: "同义突变",
  "5_prime_UTR_variant": "5'UTR 变异",
  "3_prime_UTR_variant": "3'UTR 变异",
  intron_variant: "内含子变异",
  intergenic_variant: "基因间变异",
  upstream_gene_variant: "上游基因变异",
  downstream_gene_variant: "下游基因变异",
  coding_sequence_variant: "编码序列变异",
  non_coding_transcript_exon_variant: "非编码外显子变异",
};

// ═══════════════════════════════════════════════════════════════════
// Fixed tier thresholds (relative to max TPM)
// ═══════════════════════════════════════════════════════════════════
function getTier(ratio: number): {
  label: string;
  bars: number;
  colorClass: string;
} {
  if (ratio >= 0.5)
    return { label: "最大程度影响", bars: 5, colorClass: "bg-red-500" };
  if (ratio >= 0.1)
    return { label: "中度影响", bars: 3, colorClass: "bg-orange-400" };
  if (ratio >= 0.01)
    return { label: "低影响", bars: 1, colorClass: "bg-yellow-400" };
  return { label: "可忽略", bars: 0, colorClass: "bg-slate-200" };
}

// ═══════════════════════════════════════════════════════════════════
// Tissue impact analysis
// ═══════════════════════════════════════════════════════════════════
interface TissueItem {
  tissue: string;
  system: string;
  tpm: number;
  ratio: number;
  tier: ReturnType<typeof getTier>;
}

function analyzeTissues(
  gtex: Record<string, number> | undefined
): TissueItem[] | null {
  if (!gtex || Object.keys(gtex).length === 0) return null;

  const entries = Object.entries(gtex)
    .map(([tissue, tpm]) => ({
      tissue,
      system: TISSUE_SYSTEM_MAP[tissue] || "其他",
      tpm,
    }))
    .sort((a, b) => b.tpm - a.tpm);

  if (entries.length === 0) return null;

  const maxTpm = entries[0].tpm;
  if (maxTpm === 0) return null;

  // Top 10 only
  return entries.slice(0, 10).map((e) => {
    const ratio = e.tpm / maxTpm;
    return { ...e, ratio, tier: getTier(ratio) };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Transcript analysis
// ═══════════════════════════════════════════════════════════════════
interface TxItem {
  id: string;
  type: "mane" | "canonical" | "other";
  typeLabel: string;
  conseq: string;
  badgeClass: string;
}

function analyzeTranscripts(
  allTx: any[] | undefined,
  _geneSymbol?: string
): TxItem[] | null {
  if (!allTx || allTx.length === 0) return null;

  const items: TxItem[] = allTx.map((tx) => {
    const id = tx.transcript_id || "";
    const isMane = !!tx.mane_select;
    const isCanonical = tx.canonical === 1;
    const conseqTerms: string[] = tx.consequence_terms || [];
    const conseq = conseqTerms
      .slice(0, 2)
      .map((c: string) => CONSEQ_MAP[c] || c)
      .join(" / ");

    if (isMane) {
      return {
        id,
        type: "mane",
        typeLabel: "MANE Select",
        conseq,
        badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
      };
    }
    if (isCanonical) {
      return {
        id,
        type: "canonical",
        typeLabel: "Canonical",
        conseq,
        badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
      };
    }
    return {
      id,
      type: "other",
      typeLabel: "其他",
      conseq,
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    };
  });

  // Sort: MANE > Canonical > Other
  const order = { mane: 0, canonical: 1, other: 2 };
  items.sort((a, b) => order[a.type] - order[b.type]);

  // Limit to top 8 for display
  return items.slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════
// Generate inference text
// ═══════════════════════════════════════════════════════════════════
function generateInference(
  tissues: TissueItem[],
  mainTx: TxItem | undefined,
  geneSymbol: string | undefined
): string {
  if (!tissues.length) return "";

  const top = tissues[0];
  const midTier = tissues.filter((t) => t.tier.bars === 3);

  const txName = mainTx?.id ?? (geneSymbol ? `${geneSymbol} 主要转录本` : "该转录本");
  const txType = mainTx?.typeLabel ?? "";
  const conseq = mainTx?.conseq ?? "该变异";

  let text = `该突变影响 ${txName}`;
  if (txType) text += `（${txType}）`;
  text += `，此转录本在 **${top.system}**（${top.tissue}，TPM=${top.tpm.toFixed(1)}）高表达。`;
  text += `${conseq} 可能通过此转录本对 **${top.system}** 产生最大程度的功能影响`;

  if (midTier.length > 0) {
    const systems = [...new Set(midTier.map((t) => t.system))];
    text += `，同时 **${systems.join("、")}** 也可能受到中度影响`;
  }
  text += "。";

  return text;
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════
export default function TissueImpact({
  result,
}: {
  result: FullResult;
}) {
  const tissues = analyzeTissues(result.vep.gtex_expression);
  const transcripts = analyzeTranscripts(
    result.vep.all_transcript_consequences,
    result.vep.gene_symbol
  );
  const mainTx = transcripts?.find((t) => t.type === "mane") ?? transcripts?.[0];
  const inference = tissues
    ? generateInference(tissues, mainTx, result.vep.gene_symbol)
    : "";

  // Group tissues by tier for display
  const grouped = tissues?.reduce<Record<string, TissueItem[]>>((acc, t) => {
    const key = t.tier.label;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const tierOrder = ["最大程度影响", "中度影响", "低影响"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Dna className="w-4 h-4 text-blue-600" />
          转录本与组织影响
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Transcript list ── */}
        {transcripts && transcripts.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">
              受影响的转录本（按重要性排序）
            </h4>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 pr-3 font-medium text-slate-500">
                      转录本 ID
                    </th>
                    <th className="text-left py-1.5 pr-3 font-medium text-slate-500">
                      类型
                    </th>
                    <th className="text-left py-1.5 font-medium text-slate-500">
                      变异后果
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transcripts.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-1.5 pr-3 font-mono text-slate-700">
                        {tx.id}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${tx.badgeClass}`}
                        >
                          {tx.typeLabel}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-slate-600">{tx.conseq}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Inference ── */}
        {inference && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <p
              className="text-sm text-blue-800 leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: inference.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
              }}
            />
          </div>
        )}

        {/* ── Tissue expression table ── */}
        {grouped && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">
              GTEx 组织表达与影响推断（Top 10）
            </h4>
            <div className="space-y-3">
              {tierOrder.map(
                (tierLabel) =>
                  grouped[tierLabel]?.length > 0 && (
                    <div key={tierLabel}>
                      <p className="text-xs font-medium text-slate-500 mb-1.5">
                        {tierLabel}
                      </p>
                      <div className="space-y-1.5">
                        {grouped[tierLabel].map((t, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 text-sm"
                          >
                            {/* Mini bar */}
                            <div className="w-16 flex gap-px shrink-0">
                              {[1, 2, 3, 4, 5].map((bar) => (
                                <div
                                  key={bar}
                                  className={`h-2.5 flex-1 rounded-sm ${
                                    bar <= t.tier.bars
                                      ? t.tier.colorClass
                                      : "bg-slate-100"
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-slate-700 w-48 truncate shrink-0">
                              {t.tissue}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] shrink-0"
                            >
                              {t.system}
                            </Badge>
                            <span className="text-xs text-slate-400 ml-auto">
                              {t.tpm.toFixed(1)} TPM
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
              )}
            </div>
          </div>
        )}

        {/* ── No data fallback ── */}
        {!tissues && (
          <div className="text-sm text-slate-400 text-center py-4">
            无 GTEx 组织表达数据
          </div>
        )}
      </CardContent>
    </Card>
  );
}
