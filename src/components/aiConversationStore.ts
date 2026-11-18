import type { SQLiteDatabase } from "expo-sqlite";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export async function initializeConversations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      keyword_key TEXT PRIMARY KEY,
      messages TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export async function getConversation(
  db: SQLiteDatabase | null,
  keywords: string[],
): Promise<ChatMessage[]> {
  if (!db) return [];
  await initializeConversations(db);
  const row = await db.getFirstAsync<{ messages: string }>(
    "SELECT messages FROM ai_conversations WHERE keyword_key = ?",
    [toKeywordKey(keywords)],
  );
  return parseMessages(row?.messages);
}

export async function saveConversation(
  db: SQLiteDatabase | null,
  keywords: string[],
  messages: ChatMessage[],
): Promise<void> {
  if (!db) return;
  await initializeConversations(db);
  await db.runAsync(
    `INSERT INTO ai_conversations (keyword_key, messages, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(keyword_key) DO UPDATE SET
       messages = excluded.messages,
       updated_at = excluded.updated_at`,
    [toKeywordKey(keywords), JSON.stringify(messages), Date.now()],
  );
}

export async function clearConversation(
  db: SQLiteDatabase | null,
  keywords: string[],
): Promise<void> {
  if (!db) return;
  await initializeConversations(db);
  await db.runAsync(
    "DELETE FROM ai_conversations WHERE keyword_key = ?",
    [toKeywordKey(keywords)],
  );
}

function parseMessages(value: string | undefined): ChatMessage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (message): message is ChatMessage =>
        typeof message === "object" &&
        message !== null &&
        "id" in message &&
        "role" in message &&
        "content" in message &&
        typeof (message as ChatMessage).id === "string" &&
        ((message as ChatMessage).role === "user" ||
          (message as ChatMessage).role === "assistant") &&
        typeof (message as ChatMessage).content === "string",
    );
  } catch {
    return [];
  }
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
