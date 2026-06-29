# Variant Impact Analyzer

> 基于 React + TypeScript + Express 的基因组变异单变异分析可视化平台，支持 Ensembl VEP 实时查询、AlphaMissense/CADD/SpliceAI 多维度预测、ClinVar 与 GTEx 数据集成，并自动生成 ACMG 证据分类与临床报告。

## 项目简介

Variant Impact Analyzer 是一个**面向临床遗传学**的基因组变异分析工具，提供：

- 🔬 **单变异查询**：支持 HGVS、g. 坐标、rsID、VCF 格式及多种自由格式输入
- 🧬 **多维注释**：整合 Ensembl VEP、AlphaMissense、CADD phred、SpliceAI、REVEL、PolyPhen-2、SIFT 等
- 📊 **ACMG 自动分级**：基于 VEP 结果自动生成 ACMG 证据链（PP/BP/PM/PVS/BA 等）
- 🏥 **ClinVar 集成**：实时查询 ClinVar 分类、评审星级、关联表型
- 🧪 **GTEx 表达谱**：组织特异性基因表达水平参考
- 📝 **报告生成**：自动生成 Markdown + JSON 结构化报告，支持中文翻译
- 🐋 **Docker 部署**：一键 `docker-compose up` 启动，支持私有化本地部署

## 支持的功能

| 功能 | 状态 | 说明 |
|------|------|------|
| SNV / 小 Indel | ✅ | 核心场景，完整支持 |
| 多碱基缺失（Deletion） | ✅ | 支持 `del` HGVS 格式和 VCF 风格自动解析 |
| 多碱基插入（Insertion） | ✅ | 支持 `ins` HGVS 格式和 VCF 风格自动解析 |
| rsID 解析 | ✅ | 自动通过 Ensembl 转换为基因组坐标 |
| NM_:c. 转录本输入 | ✅ | 支持编码区 HGVS 输入 |
| 结构变异（SV） | ⚠️ | 当前版本依赖 VEP 的 `/hgvs` 端点，大范围 SV 可能不支持 |

### 输入格式示例

```
# 标准基因组坐标（SNV）
chr13:32363294:G:A

# HGVS 风格
c.524G>A
7:g.117559592_117559594delTTT
chr12:25245350:C>T

# rsID
rs113993960

# VCF 风格缺失（系统自动转换为 HGVS）
chr7:117559591:CTTT:C

# VCF 风格插入（系统自动转换为 HGVS）
chr7:117559591:C:CTTTT
```

## 环境要求

- **Node.js** >= 20（推荐 v20.x）
- **Docker** + **Docker Compose**（推荐用于部署）
- **操作系统**：macOS / Linux / Windows (WSL2)
- **网络**：能访问 `rest.ensembl.org`（Ensembl VEP REST API）

