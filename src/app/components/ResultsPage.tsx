import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Linking,
    Pressable,
    SafeAreaView,
    Text,
    View,
} from "react-native";
import { RESULT_COLORS, styles } from "../styles/results-page.styles";
import { COLORS } from "../styles/splash-page.styles";
import { DatabaseResult, getResultsForKeywords, refreshResultsForKeywords } from "./resultsRepo";
import { useResultsDatabase } from "../../components/resultsDatabase";
import type { SearchFilters } from "./SplashPage";

type Filter = "all" | "open" | "closed";
export type { SearchFilters };

type Props = {
  keywords: string[];
  fromCache?: boolean; // true when this set was loaded from SQLite instead of a fresh search
  onBack?: () => void;
  onEditKeywords?: () => void;
  onAskAI?: (results: DatabaseResult[]) => void;
  onResultsLoaded?: (results: DatabaseResult[]) => void;
  filters?: SearchFilters;
};

function timeAgo(ms: number): string {
  if (!ms) return "not yet verified";
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export default function ResultsPage({
  keywords,
  fromCache = true,
  onBack,
  onEditKeywords,
  onAskAI,
  onResultsLoaded,
  filters = { source: "all", verifiedOnly: false },
}: Props) {
  const db = useResultsDatabase();
  const [results, setResults] = useState<DatabaseResult[] | null>(null); // null = loading
  const [filter, setFilter] = useState<Filter>("all");
  const [loadedFromCache, setLoadedFromCache] = useState(fromCache);

  useEffect(() => {
    let cancelled = false;
    // Reset the loading state when the keyword set or database changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResults(null);
    if (!db) {
      setResults([]);
      return () => {
        cancelled = true;
      };
    }
    getResultsForKeywords(db, keywords)
    .then((rows) => {
      if (!cancelled) {
        setResults(rows);
        onResultsLoaded?.(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          onResultsLoaded?.([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, keywords, onResultsLoaded]);

  const visible = useMemo(() => {
    if (!results) return [];
    return results.filter((result) => {
      const sourceMatches =
        filters.source === "all" ||
        (filters.source === "open" && result.isOpenSource) ||
        (filters.source === "closed" && !result.isOpenSource);
      const verifiedMatches = !filters.verifiedOnly || result.verifiedAt > 0;
      const tabMatches =
        filter === "all" ||
        (filter === "open" && result.isOpenSource) ||
        (filter === "closed" && !result.isOpenSource);
      return sourceMatches && verifiedMatches && tabMatches;
    });
  }, [results, filter, filters]);

  const isEmpty = results !== null && results.length === 0;

  const searchAgain = async () => {
    if (!db) return;
    setResults(null);
    setLoadedFromCache(false);
    try {
      const rows = await refreshResultsForKeywords(db, keywords);
      setResults(rows);
      onResultsLoaded?.(rows);
    } catch {
      setResults([]);
      onResultsLoaded?.([]);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Pressable
              style={styles.backBtn}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.navy} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          </View>
          <Text style={styles.headerTitle}>
            {isEmpty ? "Results" : "Database discovery"}
          </Text>
          <View style={[styles.headerSide, styles.headerRight]}>
            <Ionicons name="book-outline" size={20} color={COLORS.navy} />
          </View>
        </View>

        {/* Keyword summary */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={COLORS.navy} />
          <Text style={styles.searchText} numberOfLines={1}>
            {keywords.join(", ")}
          </Text>
          <Pressable
            onPress={onEditKeywords}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Edit keywords"
          >
            <Ionicons name="close" size={18} color={COLORS.muted} />
          </Pressable>
        </View>
        <Pressable
          style={styles.searchAgainButton}
          onPress={() => void searchAgain()}
          accessibilityRole="button"
          accessibilityLabel="Search again"
        >
          <Ionicons name="refresh-outline" size={16} color={COLORS.navy} />
          <Text style={styles.searchAgainText}>Search Again</Text>
        </Pressable>

        {results === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.navy} />
          </View>
        ) : isEmpty ? (
          /* No results state */
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>
              No live databases found for these keywords.
            </Text>
            <Text style={styles.emptyBody}>
              Try broadening your keywords to discover more open-source and
              closed databases.
            </Text>
          </View>
        ) : (
          <>
            {/* Count + cache badge */}
            <View style={styles.metaRow}>
              <Text style={styles.count}>{results.length} databases found</Text>
              <View style={styles.cacheBadge}>
                <Text style={styles.cacheBadgeText}>
                  {loadedFromCache
                    ? "Offline cache · saved on device"
                    : "Fresh search · live data"}
                </Text>
              </View>
            </View>

            {/* Filters */}
            <View style={styles.filters}>
              {(
                [
                  ["all", "All"],
                  ["open", "Open source"],
                  ["closed", "Closed"],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  style={[styles.pill, filter === key && styles.pillActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === key }}
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.pillText,
                      filter === key && styles.pillTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Result cards */}
            <FlatList
              data={visible}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <Text style={styles.filterEmpty}>
                  No databases match this filter.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.card}
                  onPress={() => Linking.openURL(item.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`${item.name}, open website`}
                  accessibilityHint="Opens the database website"
                >
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <View
                    style={[
                      styles.badge,
                      item.isOpenSource ? styles.badgeOpen : styles.badgeClosed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        item.isOpenSource
                          ? styles.badgeTextOpen
                          : styles.badgeTextClosed,
                      ]}
                    >
                      {item.isOpenSource ? "Open source" : "Closed"}
                    </Text>
                  </View>
                  <Text style={styles.description}>{item.description}</Text>
                  <Text style={styles.source}>
                    {item.organization} · https://{hostOf(item.url)}
                  </Text>
                  <View style={styles.statusRow}>
                    <View
                      style={[
                        styles.liveDot,
                          {
                            backgroundColor:
                              item.verifiedAt > 0
                                ? RESULT_COLORS.live
                                : COLORS.muted,
                          },
                        ]}
                      />
                      <Text style={styles.statusText}>
                        {item.verifiedAt > 0
                          ? `Live · verified ${timeAgo(item.verifiedAt)}`
                          : "Offline cache · not live checked"}
                    </Text>
                  </View>
                  <Text style={styles.rankText}>
                    Rank {item.rank} · Relevance {item.relevance}%
                  </Text>
                </Pressable>
              )}
            />

            {/* Ask AI */}
            <Pressable
              style={styles.aiBar}
                    onPress={() => onAskAI?.(visible)}
              accessibilityRole="button"
              accessibilityLabel="Ask AI about these databases"
            >
              <View style={styles.aiIcon}>
                <Ionicons name="sparkles" size={18} color={COLORS.white} />
              </View>
              <View style={styles.aiTextWrap}>
                <Text style={styles.aiTitle}>Ask AI about these databases</Text>
                <Text style={styles.aiSub}>
                  Get summaries, compare access rules, and generate follow-up
                  questions.
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
