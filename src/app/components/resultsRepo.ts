import type { SQLiteDatabase } from "expo-sqlite";
import { getDatabases } from "./getDatabases";

export type DatabaseResult = {
  id: number;
  name: string;
  organization: string;
  url: string;
  description: string;
  isOpenSource: boolean;
  verifiedAt: number; // unix ms of the last live check
  rank: number;
  relevance: number; // 0-100
};

/**
 * Same keyword set in any order gives the same key (requirement 5).
 * "Space Flight, retina" and "retina, space flight" both become "retina|space flight".
 */
export function toKeywordKey(keywords: string[]): string {
  const clean = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(clean)).sort().join("|");
}

// ---------------------------------------------------------------------------
// 1. SCHEMA
// ---------------------------------------------------------------------------

/**
 * Creates the two tables that hold the results. Safe to call every time:
 * IF NOT EXISTS makes a repeat call do nothing.
 *
 * The `searches` table is not created here: initializeHistory (historyStore.ts)
 * already creates it, and turns on foreign keys, when the database opens.
 *
 * databases         one row per website. url is UNIQUE, so two searches that
 *                   find the same website share one row.
 * search_databases  links a search to its databases, with rank and relevance.
 *                   Deleting a search from history deletes its links too.
 */
async function initializeResults(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS databases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization TEXT,
      url TEXT NOT NULL UNIQUE,
      description TEXT,
      is_open_source INTEGER NOT NULL DEFAULT 0,
      is_live INTEGER NOT NULL DEFAULT 0,
      verified_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS search_databases (
      search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      database_id INTEGER NOT NULL REFERENCES databases(id),
      rank INTEGER NOT NULL,
      relevance INTEGER NOT NULL,
      PRIMARY KEY (search_id, database_id)
    );
  `);
}

// ---------------------------------------------------------------------------
// 2. FETCH AND INSERT DETAILS
// ---------------------------------------------------------------------------

/**
 * Gets the databases for a keyword set and saves them.
 * getDatabases (getDatabases.ts) does the searching, ranking and live check;
 * this function only stores what it returns.
 */
async function fetchAndInsertDatabases(
  db: SQLiteDatabase,
  keywords: string[],
): Promise<void> {
  const key = toKeywordKey(keywords);
  const found = await getDatabases(keywords);

  // The links below need this search's row. IGNORE = it is already there
  // (the History screen may have added it a moment ago).
  await db.runAsync(
    "INSERT OR IGNORE INTO searches (keyword_key, created_at) VALUES (?, ?)",
    [key, Date.now()],
  );

  for (const d of found) {
    // Save the database. If we already have this url, update it instead.
    await db.runAsync(
      `INSERT INTO databases
         (name, organization, url, description, is_open_source, is_live, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         name = excluded.name,
         organization = excluded.organization,
         description = excluded.description,
         is_open_source = excluded.is_open_source,
         is_live = excluded.is_live,
         verified_at = excluded.verified_at`,
      [
        d.name,
        d.organization,
        d.url,
        d.description,
        d.isOpenSource ? 1 : 0,
        d.isLive ? 1 : 0,
        d.verifiedAt,
      ],
    );

    // Link it to this search. The two ids are looked up inside the statement.
    // OR REPLACE = running this twice for the same search is harmless.
    await db.runAsync(
      `INSERT OR REPLACE INTO search_databases (search_id, database_id, rank, relevance)
       VALUES ((SELECT id FROM searches WHERE keyword_key = ?),
               (SELECT id FROM databases WHERE url = ?),
               ?, ?)`,
      [key, d.url, d.rank, d.relevance],
    );
  }
}

// ---------------------------------------------------------------------------
// 3. QUERY RESULTS
// ---------------------------------------------------------------------------

type Row = {
  id: number;
  name: string;
  organization: string | null;
  url: string;
  description: string | null;
  is_open_source: number;
  verified_at: number | null;
  rank: number;
  relevance: number;
};

/** Saved rows for a keyword set. Live databases only, open source first. */
function queryResults(db: SQLiteDatabase, keywords: string[]): Promise<Row[]> {
  return db.getAllAsync<Row>(
    `SELECT d.id, d.name, d.organization, d.url, d.description,
            d.is_open_source, d.verified_at, sd.rank, sd.relevance
       FROM searches s
       JOIN search_databases sd ON sd.search_id = s.id
       JOIN databases d ON d.id = sd.database_id
      WHERE s.keyword_key = ? AND d.is_live = 1
      ORDER BY d.is_open_source DESC, sd.rank ASC`,
    [toKeywordKey(keywords)],
  );
}

/**
 * Results for a keyword set. The first time a set is searched, the databases
 * are fetched and saved; after that they come straight from SQLite.
 */
export async function getResultsForKeywords(
  db: SQLiteDatabase,
  keywords: string[],
): Promise<DatabaseResult[]> {
  await initializeResults(db);

  let rows = await queryResults(db, keywords); // 3. anything saved already?
  if (rows.length === 0) {
    await fetchAndInsertDatabases(db, keywords); // 2. no: fetch and save
    rows = await queryResults(db, keywords); // 3. then read them back
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organization: r.organization ?? "",
    url: r.url,
    description: r.description ?? "",
    isOpenSource: r.is_open_source === 1,
    verifiedAt: r.verified_at ?? 0,
    rank: r.rank,
    relevance: r.relevance,
  }));
}
