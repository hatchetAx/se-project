import type { ChatMessage } from "./aiConversationStore";

const STORAGE_PREFIX = "se-project.ai-conversation.";

export async function getConversation(
  _db: null,
  keywords: string[],
): Promise<ChatMessage[]> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`${STORAGE_PREFIX}${toKeywordKey(keywords)}`) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export async function saveConversation(
  _db: null,
  keywords: string[],
  messages: ChatMessage[],
): Promise<void> {
  localStorage.setItem(
    `${STORAGE_PREFIX}${toKeywordKey(keywords)}`,
    JSON.stringify(messages),
  );
}

export async function clearConversation(
  _db: null,
  keywords: string[],
): Promise<void> {
  localStorage.removeItem(`${STORAGE_PREFIX}${toKeywordKey(keywords)}`);
}

function toKeywordKey(keywords: string[]): string {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
    .sort()
    .join("|");
}
