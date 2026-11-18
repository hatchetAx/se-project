import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo } from "react";
import ResultsPage from "./components/ResultsPage";
import type { SearchFilters } from "./components/SplashPage";
import { useResultsDatabase } from "../components/resultsDatabase";
import {
  recordHistory,
  updateHistoryResults,
} from "../components/historyStore";
import type { DatabaseResult } from "./components/resultsRepo";

export default function Results() {
  const { keywords, source, verified } = useLocalSearchParams<{
    keywords: string;
    source?: SearchFilters["source"];
    verified?: string;
  }>();
  const list = useMemo(
    () => (keywords ?? "").split(",").filter(Boolean),
    [keywords],
  );
  const db = useResultsDatabase();
  const filters = useMemo<SearchFilters>(
    () => ({
      source: source === "open" || source === "closed" ? source : "all",
      verifiedOnly: verified === "true",
    }),
    [source, verified],
  );
  const handleResultsLoaded = useCallback(
    async (results: DatabaseResult[]) => {
      await updateHistoryResults(db, list, results.length > 0);
    },
    [db, list],
  );

  React.useEffect(() => {
    void recordHistory(db, list);
  }, [db, list]);

  return (
    <ResultsPage
      keywords={list}
      onBack={() => router.back()}
      onEditKeywords={() => router.back()}
      onAskAI={(results) =>
        router.push({
          pathname: "/ai-chat",
          params: {
            keywords: list.join(","),
            databases: JSON.stringify(results),
          },
        })
      }
      onResultsLoaded={handleResultsLoaded}
      filters={filters}
    />
  );
}
