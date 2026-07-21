# support-article-generation

## 目标

基于项目已确认事实与检索得到的 Evidence Pack，为 GEO 营销生成一篇「支持类文章」。

## 使用场景

用户在 Phase 7 文章生成 MVP 中点击「生成文章」时调用。

## 输入

- `projectName`: 项目名称。
- `supportArticleType`: 子类型，例如 `enterprise_profile`。
- `targetQuestion`: 目标问题/主题。
- `evidencePack`: Evidence Pack，包含已确认事实、参考资料、缺失字段、风险提示。

## 输出

JSON 对象：

```json
{
  "title": "文章标题",
  "content": "完整 Markdown 文章内容",
  "confidence": 0.85
}
```

## 约束

- 只使用输入中提供的事实与资料，禁止编造。
- 如果证据不足，在正文中明确说明并给出建议。
- 文章应适合生成式引擎优化（GEO）：结构清晰、小标题、关键信息前置。
- 不调用外部工具，不写入数据库，不执行发布。
