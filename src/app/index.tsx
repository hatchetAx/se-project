import { router } from "expo-router";
import React from "react";
import SplashPage, { SearchFilters } from "./components/SplashPage";

export default function Index() {
  return (
    <SplashPage
      onSearch={(keywords, filters: SearchFilters) =>
        router.push({
          pathname: "/results",
          params: {
            keywords: keywords.join(","),
            source: filters.source,
            verified: String(filters.verifiedOnly),
          },
        })
      }
      onHistory={() => router.push("/history")}
    />
  );
}
