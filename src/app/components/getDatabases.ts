/**
 * getDatabases.ts
 * ============================================================================
 * "Go and get the databases." Given some keywords, this file asks re3data.org
 * for matching research-data repositories, ranks them, downloads each one's
 * details, and checks whether its website is still up.
 *
 * WHAT THIS FILE DOES NOT DO: it never touches SQLite or React Native. That is
 * on purpose. Keeping "getting data" separate from "saving data" means:
 *   - you can test it with NO phone, NO database and NO internet (see the
 *     `fetchFn` option below), and
 *   - resultsRepo.ts only has to worry about tables and caching.
 *
 * THE ONE FUNCTION YOU CALL
 * -------------------------
 *   const found = await getDatabases(["space flight", "retina"]);
 *
 * It returns an array of FoundDatabase objects, best first.
 *
 * WHAT HAPPENS INSIDE getDatabases (in order)
 * -------------------------------------------
 *   1. normalizeKeywords   clean the keywords (trim, lowercase, no duplicates)
 *   2. fetchRepositoryList one re3data search PER keyword
 *   3. mergeAndRank        combine the hit lists; more keywords matched = better
 *   4. loadRecord          for each of the top hits: get the full record
 *                          (parseRepositoryRecord) and check the site is up
 *                          (checkLive)
 *   5. number the results  rank 1, 2, 3 ... and relevance 0-100
 *
 * HOW TO MAKE IT TESTABLE
 * -----------------------
 * Every function that uses the network takes a `fetchFn` argument. In the app
 * it defaults to the real `fetch`. In a test you pass a fake one that returns
 * canned XML. No other code has to change.
 *
 * re3data FACTS (from the API docs)
 * ---------------------------------
 *   List/search:  GET https://www.re3data.org/api/v40/repositories?query=climate
 *   One record:   GET https://www.re3data.org/api/v40/repository/{id}
 *   - Responses are XML only (no JSON).
 *   - A list call with NO query currently fails with HTTP 500, so we always
 *     send one.
 *   - The old /api/beta endpoint is deprecated; we use /api/v40 (schema 4.0).
 *   - re3data metadata is CC0 (free to use).
 *
 * XML PARSING WITHOUT A LIBRARY
 * -----------------------------
 * React Native has no DOMParser, so the small "XML helpers" section pulls out
 * the few tags we need with regular expressions. They ignore namespace
 * prefixes (<r3d:name> vs <name>) and upper/lower case. If you later install
 * fast-xml-parser, only that section and the two parse* functions change.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// 1. TYPES
// ---------------------------------------------------------------------------

/**
 * The only parts of fetch() we use. Describing it this way (instead of using
 * the full `typeof fetch`) means a test's fake fetch can return a tiny object
 * like { ok: true, status: 200, text: async () => "<xml/>" }.
 */
export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** One entry from a re3data search (list) response. */
export type RepoSummary = { id: string; name: string };

/** What we pull out of one full re3data record. */
export type ParsedRecord = {
  re3dataId: string;
  name: string;
  organization: string;
  url: string;
  description: string;
  isOpenSource: boolean;
};

/**
 * A parsed record plus our liveness result. This is the shape that gets
 * saved to SQLite and the shape a record cache hands back.
 *   verifiedAt = unix ms of the liveness check, or 0 if it was never checked.
 */
export type DatabaseRecord = ParsedRecord & {
  isLive: boolean;
  verifiedAt: number;
};

/** A database found for a search, with its place in the ranking. */
export type FoundDatabase = DatabaseRecord & {
  rank: number; // 1 = best
  relevance: number; // 0-100 = share of the search keywords it matched
};

/**
 * Optional hook so a caller can supply records it already saved (resultsRepo
 * passes one that reads SQLite). Return null if there is no saved copy.
 *   fresh = true  -> use it as-is, skip the download
 *   fresh = false -> try to download a new copy, but fall back to this one if
 *                    the download fails (useful when the device is offline)
 */
export type RecordLookup = (
  re3dataId: string,
) => Promise<{ record: DatabaseRecord; fresh: boolean } | null>;

export type GetDatabasesOptions = {
  /** How many databases to keep. Default 15. */
  maxDatabases?: number;
  /** Replace the network layer (tests). Default: the real fetch. */
  fetchFn?: FetchFn;
  /** Check each website is up. Default true. false = skip (record gets isLive true, verifiedAt 0). */
  checkLiveness?: boolean;
  /** See RecordLookup. Default: none, always download. */
  lookupRecord?: RecordLookup;
  /** How many record downloads run at once. Default 4. */
  detailConcurrency?: number;
};

/** How one repository did across the keyword searches (used while ranking). */
export type Candidate = {
  summary: RepoSummary;
  matchedKeywords: Set<string>; // which of the user's keywords found it
  bestPosition: number; // best (lowest) position in any keyword's hit list
};

