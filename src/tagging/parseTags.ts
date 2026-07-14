const TAG_PATTERN = /(?<=^|\s)@(all|(?![A-Z]+(?:\s|$))[A-Z][A-Za-z0-9_]*)(?=\s|$)/g;

export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of text.matchAll(TAG_PATTERN)) {
    const tag = match[1];
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }

  return result;
}
