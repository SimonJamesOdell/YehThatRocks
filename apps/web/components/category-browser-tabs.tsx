"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CATEGORY_ARTISTS_CACHE_EVENT,
  readCategoryArtistsFirstPayloadFromSessionCache,
  readCategoryArtistsFullPayloadFromCache,
} from "@/lib/category-artists-session-cache";
import { readCategoryArtistsTab, writeCategoryArtistsTab } from "@/lib/category-artists-tab-state";
import { buildCategoryArtistTabs } from "@/lib/category-artists-tabs";

type CategoryBrowserTabsProps = {
  genre: string;
  slug: string;
};

export function CategoryBrowserTabs({ genre, slug }: CategoryBrowserTabsProps) {
  const [selectedTab, setSelectedTab] = useState("all");
  const [tabCounts, setTabCounts] = useState<Record<string, number> | null>(null);

  const availableTabs = useMemo(
    () => buildCategoryArtistTabs(genre).filter((tab) => {
      if (tab.id === "all") {
        return true;
      }

      const count = tabCounts?.[tab.id];
      return typeof count !== "number" || count > 0;
    }),
    [genre, tabCounts],
  );

  useEffect(() => {
    setSelectedTab(readCategoryArtistsTab(slug));

    const cachedTabs = readCategoryArtistsFullPayloadFromCache(slug)?.tabCounts
      ?? readCategoryArtistsFirstPayloadFromSessionCache(slug)?.tabCounts
      ?? null;
    setTabCounts(cachedTabs);
  }, [slug]);

  useEffect(() => {
    const handleCacheUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string }>;
      if (customEvent.detail?.slug !== slug) {
        return;
      }

      const cachedTabs = readCategoryArtistsFullPayloadFromCache(slug)?.tabCounts
        ?? readCategoryArtistsFirstPayloadFromSessionCache(slug)?.tabCounts
        ?? null;
      setTabCounts(cachedTabs);
    };

    window.addEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    return () => {
      window.removeEventListener(CATEGORY_ARTISTS_CACHE_EVENT, handleCacheUpdate as EventListener);
    };
  }, [slug]);

  return (
    <div className="categoryTabsSticky" role="tablist" aria-label="Category artist groups">
      <div className="categoriesBucketTabs">
        {availableTabs.map((tab) => {
          const isActive = selectedTab === tab.id;
          const tabCount = tabCounts?.[tab.id];

          return (
            <button
              key={tab.id}
              type="button"
              className={`categoriesBucketTab${isActive ? " categoriesBucketTabActive" : ""}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setSelectedTab(tab.id);
                writeCategoryArtistsTab(slug, tab.id);
              }}
            >
              <span>{tab.label}</span>
              {typeof tabCount === "number" ? (
                <span className="categoriesBucketTabCount">{tabCount.toLocaleString("en-US")}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