// ---------------------------------------------------------------------------
// 2. SETTINGS - tweak these numbers to taste
// ---------------------------------------------------------------------------

/** Base URL of the CURRENT re3data API (schema 4.0). */
const RE3DATA_BASE = "https://www.re3data.org/api/v40";

const DEFAULT_MAX_DATABASES = 15;
const DEFAULT_DETAIL_CONCURRENCY = 4;

/** Give up on a re3data request after 12 seconds. */
const REQUEST_TIMEOUT_MS = 12000;

/** Give up on an "is this site up?" check after 6 seconds. */
const LIVENESS_TIMEOUT_MS = 6000;

/** Descriptions in re3data can be long; a card only has room for a bit. */
const DESCRIPTION_MAX_CHARS = 280;

// ---------------------------------------------------------------------------
// 3. THE MAIN FUNCTION
// ---------------------------------------------------------------------------

/**
 * Finds databases for a set of keywords. See the header for the steps.
 *
 * Throws if the re3data searches themselves fail (e.g. no internet and no
 * cache). A single repository whose record can't be loaded is simply left
 * out, so one bad record never ruins the whole search.
 */
export async function getDatabases(
  keywords: string[],
  options: GetDatabasesOptions = {},
): Promise<FoundDatabase[]> {
  const {
    maxDatabases = DEFAULT_MAX_DATABASES,
    fetchFn = fetch as unknown as FetchFn,
    checkLiveness = true,
    lookupRecord,
    detailConcurrency = DEFAULT_DETAIL_CONCURRENCY,
  } = options;

  // Step 1: clean the keywords. Nothing to search for -> nothing to return.
  const clean = normalizeKeywords(keywords);
  if (clean.length === 0) return [];

  // Step 2: one re3data search PER keyword, all at once.
  // Why not one query with all the words? The docs don't say whether several
  // words mean AND or OR. Searching each word separately lets US decide that a
  // repository matching more of the keywords is more relevant.
  const lists = await Promise.all(
    clean.map((keyword) => fetchRepositoryList(keyword, fetchFn)),
  );

  // Step 3: merge the lists and keep the best few.
  const ranked = mergeAndRank(lists, clean, maxDatabases);
  if (ranked.length === 0) return [];

  // Step 4: get the full record (and liveness) for each, a few at a time.
  // A repository whose record can't be loaded comes back as null.
  const records = await mapWithLimit(ranked, detailConcurrency, (candidate) =>
    loadRecord(candidate.summary.id, { fetchFn, checkLiveness, lookupRecord }),
  );

  // Step 5: number the survivors. Rank counts only repositories we actually
  // loaded, so there are no gaps (1, 2, 3 - never 1, 3, 4).
  const found: FoundDatabase[] = [];
  ranked.forEach((candidate, i) => {
    const record = records[i];
    if (!record) return;
    found.push({
      ...record,
      rank: found.length + 1,
      // 2 of 3 keywords matched -> 67
      relevance: Math.round(
        (100 * candidate.matchedKeywords.size) / clean.length,
      ),
    });
  });
  return found;
}

// ---------------------------------------------------------------------------
// 4. KEYWORDS, MERGING, RANKING (pure functions - easy to unit test)
// ---------------------------------------------------------------------------

/**
 * Trim + lowercase each keyword, drop empty ones, remove duplicates, and sort
 * alphabetically. The same words in any order give the same array. Both the
 * search and the SQLite cache key are built from this, so they always agree.
 */
export function normalizeKeywords(keywords: string[]): string[] {
  const clean = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(clean)).sort();
}

/**
 * Combines one hit list per keyword into a single ranked list.
 *
 *   lists[i]  = the hits for keywords[i], in re3data's own order
 *
 * Ranking rule: most keywords matched first. Ties go to the repository that
 * appeared nearer the top of re3data's ordering (re3data weights a hit higher
 * when the term is frequent or in the name). Only the first `max` are kept.
 */
