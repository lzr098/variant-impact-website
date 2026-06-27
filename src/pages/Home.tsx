import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Search,
  Dna,
  FileText,
  Database,
  BookOpen,
  Activity,
  Beaker,
  ScrollText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Sparkles,
  Shield,
  Microscope,
} from "lucide-react";

const ACMG_CLASS_COLORS: Record<string, string> = {
  pathogenic: "bg-red-600 text-white",
  likely_pathogenic: "bg-red-400 text-white",
  vus_favor_pathogenic: "bg-orange-400 text-white",
  vus: "bg-yellow-400 text-black",
  vus_favor_benign: "bg-blue-300 text-black",
  likely_benign: "bg-green-400 text-white",
  benign: "bg-green-600 text-white",
};

const ACMG_CLASS_MAP: Record<string, string> = {
  pathogenic: "致病 (Pathogenic)",
  likely_pathogenic: "可能致病 (Likely Pathogenic)",
  vus: "意义未明 (VUS)",
  vus_favor_pathogenic: "VUS-偏致病",
  vus_favor_benign: "VUS-偏良性",
  likely_benign: "可能良性 (Likely Benign)",
  benign: "良性 (Benign)",
};

const STRENGTH_MAP: Record<string, string> = {
  "Very Strong": "非常强",
  Strong: "强",
  Moderate: "中等",
  Supporting: "支持",
  "Stand-alone": "独立",
};

const CLINVAR_CLASS_MAP: Record<string, string> = {
  Pathogenic: "致病",
  "Likely pathogenic": "可能致病",
  "Uncertain significance": "意义未明",
  "Likely benign": "可能良性",
  Benign: "良性",
};

// ── SO consequence terms 中文映射 ──
const CONSEQ_MAP: Record<string, string> = {
  missense_variant: "错义突变",
  stop_gained: "无义突变（终止密码子获得）",
  frameshift_variant: "移码突变",
  splice_donor_variant: "剪接供体位点变异",
  splice_acceptor_variant: "剪接受体位点变异",
  splice_region_variant: "剪接区域变异",
  start_lost: "起始密码子丢失",
  stop_lost: "终止密码子丢失",
  inframe_insertion: "框内插入",
  inframe_deletion: "框内缺失",
  synonymous_variant: "同义突变",
  "5_prime_UTR_variant": "5' UTR 变异",
  "3_prime_UTR_variant": "3' UTR 变异",
  intron_variant: "内含子变异",
  intergenic_variant: "基因间区变异",
  upstream_gene_variant: "基因上游变异",
  downstream_gene_variant: "基因下游变异",
  coding_sequence_variant: "编码序列变异",
  non_coding_transcript_exon_variant: "非编码转录本外显子变异",
};

// ── UniProt feature types 中文映射 ──
const FEATURE_TYPE_MAP: Record<string, string> = {
  Chain: "成熟肽链",
  "Peptide chain": "肽链",
  Domain: "结构域",
  "DNA-binding region": "DNA结合区",
  Region: "功能区域",
  "Zinc finger region": "锌指区域",
  "Compositional bias": "组成偏倚区",
  "Binding site": "结合位点",
  "Active site": "活性位点",
  "Metal binding": "金属离子结合位点",
  Site: "功能位点",
  "Modified residue": "翻译后修饰残基",
  Lipidation: "脂修饰",
  Glycosylation: "糖基化位点",
  "Disulfide bond": "二硫键",
  "Cross-link": "交联",
  "Transit peptide": "转运肽",
  "Signal peptide": "信号肽",
  Propeptide: "前肽",
  "Transmembrane region": "跨膜区",
  "Intramembrane region": "膜内区",
  Repeat: "重复序列",
  Motif: "基序",
  Coiled_coil: "卷曲螺旋",
  Helix: "螺旋结构",
  Turn: "转角结构",
  "Beta strand": "β链",
  Topological_domain: "拓扑结构域",
};

function formatConsequence(terms: string[] | undefined): string {
  if (!terms || terms.length === 0) return "N/A";
  return terms
    .slice(0, 3)
    .map((t) => CONSEQ_MAP[t] || t)
    .join(" / ");
}

