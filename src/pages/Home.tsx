import { useState, useCallback } from "react";
import type { FullResult } from "@contracts/variant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Search, Dna, FileText, Database, BookOpen,
  Activity, Beaker, ScrollText, CheckCircle2, XCircle,
  AlertTriangle, Info, Sparkles, Shield, Microscope,
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

const FEATURE_TYPE_MAP: Record<string, string> = {
  Chain: "成熟肽链",
  Domain: "结构域",
  "DNA-binding region": "DNA结合区",
  Region: "功能区域",
  "Binding site": "结合位点",
  "Active site": "活性位点",
  "Modified residue": "修饰残基",
  "Disulfide bond": "二硫键",
  "Transit peptide": "转运肽",
  "Signal peptide": "信号肽",
  "Transmembrane region": "跨膜区",
  Repeat: "重复序列",
  Motif: "基序",
};

function formatConsequence(terms: string[] | undefined): string {
  if (!terms || terms.length === 0) return "N/A";
  return terms.slice(0, 3).map((t) => CONSEQ_MAP[t] || t).join(" / ");
}

function getProteinDisplay(
  protein: string | undefined,
  aminoAcids: string | undefined,
  proteinStart: number | undefined
): string {
  if (protein) return protein;
  if (aminoAcids && proteinStart) {
    const parts = aminoAcids.split("/");
    if (parts.length === 2) return `p.${parts[0]}${proteinStart}${parts[1]} (推断)`;
  }
  if (aminoAcids) return aminoAcids;
  return "N/A";
}

function getClassBadge(cls: string) {
  const colorClass = ACMG_CLASS_COLORS[cls] ?? "bg-gray-400 text-white";
  const label = ACMG_CLASS_MAP[cls] ?? cls;
  return <Badge className={`${colorClass} text-sm px-3 py-1 font-semibold`}>{label}</Badge>;
}

function InfoRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-medium ${highlight ? "text-red-600" : "text-slate-800"}`}>{value ?? "N/A"}</p>
    </div>
  );
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
  const [result, setResult] = useState<FullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const v = variantInput.trim();
    if (!v) return;

    setIsPending(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: v, options }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data as FullResult);
      } else {
        setError(data.error || "分析失败");
      }
    } catch (err: any) {
      setError(err?.message || "网络错误");
    } finally {
      setIsPending(false);
    }
  }, [variantInput, options]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Dna className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">GRCh38 变异功能影响分析器</h1>
            <p className="text-xs text-slate-500">ACMG 证据权重分类 · 整合多数据源</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Input */}
        <Card className="shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" /> 输入变异
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={variantInput}
                  onChange={(e) => setVariantInput(e.target.value)}
                  placeholder="输入变异: chr:pos:ref:alt / HGVS / rsID / NM_:c. / VCF tab"
                  className="flex-1 font-mono text-sm"
                />
                <Button type="submit" disabled={isPending || !variantInput.trim()} className="min-w-[100px]">
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4 mr-1" /> 分析</>}
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                {[
                  ["gnomad", "gnomad", "gnomAD 频率"],
                  ["clinvar", "clinvar", "ClinVar"],
                  ["lit", "includeLiterature", "文献检索"],
                  ["eve", "includeEve", "EVE 模型"],
                  ["pm3", "secondVariantPathogenic", "对侧已知致病 (PM3)"],
                ].map(([id, key, label]) => (
                  <div key={id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={options[key as keyof typeof options]}
                      onCheckedChange={(v) => setOptions((o) => ({ ...o, [key]: v === true }))}
                    />
                    <Label htmlFor={id} className="text-xs cursor-pointer">{label}</Label>
                  </div>
                ))}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Loading */}
        {isPending && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <p className="text-sm text-blue-700">分析中，请稍候（约 10-15 秒）...</p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-300 bg-red-50 shadow-sm">
            <CardContent className="pt-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div><p className="font-medium text-red-800">分析失败</p><p className="text-sm text-red-700 mt-1">{error}</p></div>
            </CardContent>
          </Card>
        )}

        {/* Result summary */}
        {result && (
          <Card className="shadow-md border-l-4 border-l-blue-500">
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-slate-500">输入: {result.variant.raw}</p>
                  <p className="font-mono text-lg font-semibold text-slate-900">{result.variant.hgvs_g}</p>
                  {result.variant.rsid && <Badge variant="outline" className="text-xs">{result.variant.rsid}</Badge>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-sm text-slate-500 mb-1">ACMG 分类</div>
                  {getClassBadge(result.acmg.classification)}
                </div>
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div><p className="text-xs text-slate-500">基因</p><p className="font-semibold text-slate-800">{result.vep.gene_symbol ?? "N/A"}</p></div>
                <div><p className="text-xs text-slate-500">转录本</p><p className="font-semibold text-slate-800 text-xs truncate">{result.vep.transcript ?? "N/A"}</p></div>
                <div><p className="text-xs text-slate-500">蛋白变异</p><p className="font-semibold text-slate-800 text-xs">{getProteinDisplay(result.vep.protein, result.vep.amino_acids, result.vep.protein_start)}</p></div>
                <div><p className="text-xs text-slate-500">变异后果</p><p className="font-semibold text-slate-800 text-xs">{formatConsequence(result.vep.consequence_terms)}</p></div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-red-600 font-medium">致病分值: {result.acmg.pathogenic_score}</span>
                    <span className="text-green-600 font-medium">良性分值: {result.acmg.benign_score}</span>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden flex">
                    <div className="bg-red-500 h-full transition-all" style={{ width: `${Math.min((result.acmg.pathogenic_score / 10) * 50, 50)}%` }} />
                    <div className="w-px bg-white" />
                    <div className="bg-green-500 h-full transition-all" style={{ width: `${Math.min((result.acmg.benign_score / 8) * 50, 50)}%` }} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Detail Tabs */}
        {result && (
          <Tabs defaultValue="predictions" className="space-y-4">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="predictions"><Beaker className="w-3.5 h-3.5 mr-1" /> 功能预测</TabsTrigger>
              <TabsTrigger value="population"><Database className="w-3.5 h-3.5 mr-1" /> 人群频率</TabsTrigger>
              <TabsTrigger value="clinvar"><Activity className="w-3.5 h-3.5 mr-1" /> ClinVar</TabsTrigger>
              <TabsTrigger value="protein"><Dna className="w-3.5 h-3.5 mr-1" /> 蛋白信息</TabsTrigger>
              <TabsTrigger value="literature"><BookOpen className="w-3.5 h-3.5 mr-1" /> 文献</TabsTrigger>
              <TabsTrigger value="acmg"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> ACMG证据</TabsTrigger>
              <TabsTrigger value="markdown"><FileText className="w-3.5 h-3.5 mr-1" /> 报告</TabsTrigger>
            </TabsList>

            {/* Predictions */}
            <TabsContent value="predictions">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Beaker className="w-4 h-4 text-blue-600" /> 功能预测 (VEP)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b"><th className="text-left py-2 pr-4 font-medium text-slate-600">工具</th><th className="text-left py-2 pr-4 font-medium text-slate-600">预测</th><th className="text-left py-2 font-medium text-slate-600">分值</th></tr></thead>
                    <tbody className="divide-y">
                      <tr><td className="py-2 pr-4 font-medium">SIFT</td><td className="py-2 pr-4">{result.vep.sift?.prediction ?? "N/A"}</td><td className="py-2">{result.vep.sift?.score?.toFixed(3) ?? "N/A"}</td></tr>
                      <tr><td className="py-2 pr-4 font-medium">PolyPhen</td><td className="py-2 pr-4">{result.vep.polyphen?.prediction ?? "N/A"}</td><td className="py-2">{result.vep.polyphen?.score?.toFixed(3) ?? "N/A"}</td></tr>
                      <tr><td className="py-2 pr-4 font-medium">AlphaMissense</td><td className="py-2 pr-4">{result.vep.alphamissense?.class ?? "N/A"}</td><td className="py-2">{result.vep.alphamissense?.pathogenicity?.toFixed(3) ?? "N/A"}</td></tr>
                      <tr><td className="py-2 pr-4 font-medium">CADD phred</td><td className="py-2 pr-4">—</td><td className={`py-2 font-medium ${(result.vep.cadd_phred ?? 0) >= 25 ? "text-red-600" : ""}`}>{result.vep.cadd_phred ?? "N/A"}</td></tr>
                      {result.vep.revel != null && <tr><td className="py-2 pr-4 font-medium">REVEL</td><td className={`py-2 pr-4 font-medium ${result.vep.revel > 0.5 ? "text-red-600" : "text-green-600"}`}>{result.vep.revel > 0.5 ? "致病性" : "良性"}</td><td className="py-2">{result.vep.revel.toFixed(4)}</td></tr>}
                      {result.eve?.score != null && <tr><td className="py-2 pr-4 font-medium">EVE</td><td className={`py-2 pr-4 font-medium ${result.eve.score > 0.5 ? "text-red-600" : "text-green-600"}`}>{result.eve.score > 0.5 ? "致病性" : "良性"}</td><td className="py-2">{result.eve.score.toFixed(4)}</td></tr>}
                    </tbody>
                  </table>
                  {result.constraint.pli != null && (
                    <div className="bg-slate-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold mb-2 text-slate-700">gnomAD 基因约束</h4>
                      <div className="grid grid-cols-3 gap-4 text-center text-sm">
                        <div><p className="text-xs text-slate-500">pLI</p><p className={`font-bold ${(result.constraint.pli ?? 0) > 0.9 ? "text-red-600" : ""}`}>{result.constraint.pli?.toFixed(3) ?? "N/A"}</p></div>
                        <div><p className="text-xs text-slate-500">LOEUF</p><p className="font-bold">{result.constraint.oe_lof_upper?.toFixed(3) ?? "N/A"}</p></div>
                        <div><p className="text-xs text-slate-500">mis-OEUF</p><p className="font-bold">{result.constraint.oe_mis_upper?.toFixed(3) ?? "N/A"}</p></div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Population */}
            <TabsContent value="population">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4 text-blue-600" /> 人群频率</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {result.gnomad.error ? (
                    <div className="flex items-center gap-2 text-amber-600 text-sm"><AlertTriangle className="w-4 h-4" />{result.gnomad.error}</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b"><th className="text-left py-2 pr-4 font-medium text-slate-600">来源</th><th className="text-left py-2 pr-4 font-medium text-slate-600">AC</th><th className="text-left py-2 pr-4 font-medium text-slate-600">AN</th><th className="text-left py-2 font-medium text-slate-600">AF</th></tr></thead>
                      <tbody className="divide-y">
                        {([["exome", "外显子组"], ["genome", "全基因组"]] as const).map(([src, label]) => {
                          const g = result.gnomad[src];
                          if (!g || typeof g !== "object") return null;
                          return <tr key={src}><td className="py-2 pr-4 font-medium">gnomAD {label}</td><td className="py-2 pr-4">{g.ac ?? "—"}</td><td className="py-2 pr-4">{g.an ?? "—"}</td><td className="py-2">{g.af != null ? <span className={`font-medium ${g.af > 0.01 ? "text-green-600" : g.af < 1e-5 ? "text-red-600" : ""}`}>{g.af.toExponential(2)}</span> : "—"}</td></tr>;
                        })}
                      </tbody>
                    </table>
                  )}
                  {result.vep.gnomad_frequencies && Object.keys(result.vep.gnomad_frequencies).length > 0 && (
                    <div className="bg-slate-50 rounded-lg p-4">
                      <h4 className="text-sm font-semibold mb-2 text-slate-700">VEP 频率</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {Object.entries(result.vep.gnomad_frequencies).map(([k, v]) => <div key={k} className="bg-white rounded px-2 py-1"><span className="text-slate-500">{k}: </span><span className="font-medium">{v.toExponential(2)}</span></div>)}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ClinVar */}
            <TabsContent value="clinvar">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" /> ClinVar 注释</CardTitle></CardHeader>
                <CardContent>
                  {result.clinvar.error ? (
                    <div className="flex items-center gap-2 text-amber-600 text-sm"><AlertTriangle className="w-4 h-4" />{result.clinvar.error}</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InfoRow label="Accession" value={result.clinvar.accession} />
                        <InfoRow label="临床意义" value={CLINVAR_CLASS_MAP[result.clinvar.classification ?? ""] ?? result.clinvar.classification} highlight />
                        <InfoRow label="审核状态" value={result.clinvar.review_status} />
                        <InfoRow label="数据来源" value={result.clinvar.source} />
                      </div>
                      {result.clinvar.traits && result.clinvar.traits.length > 0 && (
                        <div className="mt-3"><p className="text-sm font-medium text-slate-700 mb-1">关联表型</p><div className="flex flex-wrap gap-1">{result.clinvar.traits.map((t, i) => <Badge key={i} variant="outline" className="text-xs">{t}</Badge>)}</div></div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Protein */}
            <TabsContent value="protein">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Dna className="w-4 h-4 text-blue-600" /> UniProt 蛋白信息</CardTitle></CardHeader>
                <CardContent>
                  {result.uniprot.error && !result.uniprot.function ? (
                    <div className="flex items-center gap-2 text-amber-600 text-sm"><AlertTriangle className="w-4 h-4" />{result.uniprot.error}</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InfoRow label="UniProt 编号" value={result.uniprot.accession} />
                        <InfoRow label="蛋白名称" value={result.uniprot.protein_name_cn ? `${result.uniprot.protein_name}（${result.uniprot.protein_name_cn}）` : result.uniprot.protein_name} />
                        <InfoRow label="蛋白长度" value={result.uniprot.protein_length ? `${result.uniprot.protein_length} 个氨基酸` : undefined} />
                        <InfoRow label="数据来源" value={result.uniprot.source === "uniprot_api" ? "UniProt API" : result.uniprot.source} />
                      </div>
                      {result.uniprot.function_summary_cn && (
                        <div className="mt-3 bg-slate-50 rounded-lg p-3">
                          <p className="text-sm font-semibold text-slate-700 mb-1">功能描述</p>
                          <p className="text-sm text-slate-700 leading-relaxed">{result.uniprot.function_summary_cn}</p>
                          <p className="text-xs text-slate-500 mt-2 italic border-t border-slate-200 pt-2">英文原文：{result.uniprot.function}</p>
                        </div>
                      )}
                      {result.uniprot.features_near_variant && result.uniprot.features_near_variant.length > 0 && (
                        <div className="mt-3"><p className="text-sm font-semibold text-slate-700 mb-2">变异附近的蛋白结构特征</p><div className="space-y-1">{result.uniprot.features_near_variant.map((f, i) => <div key={i} className="flex items-center gap-2 text-sm"><Badge variant="secondary" className="text-xs shrink-0">{FEATURE_TYPE_MAP[f.type] ?? f.type}</Badge><span className="text-slate-600">{f.description}</span><span className="text-xs text-slate-400 shrink-0">[{f.start}-{f.end}]</span></div>)}</div></div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Literature */}
            <TabsContent value="literature">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="w-4 h-4 text-blue-600" /> 文献检索</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Info className="w-4 h-4" /><span>检索式: {result.literature.query}</span></div>
                  <p className="text-sm text-slate-600">命中 <strong>{result.literature.count}</strong> 条文献</p>
                  {result.literature.articles.length > 0 ? (
                    <div className="space-y-3">{result.literature.articles.map((a, i) => <div key={i} className="border rounded-lg p-3 hover:bg-slate-50 transition-colors"><p className="text-sm font-medium text-slate-800">{a.title ?? "(无标题)"}</p><div className="flex flex-wrap gap-x-3 mt-1 text-xs text-slate-500">{a.authors && <span>{a.authors}</span>}{a.journal && <span>{a.journal}</span>}{a.year && <span>({a.year})</span>}{a.pmid && <span className="text-blue-600">PMID:{a.pmid}</span>}</div></div>)}</div>
                  ) : <p className="text-sm text-slate-400">未找到该位点特异性文献</p>}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ACMG */}
            <TabsContent value="acmg">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-600" /> ACMG 证据加权分类</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div><p className="text-xs text-slate-500">最终分类</p><div className="mt-1">{getClassBadge(result.acmg.classification)}</div></div>
                    <div><p className="text-xs text-slate-500">致病分值</p><p className="text-lg font-bold text-red-600">{result.acmg.pathogenic_score}</p></div>
                    <div><p className="text-xs text-slate-500">良性分值</p><p className="text-lg font-bold text-green-600">{result.acmg.benign_score}</p></div>
                  </div>
                  {result.acmg.evidence_items.length > 0 ? (
                    <table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2 pr-4 font-medium text-slate-600">规则</th><th className="text-left py-2 pr-4 font-medium text-slate-600">强度</th><th className="text-left py-2 font-medium text-slate-600">描述</th></tr></thead><tbody className="divide-y">{result.acmg.evidence_items.map((e, i) => <tr key={i}><td className="py-2 pr-4 font-mono font-medium text-slate-800">{e.criterion}</td><td className="py-2 pr-4"><Badge variant="outline" className={`text-xs ${e.strength === "Very Strong" || e.strength === "Stand-alone" ? "border-red-400 text-red-600" : e.strength === "Strong" ? "border-orange-400 text-orange-600" : e.strength === "Moderate" ? "border-yellow-400 text-yellow-600" : "border-slate-300 text-slate-500"}`}>{STRENGTH_MAP[e.strength] ?? e.strength}</Badge></td><td className="py-2 text-xs text-slate-600">{e.description}</td></tr>)}</tbody></table>
                  ) : <p className="text-sm text-slate-400">无触发任何 ACMG 证据规则</p>}
                  {result.acmg.pathogenic_score >= 6 && (result.vep.consequence_terms ?? []).some((c) => ["stop_gained", "frameshift_variant", "splice_donor_variant", "splice_acceptor_variant", "start_lost"].includes(c)) && (result.constraint.pli ?? 0) > 0.9 && <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" /><p className="text-sm text-red-700">该变异为<strong>功能丧失 (LOF)</strong>变异，位于 LOF-不耐受基因中 (pLI &gt; 0.9)。</p></div>}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Markdown */}
            <TabsContent value="markdown">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><ScrollText className="w-4 h-4 text-blue-600" /> 完整报告 (Markdown)</CardTitle></CardHeader>
                <CardContent><div className="bg-slate-50 rounded-lg p-4 overflow-auto max-h-[600px]"><pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-slate-700">{result.markdown}</pre></div></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
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
