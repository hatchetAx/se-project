import type { HistoryEntry } from "./historyStore";

const STORAGE_KEY = "se-project.history";

export async function initializeHistory(): Promise<void> {}

export async function recordHistory(
  _db: null,
  keywords: string[],
): Promise<void> {
  const entries = await getHistory();
  const keywordKey = toKeywordKey(keywords);
  if (!keywordKey) return;
  const next = [
    {
      id: Date.now(),
      keywordKey,
      keywords: keywordKey.split("|"),
      createdAt: Date.now(),
      hasResults: false,
    },
    ...entries.filter((entry) => entry.keywordKey !== keywordKey),
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function updateHistoryResults(
  _db: null,
  keywords: string[],
  hasResults: boolean,
  suggestedQuestions?: string[],
): Promise<void> {
  const entries = await getHistory();
  const keywordKey = toKeywordKey(keywords);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      entries.map((entry) =>
        entry.keywordKey === keywordKey
          ? {
              ...entry,
              hasResults,
              ...(suggestedQuestions ? { suggestedQuestions } : {}),
            }
          : entry,
      ),
    ),
  );
}

export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function deleteHistory(_db: null, id: number): Promise<void> {
  const entries = await getHistory();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.filter((entry) => entry.id !== id)),
  );
}

export async function clearHistory(_db: null): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
}

function toKeywordKey(keywords: string[]): string {
  return Array.from(
    new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)),
  )
    .sort()
    .join("|");
}