export function mergeAndRank(
  lists: RepoSummary[][],
  keywords: string[],
  max: number,
): Candidate[] {
  const candidates = new Map<string, Candidate>();

  lists.forEach((list, keywordIndex) => {
    list.forEach((summary, position) => {
      const existing = candidates.get(summary.id);
      if (existing) {
        // Seen before under another keyword: add this keyword, keep best spot.
        existing.matchedKeywords.add(keywords[keywordIndex]);
        existing.bestPosition = Math.min(existing.bestPosition, position);
      } else {
        candidates.set(summary.id, {
          summary,
          matchedKeywords: new Set([keywords[keywordIndex]]),
          bestPosition: position,
        });
      }
    });
  });

  return Array.from(candidates.values())
    .sort(
      (a, b) =>
        b.matchedKeywords.size - a.matchedKeywords.size ||
        a.bestPosition - b.bestPosition,
    )
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// 5. LOADING ONE REPOSITORY
// ---------------------------------------------------------------------------

/**
 * Returns the full record for one repository id, or null if it can't be had.
 *
 *  1. Ask the optional lookup for a saved copy. If it is fresh, use it.
 *  2. Otherwise download the record, parse it, and (optionally) check the
 *     website is up.
 *  3. If the download fails but there is an OLD saved copy, use that instead
 *     of losing the repository.
 */
async function loadRecord(
  re3dataId: string,
  deps: {
    fetchFn: FetchFn;
    checkLiveness: boolean;
    lookupRecord?: RecordLookup;
  },
): Promise<DatabaseRecord | null> {
  let saved: { record: DatabaseRecord; fresh: boolean } | null = null;
  try {
    saved = deps.lookupRecord ? await deps.lookupRecord(re3dataId) : null;
  } catch {
    saved = null; // a broken cache must never break a search
  }
  if (saved?.fresh) return saved.record;

  try {
    const xml = await fetchXml(
      `${RE3DATA_BASE}/repository/${encodeURIComponent(re3dataId)}`,
      deps.fetchFn,
    );
    const parsed = parseRepositoryRecord(xml, re3dataId);
    if (!parsed) return saved ? saved.record : null;

    if (!deps.checkLiveness) {
      // Unchecked: treated as live so it still shows up, verifiedAt 0 = "never verified".
      return { ...parsed, isLive: true, verifiedAt: 0 };
    }
    const isLive = await checkLive(parsed.url, deps.fetchFn);
    return { ...parsed, isLive, verifiedAt: Date.now() };
  } catch {
    return saved ? saved.record : null;
  }
}

// ---------------------------------------------------------------------------
// 6. NETWORK HELPERS
// ---------------------------------------------------------------------------

/**
 * fetch() with a timeout. React Native's fetch has no timeout option, so we
 * use an AbortController: after `ms` milliseconds we call abort(), which makes
 * the fetch reject. The timer is always cleared so it can't fire later.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  fetchFn: FetchFn,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** GET a URL from re3data and return the XML text. Throws on HTTP errors. */
async function fetchXml(url: string, fetchFn: FetchFn): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/xml" } },
    REQUEST_TIMEOUT_MS,
    fetchFn,
  );
  if (!res.ok) throw new Error(`re3data responded ${res.status} for ${url}`);
  return res.text();
}

/** Search re3data for ONE keyword. Returns hits in re3data's own order. */
export async function fetchRepositoryList(
  keyword: string,
  fetchFn: FetchFn,
): Promise<RepoSummary[]> {
  // encodeURIComponent turns "space flight" into "space%20flight" so the
  // query is safe inside a URL.
  const xml = await fetchXml(
    `${RE3DATA_BASE}/repositories?query=${encodeURIComponent(keyword)}`,
    fetchFn,
  );
  return parseRepositoryList(xml);
}

/**
 * "Is this website up?" re3data does NOT tell us this, so we ask the site.
 *
 * HEAD asks for the headers only (no page body), so it is cheap. Rules:
 *   - Any answer below 400 means the site is up.
 *   - 401/403/405/429 also mean "a server answered" (it just refuses HEAD or
 *     wants a login), so we count those as up too.
 *   - A timeout, DNS failure, 404 or 5xx counts as NOT live.
 */
export async function checkLive(
  url: string,
  fetchFn: FetchFn,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "HEAD" },
      LIVENESS_TIMEOUT_MS,
      fetchFn,
    );
    return res.status < 400 || [401, 403, 405, 429].includes(res.status);
  } catch {
    return false;
  }
}

/**
 * Runs `fn` over `items`, but only `limit` at a time. Results keep the same
 * order as `items`. (Promise.all on 15 items would fire 15 requests at once.)
 *
 * How it works: we start `limit` "workers". Each worker repeatedly grabs the
 * next unclaimed index and processes it, until none are left.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++; // JS is single-threaded, so this is safe
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// ---------------------------------------------------------------------------
// 7. XML HELPERS (tiny, namespace-agnostic, no dependencies)
// ---------------------------------------------------------------------------

type XmlElement = { attrs: string; inner: string };

/**
 * Finds every <tag ...>inner</tag> in `xml`, ignoring any "r3d:" style prefix
 * and ignoring upper/lower case (re3data writes both repositoryUrl and
 * repositoryURL depending on schema version).
 *
 * Regex, piece by piece:
 *   <(?:[A-Za-z0-9_-]+:)?TAG   opening "<", optional "prefix:", then the tag
 *   (\s[^>]*)?>                optional attributes (must start with a space,
 *                              which also stops "description" matching
 *                              "descriptionX"), then ">"
 *   ([\s\S]*?)                 the inner text, as little as possible
 *   </(?:prefix:)?TAG\s*>      the matching closing tag
 *
 * Limitation: self-closing tags like <link href="..."/> are not matched. We
 * never need to read one.
 */
