/**
 * jsonUtils.ts
 *
 * JSON 解析共享工具。md-driven skill 的 validate 层与旧生成路径共用：
 *   - LLM 常把 JSON 包在 ```json ... ``` 代码块里返回，统一在此剥除 fence
 *     再 `JSON.parse`。
 *   - 解析成功返回解析后的对象；失败返回 `null`（调用方自行决定报错形态）。
 *
 * 抽出此 util 是为了消除 title-generation / ranking-article-generation 两个
 * skill index.ts 里重复的 fence-strip 正则（#64）。
 */

/**
 * 剥除 ```json / ``` 围栏后解析 JSON。解析失败返回 null。
 *
 * @param text LLM 原始输出（可能带 ```json fence）
 * @returns 解析后的对象，或 null
 */
export function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
