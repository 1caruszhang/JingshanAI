/**
 * multipartMessage.ts
 *
 * #91: 将 userGoal + 文件附件构造为 LangChain multipart HumanMessage content blocks。
 * 纯函数，无副作用，可独立单元测试。
 */

/** #91: Multipart content block types for LangChain HumanMessage. */
export type TextContentBlock = {type: 'text'; text: string};
export type ImageContentBlock = {type: 'image_url'; image_url: {url: string}};
export type HumanContentBlock = TextContentBlock | ImageContentBlock;

/** #91: 文件附件（与 IPC channels/schemas 中 files 元素结构一致）。 */
export interface FileAttachment {
  name: string;
  type: string;
  bytes: number;
  content?: string;
}

/**
 * #91: 从 base64 data URL 中解码出原始文本内容。
 *
 * data URL 格式: `data:<mime>;base64,<payload>`
 * 仅支持 text/* MIME 类型，非文本类型返回 null。
 * 在 Node.js 环境中使用 Buffer，在浏览器环境需 polyfill。
 */
export function decodeTextFromDataUrl(dataUrl: string): string | null {
  // 兼容三种 data URL 形态：
  //  - data:text/plain;base64,...          （标准）
  //  - data:text/plain;charset=utf-8;base64,... （带 charset 等参数）
  //  - data:;base64,...                     （空 MIME，FileReader 在 file.type 为空时产出）
  const match = dataUrl.match(/^data:([^;,]*)(?:;[^;]*)*;base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  // 仅解码文本类；空 MIME（FileReader 对未知类型文件产出）也按文本处理
  if (mime !== '' && !mime.startsWith('text/')) return null;
  try {
    return Buffer.from(match[2], 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * #91: 将 userGoal + files 构造为 multipart content blocks。
 *
 * - 文本类文件（text/*）内容解码后拼接在 userGoal 前面
 * - 图片文件（image/*）各自为独立的 image_url block
 * - 无文件时返回纯字符串（向后兼容）
 */
export function buildHumanContent(
  userGoal: string,
  files?: FileAttachment[],
): string | HumanContentBlock[] {
  if (!files || files.length === 0) {
    return userGoal;
  }

  const blocks: HumanContentBlock[] = [];
  const textParts: string[] = [];

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[multipartMessage] 收到 ${files.length} 个附件:`,
      files.map((f) => ({name: f.name, type: f.type, bytes: f.bytes, hasContent: !!f.content, contentHead: f.content?.slice(0, 60)})));
  }

  for (const file of files) {
    if (!file.content) {
      console.warn(`[multipartMessage] 附件 ${file.name} 无 content 字段，跳过`);
      continue;
    }

    if (file.type.startsWith('image/')) {
      // 图片：各自为独立的 image_url block
      blocks.push({type: 'image_url', image_url: {url: file.content}});
    } else {
      // 文本类文件：解码 base64，拼入文本内容
      const text = decodeTextFromDataUrl(file.content);
      if (text) {
        textParts.push(`[文件: ${file.name}]\n${text}`);
        console.log(`[multipartMessage] 附件 ${file.name} 解码成功，文本长度=${text.length}`);
      } else {
        console.warn(`[multipartMessage] 附件 ${file.name} 解码失败（data URL 前缀: ${file.content.slice(0, 50)}），内容被丢弃`);
      }
    }
  }

  // 文本块：文件内容 + 用户消息（文件内容在前，用户消息在后）
  if (textParts.length > 0) {
    blocks.unshift({type: 'text', text: `${textParts.join('\n\n')}\n\n用户消息：${userGoal}`});
  } else {
    blocks.unshift({type: 'text', text: userGoal});
  }

  return blocks;
}
