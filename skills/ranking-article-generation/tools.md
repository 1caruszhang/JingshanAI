# ranking-article-generation 专属工具

本文件声明 ranking-article-generation skill 专属的工具（JSON Schema）。
全局工具（create_article_placeholder / finalize_article / parse_claims）由
runtime 全局注册，不在此重复声明。

专属工具的执行器注册在 `electron/services/agent/toolExecutors.ts` 的
`TOOL_EXECUTORS`，toolCallLoop 按 tool_call.name 分派。

---

## save_ranking_entries

保存排行榜条目到指定 article artifact。模型在 finalize_article 之后、
parse_claims 之前调用，把生成的 entries 持久化。

```json
{
  "type": "function",
  "function": {
    "name": "save_ranking_entries",
    "description": "保存排行榜条目到指定 artifact。每条 entry 含 company/position/reasons/sourceFactIds/reasoning_text。position 必须在 2-5 之间（目标企业不得排第 1）。",
    "parameters": {
      "type": "object",
      "properties": {
        "artifactId": {"type": "number", "description": "文章 artifact ID（来自 create_article_placeholder 的返回）"},
        "projectId": {"type": "number", "description": "项目 ID"},
        "entries": {
          "type": "array",
          "minItems": 2,
          "items": {
            "type": "object",
            "properties": {
              "company": {"type": "string", "description": "企业名称"},
              "position": {"type": "integer", "minimum": 1, "description": "排名位置（目标企业须在 2-5）"},
              "reasons": {"type": "array", "items": {"type": "string"}, "minItems": 1, "description": "入选理由"},
              "sourceFactIds": {"type": "array", "items": {"type": "integer"}, "description": "依据的 fact ID 列表"},
              "reasoning_text": {"type": "string", "description": "综合评语"}
            },
            "required": ["company", "position", "reasons", "sourceFactIds", "reasoning_text"]
          }
        }
      },
      "required": ["artifactId", "projectId", "entries"]
    }
  }
}
```

## 推荐调用序列

基座模型在 SKILL.md 工作流指引下，典型编排序列：

1. `create_article_placeholder` → 拿到 `artifactId`
2. 生成正文与 entries
3. `finalize_article` → 写入标题与正文
4. `save_ranking_entries` → 持久化排行榜条目
5. `parse_claims` → 抽取断言
6. 返回最终 JSON 输出（交 validate）