> ⚠️ **注意**：本项目不需要本地 VEP 安装或 ClinVar 数据库，所有注释通过 Ensembl REST API 实时获取。若需要离线模式，请使用配套的 [grch38-variant-impact CLI 工具](https://github.com/lzr098/variant-impact)。

## 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 1. Clone 仓库
git clone https://github.com/lzr098/variant-impact-website.git
cd variant-impact-website

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入可选配置（LLM 翻译等）

# 3. 启动服务
docker-compose up -d --build

# 4. 等待 30-60 秒构建完成，查看日志确认
docker-compose logs -f

# 5. 访问 http://localhost:3000
```

### 方式二：本地开发

```bash
# 1. Clone 仓库
git clone https://github.com/lzr098/variant-impact-website.git
cd variant-impact-website

# 2. 安装依赖
# 注意：如果 package-lock.json 来自旧的镜像源，建议先删除再重新安装
rm -f package-lock.json
npm install

# 3. 启动开发服务器
npm run dev

# 4. 访问 http://localhost:3000
```

### 方式三：构建生产版本

```bash
# 构建前端 + 后端
npm run build

# 使用 Docker 运行生产版本
# 构建后会从 dist/ 目录加载静态文件和 API 服务
docker-compose up -d --build
```

## 已知问题与解决方案

### 1. `package-lock.json` 锁定到已失效的镜像源

**症状**：`npm install` 或 `npm ci` 在 Docker 构建时失败，提示 `registry.npmjs.org 404` 或 `npm install` 报错。

**原因**：旧的 `package-lock.json` 中部分依赖解析到 `https://npm.mirrors.msh.team` 等已失效的镜像源。

**解决方案**：

```bash
rm -f package-lock.json
npm install
# 重新安装后 lock 文件会指向官方 npm registry
```

### 2. Docker 构建中 `node:20-alpine` 镜像拉取超时

**症状**：`docker-compose up -d --build` 卡在 `docker pull node:20-alpine`。

**解决方案**：

```bash
# 手动预拉取镜像
docker pull node:20-alpine
# 然后再执行 docker-compose up -d --build
```

### 3. 多碱基缺失/插入（如 ΔF508）输入失败

**症状**：输入 `chr7:117559591:CTTT:C` 返回 "No data"。

**原因**：旧版解析器只支持单碱基替换和短 indel，不支持多碱基缺失/插入的 HGVS 转换。

**解决方案**：已修复。当前版本支持：
- `7:g.117559591_117559593delCTT`（HGVS 标准）
- `chr7:117559591:CTTT:C`（VCF 风格，自动转换为 HGVS）
- `chr7:117559591:C:CTTTT`（VCF 风格插入，自动转换）

### 4. VEP API 返回空数据

**症状**：某些变异输入后返回 "No data found"。

**原因**：
- Ensembl VEP `/hgvs` 端点对多碱基替换（如 `7:g.117559591CTTT>C`）不支持
- 某些罕见 rsID 在 Ensembl 数据库中映射不完整

**解决方案**：使用标准 HGVS 缺失格式（`del`）或 VCF 风格输入（`ref:alt`），系统会自动转换。

## 项目结构

```
variant-impact-website/
├── api/                          # 后端 API 服务
│   ├── boot.ts                   # 入口文件
│   ├── router.ts                 # 路由注册
│   ├── lib/                      # 工具库
│   ├── services/
│   │   ├── variantAnalyzer.ts   # 核心变异解析 + VEP 查询
│   │   ├── clinvar.ts           # ClinVar 查询
│   │   ├── gtex.ts              # GTEx 表达数据
│   │   ├── acmg.ts              # ACMG 证据分级
│   │   └── translation.ts       # 中文翻译模块
│   └── types.ts                  # TypeScript 类型定义
├── src/                          # 前端 React 应用
│   ├── pages/
│   │   └── Home.tsx              # 主分析页面
│   ├── components/               # 可复用 UI 组件
│   └── App.tsx                   # 路由入口
├── Dockerfile                    # Docker 生产镜像
├── docker-compose.yml            # Docker Compose 配置
├── package.json                  # 依赖配置
└── .env.example                  # 环境变量模板
```

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
# 必需
DATABASE_URL=mysql://...          # 可选，用于数据持久化

# 可选（LLM 翻译增强）
LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

> 即使不配置 LLM，系统仍可通过内置词典完成基础翻译。

## 报告与导出

分析完成后，系统提供：

- **JSON 报告**：结构化数据，包含 VEP 注释、ClinVar、GTEx、ACMG 分类、ClinGen 证据等
- **Markdown 报告**：人类可读的病案报告（支持中文）
- **打印/PDF**：浏览器打印功能直接导出 PDF

报告保存路径：`./output/`（默认，可配置）

## 相关项目

| 项目 | 说明 | 链接 |
|------|------|------|
| **variant-impact** | CLI 版本，支持离线 VEP Docker + 本地 ClinVar/OMIM 数据库 | [GitHub](https://github.com/lzr098/variant-impact) |
| **gpa-genomic-phenotype** | 全基因组表型关联分析（GPA 分级系统） | [GitHub](https://github.com/lzr098/dgra-genomic-risk) |
| **dgra-prefilter** | VCF 基因组区域预过滤模块 | [GitHub](https://github.com/lzr098/GPA-Filter) |

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **后端**：Node.js + Express + tRPC
- **构建**：Vite（前端）+ esbuild（后端）
- **部署**：Docker + Docker Compose
- **数据源**：Ensembl VEP REST API、ClinVar API、GTEx Portal API

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 PR。请确保：
1. 代码通过 TypeScript 类型检查：`npm run build`
2. 核心逻辑变更需附带测试用例（curl 或前端截图）

---

**维护者**：[@lzr098](https://github.com/lzr098)
