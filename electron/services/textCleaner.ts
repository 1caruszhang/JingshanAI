export interface CleanTextOptions {
  removeRepeatedLines?: boolean;
  preserveLineBreaks?: boolean;
}

export function cleanText(text: string, options: CleanTextOptions = {}): string {
  const { removeRepeatedLines = true, preserveLineBreaks = true } = options;

  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ');

  // Collapse multiple blank lines into a single blank line
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove lines that look like repeated page headers/footers (very short repeated lines)
  if (removeRepeatedLines) {
    const lines = cleaned.split('\n');
    const counts = new Map<string, number>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length < 60) {
        counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
      }
    }
    const repeated = new Set<string>();
    for (const [line, count] of counts) {
      if (count >= 3) repeated.add(line);
    }
    cleaned = lines
      .filter((line) => !repeated.has(line.trim()))
      .join('\n');
  }

  // Trim extra whitespace on each line
  cleaned = cleaned
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  if (!preserveLineBreaks) {
    cleaned = cleaned.replace(/\n+/g, ' ');
  }

  return cleaned.trim();
}