function findElements(xml: string, tag: string): XmlElement[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${tag}(\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${tag}\\s*>`,
    "gi",
  );
  const found: XmlElement[] = [];
  for (const match of xml.matchAll(pattern)) {
    found.push({ attrs: match[1] ?? "", inner: match[2] ?? "" });
  }
  return found;
}

/** Turns raw XML text into plain readable text. */
function cleanText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") // unwrap CDATA sections
    .replace(/<[^>]+>/g, " ") // drop any tags inside
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    ) // &#x1F600; style
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    ) // &#233; style
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") // must be LAST so "&amp;lt;" stays "&lt;"
    .replace(/\s+/g, " ") // collapse newlines / runs of spaces
    .trim();
}

/** Text of the first <tag> found, or "" if there is none. */
function firstText(xml: string, tag: string): string {
  const el = findElements(xml, tag)[0];
  return el ? cleanText(el.inner) : "";
}

/**
 * For tags that can repeat in several languages, e.g.
 *   <r3d:description language="eng">...</r3d:description>
 *   <r3d:description language="deu">...</r3d:description>
 * prefer English, otherwise fall back to the first one.
 */
function localizedText(xml: string, tag: string): string {
  const all = findElements(xml, tag);
  if (all.length === 0) return "";
  const english = all.find((el) => /language\s*=\s*"eng"/i.test(el.attrs));
  return cleanText((english ?? all[0]).inner);
}

// ---------------------------------------------------------------------------
// 8. PARSING THE TWO KINDS OF re3data RESPONSE
// ---------------------------------------------------------------------------

/**
 * Parses the LIST response. Each hit looks roughly like:
 *   <repository> <id>r3d100010468</id> <doi>...</doi> <name>Zenodo</name>
 *                <link href="..." rel="self"/> </repository>
 * We only need id and name.
 */
export function parseRepositoryList(xml: string): RepoSummary[] {
  const out: RepoSummary[] = [];
  for (const el of findElements(xml, "repository")) {
    const id = firstText(el.inner, "id");
    if (id) out.push({ id, name: firstText(el.inner, "name") });
  }
  return out;
}

/**
 * Parses ONE full record (schema 4.0). Elements we use:
 *   repositoryName            the display name
 *   repositoryUrl             the website (what the card links to)
 *   description               text description (English preferred)
 *   institution/institutionName   the organization running it
 *   databaseAccess/databaseAccessType   "open" | "restricted" | "closed"
 *   keyword, subject/subjectName        fallback text if no description
 *
 * The id is passed in (we already know it from the list) instead of parsed,
 * because the XML root element is ALSO called "re3data", which would confuse a
 * simple tag search.
 *
 * Returns null when the record has no name or no URL (a card would be
 * useless without them).
 */
export function parseRepositoryRecord(
  xml: string,
  re3dataId: string,
): ParsedRecord | null {
  // The record sits inside <r3d:repository>. Work inside it if we can find it.
  const repoEl = findElements(xml, "repository")[0];
  const body = repoEl ? repoEl.inner : xml;

  const name = localizedText(body, "repositoryName");
  const url = firstText(body, "repositoryUrl");
  if (!name || !url) return null;

  // Organization: the FIRST <institution> block's name.
  const institution = findElements(body, "institution")[0];
  const organization = institution
    ? localizedText(institution.inner, "institutionName")
    : "";

  // Open or not: re3data's own access label for the repository. Be aware this
  // means open ACCESS (anyone may use it), not open SOURCE code.
  const access = (
    firstText(body, "databaseAccessType") || firstText(body, "databaseAccess")
  ).toLowerCase();
  const isOpenSource = access === "open";

  // Description: use the real one if present, otherwise build a short line
  // from subjects/keywords so the card is never blank.
  let description = localizedText(body, "description");
  if (!description) {
    const subjects = findElements(body, "subjectName").map((e) =>
      cleanText(e.inner),
    );
    const keywords = findElements(body, "keyword").map((e) =>
      cleanText(e.inner),
    );
    const topics = Array.from(new Set([...subjects, ...keywords])).filter(
      Boolean,
    );
    description = topics.length ? `Topics: ${topics.join(", ")}` : "";
  }
  if (description.length > DESCRIPTION_MAX_CHARS) {
    description =
      description.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd() + "…";
  }

  return { re3dataId, name, organization, url, description, isOpenSource };
}
