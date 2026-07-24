/**
 * replyFilter.ts
 *
 * #88: 内容级中间推理分离 + AI 消息 content 提取。
 *
 * 即使加了 prompt 约束，DeepSeek 等模型有时仍会把自我指令 / 内部思考
 * （如「按给定身份回复用户，语气亲和。」「我将……」「首先让我……」）
 * 写在最终回复的**同一条 AIMessage** 里。message 级分离无法捕获这种情况，
 * 这里再做一道内容级兜底：从 finalReply 文本中识别并剥离开头的自我指令句，
 * 归入 thinkingTexts。
 *
 * 同时处理 DeepSeek thinking 模式的 content blocks 格式
 *（[{type:"reasoning",...},{type:"text",text:"..."}]）→ 提取纯文本。
 */

/**
 * 从 AI 消息的 content 中提取纯文本字符串，兼容两种格式：
 *   - 纯字符串："你好" → "你好"
 *   - content blocks 数组：[{type:"reasoning",reasoning:"..."},{type:"text",text:"我是小鲸"}]
 *     → 只拼接 {type:"text"} 的 text 字段
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is Record<string, unknown> =>
          typeof block === 'object' && block !== null,
      )
      .filter((block) => block.type === 'text')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('');
  }
    return '';
}

/**
 * 从 AI 消息的 content 中提取 reasoning 文本（DeepSeek thinking 模式）。
 * content blocks 数组：[{type:"reasoning",reasoning:"..."}] → 拼接 reasoning 字段
 */
export function extractReasoningContent(content: unknown): string {
  if (typeof content === 'string') return '';
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is Record<string, unknown> =>
          typeof block === 'object' && block !== null,
      )
      .filter((block) => block.type === 'reasoning')
      .map((block) => (typeof block.reasoning === 'string' ? block.reasoning : ''))
      .join('\n');
  }
  return '';
}

/**
 * 自我指令句段的开头特征。
 * 识别策略：
 *   - 将内容按中文句号「。」或换行切成句段
 *   - 从头扫描，匹配自我指令模式的句段 → thinkingTexts
 *   - 遇到第一条非自我指令句段，停止；其后全部为真正的用户回复
 *   - 仅剥离**开头**的自我指令段（中段出现的自我对话极少，不误伤）
 */

/**
 * 自我指令句段的开头特征。匹配以下任一即判定为自我指令：
 *   按(给定|设定|照|提示)...     「按给定身份回复用户，语气亲和」
 *   我将 / 我应 / 我会...        「我将按照设定身份回答」
 *   让我 / 首先，?让我...         「首先，让我确认一下」
 *   好的，?我来 / 好的，?我将... 「好的，我来为你介绍」
 *   明白了 / 收到...             「明白了，用户的意图是」
 *   根据(系统|设定|要求|提示)...  「根据系统设定」
 *   遵照(设定|要求)...           「遵照设定」
 *   首先分析 / 先来...            「先来梳理一下需求」
 */
const SELF_INSTRUCTION_RE =
  /^(按(?:给定|设定|照|提示|用户|规则)[^。.!！?\n]{0,30}|我将[^。.!！?\n]{0,30}|我应(?:当|该)[^。.!！?\n]{0,30}|我会[^。.!！?\n]{0,30}|让我[^。.!！?\n]{0,30}|首先[，,]?\s*让我[^。.!！?\n]{0,30}|好的[，,]?\s*我来[^。.!！?\n]{0,30}|好的[，,]?\s*我将[^。.!！?\n]{0,30}|明白了?[，,]?[^。.!！?\n]{0,30}|收到[，,]?[^。.!！?\n]{0,30}|根据(?:系统|设定|要求|提示|身份)[^。.!！?\n]{0,30}|遵照(?:设定|要求|规则)[^。.!！?\n]{0,30}|先来[^。.!！?\n]{0,30}|首先分析[^。.!！?\n]{0,30})[。.!！?]?\s*/;

/** 最短自我指令长度（避免把「好的」这类过短词误判为整段指令） */
const MIN_SENTENCE_LEN = 5;

/**
 * 把纯文本内容切分为句段（保留分隔符后内容）。用中文句号「。」、英文句点、
 * 换行作为切分点。
 */
function splitSentences(text: string): string[] {
  // 保留分隔符本身以便后续拼接，按 [。.!！?\n] 切
  const parts = text.split(/(?<=[。.!！?\n])/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

export interface SeparateResult {
  /** 真正面向用户的回复 */
  reply: string;
  /** 从开头剥离下来的自我指令 / 中间推理片段 */
  thinking: string[];
}

/**
 * 内容级分离：从文本开头剥离自我指令句段。
 *
 * 仅处理开头连续的自我指令段（避免误伤中段正文）。一旦遇到一条
 * 看起来是真正回复的句段，就停止。
 */
export function separateThinkingFromReply(content: string): SeparateResult {
  if (!content || typeof content !== 'string') {
    return {reply: content ?? '', thinking: []};
  }

  const sentences = splitSentences(content);
  const thinking: string[] = [];
  let firstReplyIdx = 0;

  // 从头扫描，匹配自我指令模式的句段归入 thinking
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    // 过短的句段不足以判断，保留给正文
    if (s.length < MIN_SENTENCE_LEN) break;
    const match = s.match(SELF_INSTRUCTION_RE);
    if (match) {
      // 整句匹配到自我指令 → 归入 thinking
      thinking.push(s.trim());
      firstReplyIdx = i + 1;
    } else {
      // 第一条非自我指令句段：正文从这里开始
      break;
    }
  }

  // 剩余部分（含可能残留在句段内的内容）拼回为 reply
  const reply = sentences.slice(firstReplyIdx).join('').trim();

  // 若剥离后 reply 为空，说明整段被判为自我指令（不太合理），回退保留原文
  if (!reply) {
    return {reply: content.trim(), thinking: []};
  }

  return {reply, thinking};
}
