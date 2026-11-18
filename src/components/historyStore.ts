import type { SQLiteDatabase } from "expo-sqlite";

export type HistoryEntry = {
  id: number;
  keywordKey: string;
  keywords: string[];
  createdAt: number;
  hasResults: boolean;
};

type HistoryRow = {
  id: number;
  keyword_key: string;
  created_at: number;
  has_results: number;
};

export async function initializeHistory(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      has_results INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(searches)",
  );
  if (!columns.some((column) => column.name === "has_results")) {
    await db.execAsync(
      "ALTER TABLE searches ADD COLUMN has_results INTEGER NOT NULL DEFAULT 0",
    );
  }
}

export async function recordHistory(
  db: SQLiteDatabase | null,
  keywords: string[],
): Promise<void> {
  if (!db) return;
  const keywordKey = toKeywordKey(keywords);
  if (!keywordKey) return;
  await initializeHistory(db);
  await db.runAsync(
    `INSERT INTO searches (keyword_key, created_at)
     VALUES (?, ?)
     ON CONFLICT(keyword_key) DO UPDATE SET created_at = excluded.created_at,
       has_results = 0`,
    keywordKey,
    Date.now(),
  );
}

export async function updateHistoryResults(
  db: SQLiteDatabase | null,
  keywords: string[],
  hasResults: boolean,
): Promise<void> {
  if (!db) return;
  await initializeHistory(db);
  const keywordKey = toKeywordKey(keywords);
  await db.runAsync(
    "UPDATE searches SET has_results = ? WHERE keyword_key = ?",
    hasResults ? 1 : 0,
    keywordKey,
  );
}

export async function getHistory(
  db: SQLiteDatabase | null,
): Promise<HistoryEntry[]> {
  if (!db) return [];
  await initializeHistory(db);
  const rows = await db.getAllAsync<HistoryRow>(
    "SELECT id, keyword_key, created_at, has_results FROM searches ORDER BY created_at DESC",
  );
  return rows.map(toHistoryEntry);
}

export async function deleteHistory(
  db: SQLiteDatabase | null,
  id: number,
): Promise<void> {
  if (!db) return;
  await db.runAsync("DELETE FROM searches WHERE id = ?", id);
}

export async function clearHistory(
  db: SQLiteDatabase | null,
): Promise<void> {
  if (!db) return;
  await initializeHistory(db);
  await db.runAsync("DELETE FROM searches");

  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const names = new Set(tables.map((table) => table.name));
  if (names.has("search_databases")) {
    await db.runAsync("DELETE FROM search_databases");
  }
  if (names.has("databases")) {
    await db.runAsync("DELETE FROM databases");
  }
}

function toHistoryEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    keywordKey: row.keyword_key,
    keywords: row.keyword_key.split("|").filter(Boolean),
    createdAt: row.created_at,
    hasResults: row.has_results === 1,
  };
}

function toKeywordKey(keywords: string[]): string {
  return Array.from(
    new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)),
  )
    .sort()
    .join("|");
}
