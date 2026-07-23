/**
 * structure_content.ts
 *
 * TypeScript port of geo_skills/geo-structured-writer/scripts/structure_content.py.
 * Pure, deterministic content structuring helpers for Electron main process —
 * no CLI wrapper, no file I/O, no external dependencies.
 */

/**
 * FAQ block appended to the end of structured content.
 * Question answers are left as `[Answer]` placeholders for the LLM layer to fill.
 */
export const FAQ_BLOCK = `
## Frequently Asked Questions

**Q: What is this about?**

A: [Answer]

**Q: How does this work?**

A: [Answer]
`;

/**
 * Restructures raw content into an AI-readable layout.
 *
 * Behaviour is equivalent to the original Python implementation:
 * lines pass through unchanged (paragraphs longer than 50 characters are
 * candidates for H2/H3 headers, but header insertion is left to the LLM
 * layer), and a FAQ block template is appended at the end.
 *
 * @param content Raw unstructured Markdown/text content.
 * @returns The content with the FAQ block appended.
 */
export function structureContent(content: string): string {
  const lines = content.split('\n');

  const structured: string[] = [];
  for (const line of lines) {
    if (line.length > 50 && !line.startsWith('#')) {
      // Potential paragraph that needs a header — kept as-is, see docstring.
    }
    structured.push(line);
  }

  return structured.join('\n') + FAQ_BLOCK;
}
