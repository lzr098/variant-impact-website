/**
 * Protein function description translation.
 * Primary: LLM (OpenAI-compatible API) for full-text translation.
 * Fallback: small curated dictionary with proper regex escaping + word boundaries.
 */

// ponytail: read env at call time (not module load) so tests can override
function getLlmConfig() {
  return {
    endpoint: process.env.LLM_ENDPOINT || "https://api.openai.com/v1/chat/completions",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  };
}

// ponytail: small curated dict — only terms that actually appear in UniProt FUNCTION descriptions.
// The old 2000-entry dict was mostly junk ("good bartonella quintana infection study practice" etc.)
const FUNCTION_DICT: Record<string, string> = {
  // DNA repair
  "double-strand break repair": "双链断裂修复",
  "single-strand break": "单链断裂",
  "mismatch repair": "错配修复",
  "base excision repair": "碱基切除修复",
  "nucleotide excision repair": "核苷酸切除修复",
  "homologous recombination": "同源重组",
  "non-homologous end joining": "非同源末端连接",
  "dna repair": "DNA 修复",
  "dna damage response": "DNA 损伤应答",
  "dna replication": "DNA 复制",
  // Cell cycle / signaling
  "cell cycle checkpoint": "细胞周期检查点",
  "cell cycle arrest": "细胞周期阻滞",
  "cell cycle regulation": "细胞周期调控",
  "signal transduction": "信号转导",
  "transcriptional regulation": "转录调控",
  "transcription factor": "转录因子",
  "tumor suppressor": "肿瘤抑制因子",
  "tumor suppression": "肿瘤抑制",
  // Protein modifications
  "post-translational modification": "翻译后修饰",
  "protein phosphorylation": "蛋白磷酸化",
  "protein ubiquitination": "蛋白泛素化",
  "protein degradation": "蛋白降解",
  "proteasomal degradation": "蛋白酶体降解",
  // Cell processes
  "apoptotic process": "凋亡过程",
  "programmed cell death": "程序性细胞死亡",
  "cell proliferation": "细胞增殖",
  "cell differentiation": "细胞分化",
  "cell migration": "细胞迁移",
  "cell adhesion": "细胞粘附",
  "autophagy": "自噬",
  // Common verb phrases
  "plays a role in": "在...中发挥作用",
  "plays a critical role in": "在...中发挥关键作用",
  "plays an important role in": "在...中发挥重要作用",
  "is involved in": "参与",
  "is required for": "对...是必需的",
  "is essential for": "对...是必需的",
  "acts as a": "作为",
  "acts as": "作为",
  "required for": "为...所必需",
  // Enzyme activities
  "kinase activity": "激酶活性",
  "catalytic activity": "催化活性",
  "dna binding": "DNA 结合",
  "atp binding": "ATP 结合",
  "metal ion binding": "金属离子结合",
};

// ponytail: protein name dict — short, standardized terms
const PROTEIN_NAME_DICT: Record<string, string> = {
  "ubiquitin carboxyl-terminal hydrolase": "泛素羧基末端水解酶",
  "e3 ubiquitin-protein ligase": "E3 泛素蛋白连接酶",
  "tyrosine kinase": "酪氨酸激酶",
  "serine/threonine-protein kinase": "丝氨酸/苏氨酸蛋白激酶",
  "growth factor receptor": "生长因子受体",
  "tumor suppressor": "肿瘤抑制因子",
  "dna repair protein": "DNA 修复蛋白",
  "transcription factor": "转录因子",
  "zinc finger protein": "锌指蛋白",
  "g protein-coupled receptor": "G 蛋白偶联受体",
  "dehydrogenase": "脱氢酶",
  "protease": "蛋白酶",
  "phosphatase": "磷酸酶",
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translateByDict(text: string, dict: Record<string, string>): string | undefined {
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  let result = text;
  let changed = false;
  for (const key of sortedKeys) {
    const re = new RegExp(`\\b${escapeRegex(key)}\\b`, "gi");
    const before = result;
    result = result.replace(re, dict[key]!);
    if (result !== before) changed = true;
  }
  return changed ? result : undefined;
}

async function llmTranslate(text: string): Promise<string | undefined> {
  const { endpoint, apiKey, model } = getLlmConfig();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是遗传学翻译专家。将以下蛋白质功能描述从英文翻译成中文。" +
            "保留所有基因符号、蛋白质缩写、数据库标识符（如 UniProt、PDB、HGNC）的英文原文。" +
            "翻译要准确、专业、符合中文遗传学表述习惯。只输出译文，不要解释。",
        },
        { role: "user", content: text },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : undefined;
}

/** Translate UniProt FUNCTION description. LLM primary, dict fallback. */
export async function translateFunction(func: string | undefined): Promise<string | undefined> {
  if (!func || func.length < 10) return undefined;

  const { apiKey, endpoint } = getLlmConfig();
  if (apiKey || endpoint !== "https://api.openai.com/v1/chat/completions") {
    try {
      const translated = await llmTranslate(func);
      if (translated) return translated;
    } catch (err) {
      console.error("[translation] LLM failed, falling back to dictionary:", err instanceof Error ? err.message : err);
    }
  }

  return translateByDict(func, FUNCTION_DICT);
}

/** Translate protein name. Dict-only (short, standardized, no API call needed). */
export function translateProteinName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return translateByDict(name, PROTEIN_NAME_DICT);
}
