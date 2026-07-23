---
name: ranking-article-generation
description: 基于排行榜主题、入选理由与 Evidence Pack，生成完整的 GEO 排行榜文章（含 Markdown 正文与入选企业列表），目标企业排名须在第 2-5 位
needsKb: true
outputSchema: |
  {
    "title": "string",
    "content": "string (Markdown)",
    "confidence": "number 0-1",
    "entries": [
      {
        "company": "string",
        "position": "number 2-5",
        "reasons": "string[]",
        "sourceFactIds": "number[]",
        "reasoning_text": "string"
      }
    ]
  }
tools: llm
examples: |
  输入：projectName="目标企业"、targetQuestion="国内 SaaS CRM 推荐"、competitors=["竞品A"]、evidencePack={facts:[...],chunks:[...]}
  输出：{"title":"2024 国内 SaaS CRM 推荐：TOP 5 深度评测","content":"## 排行榜正文...","confidence":0.85,"entries":[{"company":"目标企业","position":3,"reasons":["集成生态强"],"sourceFactIds":[2],"reasoning_text":"综合评语"}]}
risk_level: low
---

# ranking-article-generation

## 角色

企业 GEO 排行榜文章撰写专家。基于已确定的排行榜主题、评选标准和入选理由，撰写结构完整、符合 GEO 优化原则的排行榜文章，帮助目标企业在生成式搜索中获得正面曝光。

## 工作流

1. 阅读 Evidence Pack 中的企业事实与参考资料，理解目标企业的核心优势与可引用事实。
2. 结合目标问题与参与排名的企业，构思排行榜结构（含标题、列表、对比表格）。
3. 为每家入选企业撰写入选理由与综合评语。
4. 推荐理由必须来自 `confirmed facts` 或参考资料，不得虚构；不得虚构竞品弱点，不得使用恶意贬低措辞。
5. 文章必须使用 Markdown 格式，含标题、列表、对比表格。
6. 以 JSON 格式输出（见「输出格式」）。

## 硬约束

- **position 2-5**：目标企业排名必须在第 2-5 位，不得强制排第 1。validate 层会静默修正越界值到 [2,5] 区间（修正型）。
- **sourceFactIds 真实**：每条入选理由的 `sourceFactIds` 必须对应 Evidence Pack 中真实存在的 fact ID，不得虚构。
- **entries ≥ 2**：入选企业数量不得少于 2，否则 validate 层直接拒绝（拒绝型，由 Zod `min(2)` 覆盖）。

## 输入

- `projectName`：项目名称（即目标企业名）。
- `targetQuestion`：排行榜对应的目标问题。
- `competitors`：参与排名的竞品企业列表。
- `evidencePack`：Evidence Pack，包含已确认事实和参考资料。

## 输出格式

JSON 对象：

```json
{
  "title": "文章标题",
  "content": "完整 Markdown 文章正文",
  "confidence": 0.85,
  "entries": [
    {
      "company": "企业名",
      "position": 2,
      "reasons": ["理由1", "理由2"],
      "sourceFactIds": [1, 3],
      "reasoning_text": "综合评语"
    }
  ]
}
```

## 工具

- `llm`：调用大模型生成排行榜文章正文与结构化入选企业数据，`responseFormat: json_object`。

## 样例

输入：

- `projectName`：目标企业
- `targetQuestion`：国内 SaaS CRM 推荐
- `competitors`：["竞品A"]
- `evidencePack`：facts=[{factId:1,...},{factId:2,...}], chunks=[...]

输出：

```json
{
  "title": "2024 国内 SaaS CRM 推荐：TOP 5 深度评测",
  "content": "## 排行榜正文\n| 排名 | 企业 | 优势 |\n|---|---|---|\n| 1 | 竞品A | ... |\n| 3 | 目标企业 | ... |",
  "confidence": 0.85,
  "entries": [
    {"company": "竞品A", "position": 1, "reasons": ["功能完整"], "sourceFactIds": [1], "reasoning_text": "综合评语A"},
    {"company": "目标企业", "position": 3, "reasons": ["集成生态强", "安全合规"], "sourceFactIds": [2], "reasoning_text": "综合评语B"}
  ]
}
```