function getProteinDisplay(
  protein: string | undefined,
  aminoAcids: string | undefined,
  proteinStart: number | undefined
): string {
  if (protein) return protein;
  // Fallback: build from amino_acids + protein_position
  // amino_acids format: "A/T" (single-letter ref/alt)
  if (aminoAcids && proteinStart) {
    const parts = aminoAcids.split("/");
    if (parts.length === 2) {
      return `p.${parts[0]}${proteinStart}${parts[1]} (推断)`;
    }
    return `${aminoAcids} @ ${proteinStart}`;
  }
  if (aminoAcids) return aminoAcids;
  return "N/A";
}

export default function Home() {
  const [variantInput, setVariantInput] = useState("");
  const [options, setOptions] = useState({
    includeGnomad: true,
    includeClinvar: true,
    includeLiterature: true,
    includeEve: true,
    secondVariantPathogenic: false,
  });

  const analyze = trpc.variant.analyze.useMutation();
  const result = analyze.data?.success ? analyze.data.data : null;
  const error = analyze.data?.success === false ? analyze.data.error : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantInput.trim()) return;
    analyze.mutate({ variant: variantInput.trim(), options });
  };

  const getClassBadge = (cls: string) => {
    const colorClass = ACMG_CLASS_COLORS[cls] ?? "bg-gray-400 text-white";
    const label = ACMG_CLASS_MAP[cls] ?? cls;
    return (
      <Badge className={`${colorClass} text-sm px-3 py-1 font-semibold`}>
        {label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Dna className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              GRCh38 变异功能影响分析器
            </h1>
            <p className="text-xs text-slate-500">
              ACMG 证据权重分类 · 整合多数据源
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* ── 1. Input (always top) ── */}
        <Card className="shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              输入变异
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="输入变异: chr:pos:ref:alt / HGVS / rsID / NM_:c. / VCF tab"
                  value={variantInput}
                  onChange={(e) => setVariantInput(e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  type="submit"
                  disabled={analyze.isPending || !variantInput.trim()}
                  className="min-w-[100px]"
                >
                  {analyze.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-1" />
                      分析
                    </>
                  )}
                </Button>
              </div>

              {/* Options */}
              <div className="flex flex-wrap gap-4 pt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="gnomad"
                    checked={options.includeGnomad}
                    onCheckedChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        includeGnomad: v === true,
                      }))
                    }
                  />
                  <Label htmlFor="gnomad" className="text-xs cursor-pointer">
                    gnomAD 频率
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="clinvar"
                    checked={options.includeClinvar}
                    onCheckedChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        includeClinvar: v === true,
                      }))
                    }
                  />
                  <Label htmlFor="clinvar" className="text-xs cursor-pointer">
                    ClinVar
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="lit"
                    checked={options.includeLiterature}
                    onCheckedChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        includeLiterature: v === true,
                      }))
                    }
                  />
                  <Label htmlFor="lit" className="text-xs cursor-pointer">
                    文献检索
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="eve"
                    checked={options.includeEve}
                    onCheckedChange={(v) =>
                      setOptions((o) => ({ ...o, includeEve: v === true }))
                    }
                  />
                  <Label htmlFor="eve" className="text-xs cursor-pointer">
                    EVE 模型
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pm3"
                    checked={options.secondVariantPathogenic}
                    onCheckedChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        secondVariantPathogenic: v === true,
                      }))
                    }
                  />
                  <Label htmlFor="pm3" className="text-xs cursor-pointer">
                    对侧已知致病 (PM3)
                  </Label>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ── 2. Supported formats (when no result) ── */}
        {!result && !analyze.isPending && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold text-sm text-slate-700">
                  支持的输入格式
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 rounded px-3 py-2 font-mono">
                  <span className="text-slate-400">标准格式</span>
                  <p className="text-slate-700 mt-0.5">chr11:121567110:C:G</p>
                </div>
                <div className="bg-slate-50 rounded px-3 py-2 font-mono">
                  <span className="text-slate-400">显示格式</span>
                  <p className="text-slate-700 mt-0.5">
                    chr11:121567110 C&gt;G
                  </p>
                </div>
                <div className="bg-slate-50 rounded px-3 py-2 font-mono">
                  <span className="text-slate-400">HGVS</span>
                  <p className="text-slate-700 mt-0.5">
                    11:g.121567110C&gt;G
                  </p>
                </div>
                <div className="bg-slate-50 rounded px-3 py-2 font-mono">
                  <span className="text-slate-400">rsID / NM_</span>
                  <p className="text-slate-700 mt-0.5">
                    rs755753065 / NM_000384.3:c.9412C&gt;G
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 3. Feature cards (when no result) ── */}
        {!result && !analyze.isPending && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100">
              <CardContent className="pt-5 pb-4">
                <Microscope className="w-8 h-8 text-blue-600 mb-3" />
                <h3 className="font-semibold text-slate-800 mb-1">
                  功能预测
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  整合 SIFT、PolyPhen、AlphaMissense、CADD、REVEL、SpliceAI
                  等多种预测工具，全面评估变异对蛋白功能的影响
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
              <CardContent className="pt-5 pb-4">
                <Database className="w-8 h-8 text-emerald-600 mb-3" />
                <h3 className="font-semibold text-slate-800 mb-1">
                  多数据源查询
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  自动查询 gnomAD 人群频率、ClinVar 临床注释、UniProt
                  蛋白信息、Europe PMC 文献等权威数据库
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-100">
              <CardContent className="pt-5 pb-4">
                <Shield className="w-8 h-8 text-amber-600 mb-3" />
                <h3 className="font-semibold text-slate-800 mb-1">
                  ACMG 自动分级
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  基于 ACMG-AMP 2015
                  指南，自动应用证据规则，生成功能权重评分与致病性分级报告
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-300 bg-red-50 shadow-sm">
            <CardContent className="pt-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-800">分析失败</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary Card */}
            <Card className="shadow-md border-l-4 border-l-blue-500">
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-slate-500">
                      输入: {result.variant.raw}
                    </p>
                    <p className="font-mono text-lg font-semibold text-slate-900">
                      {result.variant.hgvs_g}
                    </p>
                    {result.variant.rsid && (
                      <Badge variant="outline" className="text-xs">
                        {result.variant.rsid}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-sm text-slate-500 mb-1">
                      ACMG 分类
                    </div>
                    {getClassBadge(result.acmg.classification)}
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-500">基因</p>
                    <p className="font-semibold text-slate-800">
                      {result.vep.gene_symbol ?? "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">转录本</p>
                    <p className="font-semibold text-slate-800 text-xs truncate">
                      {result.vep.transcript ?? "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">蛋白变异</p>
                    <p className="font-semibold text-slate-800 text-xs">
                      {getProteinDisplay(
                        result.vep.protein,
                        result.vep.amino_acids,
                        result.vep.protein_start
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">变异后果</p>
                    <p className="font-semibold text-slate-800 text-xs">
                      {formatConsequence(result.vep.consequence_terms)}
                    </p>
                  </div>
                </div>

                {/* Score bars */}
                <div className="mt-4 flex items-center gap-4 text-xs">
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-red-600 font-medium">
                        致病分值: {result.acmg.pathogenic_score}
                      </span>
                      <span className="text-green-600 font-medium">
                        良性分值: {result.acmg.benign_score}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden flex">
                      <div
                        className="bg-red-500 h-full transition-all"
                        style={{
                          width: `${Math.min(
                            (result.acmg.pathogenic_score / 10) * 50,
                            50
                          )}%`,
                        }}
                      />
                      <div className="w-px bg-white" />
                      <div
                        className="bg-green-500 h-full transition-all"
                        style={{
                          width: `${Math.min(
                            (result.acmg.benign_score / 8) * 50,
                            50
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detail Tabs */}
            <Tabs defaultValue="predictions" className="space-y-4">
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="predictions">
                  <Beaker className="w-3.5 h-3.5 mr-1" />
                  功能预测
                </TabsTrigger>
                <TabsTrigger value="population">
                  <Database className="w-3.5 h-3.5 mr-1" />
                  人群频率
                </TabsTrigger>
                <TabsTrigger value="clinvar">
                  <Activity className="w-3.5 h-3.5 mr-1" />
                  ClinVar
                </TabsTrigger>
                <TabsTrigger value="protein">
                  <Dna className="w-3.5 h-3.5 mr-1" />
                  蛋白信息
                </TabsTrigger>
                <TabsTrigger value="literature">
                  <BookOpen className="w-3.5 h-3.5 mr-1" />
                  文献
                </TabsTrigger>
                <TabsTrigger value="acmg">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  ACMG证据
                </TabsTrigger>
                <TabsTrigger value="markdown">
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  报告
                </TabsTrigger>
              </TabsList>

              {/* Predictions */}
              <TabsContent value="predictions">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Beaker className="w-4 h-4 text-blue-600" />
                      功能预测 (VEP)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4 font-medium text-slate-600">
                              工具
                            </th>
                            <th className="text-left py-2 pr-4 font-medium text-slate-600">
                              预测
                            </th>
                            <th className="text-left py-2 font-medium text-slate-600">
                              分值
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          <tr>
                            <td className="py-2 pr-4 font-medium">SIFT</td>
                            <td className="py-2 pr-4">
                              {result.vep.sift?.prediction ?? "N/A"}
                            </td>
                            <td className="py-2">
                              {result.vep.sift?.score?.toFixed(3) ?? "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-4 font-medium">
                              PolyPhen
                            </td>
                            <td className="py-2 pr-4">
                              {result.vep.polyphen?.prediction ?? "N/A"}
                            </td>
                            <td className="py-2">
                              {result.vep.polyphen?.score?.toFixed(3) ?? "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-4 font-medium">
                              AlphaMissense
                            </td>
                            <td className="py-2 pr-4">
                              {result.vep.alphamissense?.class ?? "N/A"}
                            </td>
                            <td className="py-2">
                              {result.vep.alphamissense?.pathogenicity?.toFixed(
                                3
                              ) ?? "N/A"}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-4 font-medium">
                              CADD phred
                            </td>
                            <td className="py-2 pr-4">—</td>
                            <td
                              className={`py-2 font-medium ${
                                (result.vep.cadd_phred ?? 0) >= 25
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {result.vep.cadd_phred ?? "N/A"}
                            </td>
                          </tr>
                          {result.vep.revel != null && (
                            <tr>
                              <td className="py-2 pr-4 font-medium">REVEL</td>
                              <td
                                className={`py-2 pr-4 font-medium ${
                                  result.vep.revel > 0.5
                                    ? "text-red-600"
                                    : "text-green-600"
                                }`}
                              >
                                {result.vep.revel > 0.5 ? "致病性" : "良性"}
                              </td>
                              <td className="py-2">
                                {result.vep.revel.toFixed(4)}
                              </td>
                            </tr>
                          )}
                          {result.vep.spliceai &&
                            Object.values(result.vep.spliceai).some(
                              (v) => v != null && v > 0
                            ) && (
                              <tr>
                                <td className="py-2 pr-4 font-medium">
                                  SpliceAI
                                </td>
                                <td
                                  className={`py-2 pr-4 font-medium ${
                                    Math.max(
                                      result.vep.spliceai.DS_AG ?? 0,
                                      result.vep.spliceai.DS_AL ?? 0,
                                      result.vep.spliceai.DS_DG ?? 0,
                                      result.vep.spliceai.DS_DL ?? 0
                                    ) >= 0.5
                                      ? "text-red-600"
                                      : "text-orange-600"
                                  }`}
                                >
                                  {Math.max(
                                    result.vep.spliceai.DS_AG ?? 0,
                                    result.vep.spliceai.DS_AL ?? 0,
                                    result.vep.spliceai.DS_DG ?? 0,
                                    result.vep.spliceai.DS_DL ?? 0
                                  ) >= 0.5
                                    ? "强剪接影响"
                                    : "中等剪接影响"}
                                </td>
                                <td className="py-2 text-xs">
                                  AG:{result.vep.spliceai.DS_AG ?? "—"}{" "}
                                  AL:{result.vep.spliceai.DS_AL ?? "—"}{" "}
                                  DG:{result.vep.spliceai.DS_DG ?? "—"}{" "}
                                  DL:{result.vep.spliceai.DS_DL ?? "—"}
                                </td>
                              </tr>
                            )}
                          {result.eve?.score != null && (
                            <tr>
                              <td className="py-2 pr-4 font-medium">EVE</td>
                              <td
                                className={`py-2 pr-4 font-medium ${
                                  result.eve.score > 0.5
                                    ? "text-red-600"
                                    : "text-green-600"
                                }`}
                              >
                                {result.eve.score > 0.5 ? "致病性" : "良性"}
                              </td>
                              <td className="py-2">
                                {result.eve.score.toFixed(4)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {result.constraint.pli != null && (
                      <div className="bg-slate-50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold mb-2 text-slate-700">
                          gnomAD 基因约束
                        </h4>
                        <div className="grid grid-cols-3 gap-4 text-center text-sm">
                          <div>
                            <p className="text-xs text-slate-500">pLI</p>
                            <p
                              className={`font-bold ${
                                (result.constraint.pli ?? 0) > 0.9
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {result.constraint.pli?.toFixed(3) ?? "N/A"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">LOEUF</p>
                            <p className="font-bold">
                              {result.constraint.oe_lof_upper?.toFixed(3) ??
                                "N/A"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">mis-OEUF</p>
                            <p className="font-bold">
                              {result.constraint.oe_mis_upper?.toFixed(3) ??
                                "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Population */}
              <TabsContent value="population">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="w-4 h-4 text-blue-600" />
                      人群频率
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {result.gnomad.error ? (
                      <div className="flex items-center gap-2 text-amber-600 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        {result.gnomad.error}
                      </div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 pr-4 font-medium text-slate-600">
                                来源
                              </th>
                              <th className="text-left py-2 pr-4 font-medium text-slate-600">
                                AC
                              </th>
                              <th className="text-left py-2 pr-4 font-medium text-slate-600">
                                AN
                              </th>
                              <th className="text-left py-2 font-medium text-slate-600">
                                AF
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(
                              [
                                ["exome", "外显子组"],
                                ["genome", "全基因组"],
                              ] as const
                            ).map(([source, label]) => {
                              const g = result.gnomad[source];
                              if (!g || typeof g !== "object") return null;
                              return (
                                <tr key={source}>
                                  <td className="py-2 pr-4 font-medium">
                                    gnomAD {label}
                                  </td>
                                  <td className="py-2 pr-4">
                                    {g.ac ?? "—"}
                                  </td>
                                  <td className="py-2 pr-4">
                                    {g.an ?? "—"}
                                  </td>
                                  <td className="py-2">
                                    {g.af != null ? (
                                      <span
                                        className={`font-medium ${
                                          g.af > 0.01
                                            ? "text-green-600"
                                            : g.af < 1e-5
                                            ? "text-red-600"
                                            : ""
                                        }`}
                                      >
                                        {g.af.toExponential(2)}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {result.vep.gnomad_frequencies &&
                      Object.keys(result.vep.gnomad_frequencies).length > 0 && (
                        <div className="bg-slate-50 rounded-lg p-4">
                          <h4 className="text-sm font-semibold mb-2 text-slate-700">
                            VEP 频率
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            {Object.entries(result.vep.gnomad_frequencies).map(
                              ([k, v]) => (
                                <div
                                  key={k}
                                  className="bg-white rounded px-2 py-1"
                                >
                                  <span className="text-slate-500">{k}: </span>
                                  <span className="font-medium">
                                    {v.toExponential(2)}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    {result.vep.gtex_expression &&
                      Object.keys(result.vep.gtex_expression).length > 0 && (
                        <div className="bg-slate-50 rounded-lg p-4">
                          <h4 className="text-sm font-semibold mb-2 text-slate-700">
                            GTEx 组织表达 (TPM)
                          </h4>
                          <div className="overflow-auto max-h-64">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1 pr-4">组织</th>
                                  <th className="text-left py-1">TPM</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {Object.entries(result.vep.gtex_expression)
                                  .sort((a, b) => b[1] - a[1])
                                  .map(([tissue, tpm]) => (
                                    <tr key={tissue}>
                                      <td className="py-1 pr-4">{tissue}</td>
                                      <td className="py-1 font-medium">
                                        {tpm.toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ClinVar */}
              <TabsContent value="clinvar">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-600" />
                      ClinVar 注释
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {result.clinvar.error ? (
                      <div className="flex items-center gap-2 text-amber-600 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        {result.clinvar.error}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <InfoRow
                            label="Accession"
                            value={result.clinvar.accession}
                          />
                          <InfoRow
                            label="临床意义"
                            value={
                              CLINVAR_CLASS_MAP[
                                result.clinvar.classification ?? ""
                              ] ?? result.clinvar.classification
                            }
                            highlight
                          />
                          <InfoRow
                            label="审核状态"
                            value={result.clinvar.review_status}
                          />
                          <InfoRow
                            label="数据来源"
                            value={result.clinvar.source}
                          />
                        </div>
                        {result.clinvar.traits &&
                          result.clinvar.traits.length > 0 && (
                            <div className="mt-3">
                              <p className="text-sm font-medium text-slate-700 mb-1">
                                关联表型
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {result.clinvar.traits.map((t, i) => (
                                  <Badge
                                    key={i}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Protein — with Chinese feature types */}
              <TabsContent value="protein">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Dna className="w-4 h-4 text-blue-600" />
                      UniProt 蛋白信息
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {result.uniprot.error && !result.uniprot.function ? (
                      <div className="flex items-center gap-2 text-amber-600 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        {result.uniprot.error}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <InfoRow
                            label="UniProt 编号"
                            value={result.uniprot.accession}
                          />
                          <InfoRow
                            label="蛋白名称"
                            value={result.uniprot.protein_name}
                          />
                          <InfoRow
                            label="蛋白长度"
                            value={
                              result.uniprot.protein_length
                                ? `${result.uniprot.protein_length} 个氨基酸`
                                : undefined
                            }
                          />
                          <InfoRow
                            label="数据来源"
                            value={
                              result.uniprot.source === "uniprot_api"
                                ? "UniProt API"
                                : result.uniprot.source
                            }
                          />
                        </div>
                        {result.uniprot.function && (
                          <div className="mt-3 bg-slate-50 rounded-lg p-3">
                            <p className="text-sm font-semibold text-slate-700 mb-1">
                              功能描述
                            </p>
                            <p className="text-sm text-slate-600 leading-relaxed">
                              {result.uniprot.function}
                            </p>
                            <p className="text-xs text-slate-400 mt-2 italic">
                              （原文来自 UniProt，英文）
                            </p>
                          </div>
                        )}
                        {result.uniprot.features_near_variant &&
                          result.uniprot.features_near_variant.length > 0 && (
                            <div className="mt-3">
                              <p className="text-sm font-semibold text-slate-700 mb-2">
                                变异附近的蛋白结构特征
                              </p>
                              <div className="space-y-1">
                                {result.uniprot.features_near_variant.map(
                                  (f, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-2 text-sm"
                                    >
                                      <Badge
                                        variant="secondary"
                                        className="text-xs shrink-0"
                                      >
                                        {FEATURE_TYPE_MAP[f.type] ?? f.type}
                                      </Badge>
                                      <span className="text-slate-600">
                                        {f.description}
                                      </span>
                                      <span className="text-xs text-slate-400 shrink-0">
                                        [{f.start}-{f.end}]
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Literature */}
              <TabsContent value="literature">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-blue-600" />
                      文献检索
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Info className="w-4 h-4" />
                      <span>检索式: {result.literature.query}</span>
                    </div>
                    <p className="text-sm text-slate-600">
                      命中 <strong>{result.literature.count}</strong> 条文献
                    </p>
                    {result.literature.articles.length > 0 ? (
                      <div className="space-y-3">
                        {result.literature.articles.map((a, i) => (
                          <div
                            key={i}
                            className="border rounded-lg p-3 hover:bg-slate-50 transition-colors"
                          >
                            <p className="text-sm font-medium text-slate-800">
                              {a.title ?? "(无标题)"}
                            </p>
                            <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-slate-500">
                              {a.authors && <span>{a.authors}</span>}
                              {a.journal && <span>{a.journal}</span>}
                              {a.year && <span>({a.year})</span>}
                              {a.pmid && (
                                <span className="text-blue-600">
                                  PMID:{a.pmid}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">
                        未找到该位点特异性文献
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ACMG Evidence */}
              <TabsContent value="acmg">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-600" />
                      ACMG 证据加权分类
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xs text-slate-500">最终分类</p>
                        <div className="mt-1">
                          {getClassBadge(result.acmg.classification)}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">致病分值</p>
                        <p className="text-lg font-bold text-red-600">
                          {result.acmg.pathogenic_score}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">良性分值</p>
                        <p className="text-lg font-bold text-green-600">
                          {result.acmg.benign_score}
                        </p>
                      </div>
                    </div>

                    {result.acmg.evidence_items.length > 0 ? (
                      <div className="overflow-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 pr-4 font-medium text-slate-600">
                                规则
                              </th>
                              <th className="text-left py-2 pr-4 font-medium text-slate-600">
                                强度
                              </th>
                              <th className="text-left py-2 font-medium text-slate-600">
                                描述
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {result.acmg.evidence_items.map((e, i) => (
                              <tr key={i}>
                                <td className="py-2 pr-4 font-mono font-medium text-slate-800">
                                  {e.criterion}
                                </td>
                                <td className="py-2 pr-4">
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${
                                      e.strength === "Very Strong" ||
                                      e.strength === "Stand-alone"
                                        ? "border-red-400 text-red-600"
                                        : e.strength === "Strong"
                                        ? "border-orange-400 text-orange-600"
                                        : e.strength === "Moderate"
                                        ? "border-yellow-400 text-yellow-600"
                                        : "border-slate-300 text-slate-500"
                                    }`}
                                  >
                                    {STRENGTH_MAP[e.strength] ?? e.strength}
                                  </Badge>
                                </td>
                                <td className="py-2 text-xs text-slate-600">
                                  {e.description}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">
                        无触发任何 ACMG 证据规则
                      </p>
                    )}

                    {/* LOF warning */}
                    {result.acmg.pathogenic_score >= 6 &&
                      (result.vep.consequence_terms ?? []).some((c) =>
                        [
                          "stop_gained",
                          "frameshift_variant",
                          "splice_donor_variant",
                          "splice_acceptor_variant",
                          "start_lost",
                        ].includes(c)
                      ) &&
                      (result.constraint.pli ?? 0) > 0.9 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <p className="text-sm text-red-700">
                            该变异为<strong>功能丧失 (LOF)</strong>
                            变异，位于 LOF-不耐受基因中 (pLI &gt; 0.9)。
                          </p>
                        </div>
                      )}

                    {/* Splice warning */}
                    {result.vep.spliceai &&
                      Math.max(
                        result.vep.spliceai.DS_AG ?? 0,
                        result.vep.spliceai.DS_AL ?? 0,
                        result.vep.spliceai.DS_DG ?? 0,
                        result.vep.spliceai.DS_DL ?? 0
                      ) >= 0.2 && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                          <p className="text-sm text-orange-700">
                            SpliceAI
                            预测该变异可能影响mRNA剪接。建议通过RNA分析验证。
                          </p>
                        </div>
                      )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Markdown Report */}
              <TabsContent value="markdown">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ScrollText className="w-4 h-4 text-blue-600" />
                      完整报告 (Markdown)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-slate-50 rounded-lg p-4 overflow-auto max-h-[600px]">
                      <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-slate-700">
                        {result.markdown}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-slate-400 pt-8 pb-4">
          <p>GRCh38 Variant Impact Analyzer · ACMG-AMP 2015</p>
          <p className="mt-1">本报告仅供研究参考，不可作为临床诊断依据</p>
        </footer>
      </main>
    </div>
  );
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value?: string | null;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`text-sm font-medium ${
          highlight ? "text-red-600" : "text-slate-800"
        }`}
      >
        {value ?? "N/A"}
      </p>
    </div>
  );
}
