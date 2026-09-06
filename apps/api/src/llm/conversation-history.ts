import { LlmMessage } from './llm-provider.interface';

export function trimHistory(
  history: LlmMessage[],
  maxMessages: number,
): LlmMessage[] {
  let trimmed = history.slice(-maxMessages);
  while (trimmed.length > 0 && trimmed[0].role === 'tool') {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export function truncateToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const removed = content.length - maxChars;
  return `${content.slice(0, maxChars)}… (gekürzt, ${removed} Zeichen entfernt)`;
}
