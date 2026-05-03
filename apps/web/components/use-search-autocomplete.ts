"use client";

import { useEffect, useRef, useState } from "react";
import type { useRouter } from "next/navigation";

type RouterInstance = ReturnType<typeof useRouter>;

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchSuggestion = {
  type: "artist" | "track" | "genre";
  label: string;
  url: string;
};

export type SearchAutocompleteState = {
  searchValue: string;
  setSearchValue: (value: string) => void;
  suggestions: SearchSuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  activeSuggestionIdx: number;
  searchComboboxRef: React.RefObject<HTMLDivElement | null>;
  handleSearchInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSuggestionClick: (suggestion: SearchSuggestion) => void;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useSearchAutocomplete({
  currentVideoId,
  router,
}: {
  currentVideoId: string;
  router: RouterInstance;
}): SearchAutocompleteState {
  const [searchValue, setSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);

  const searchComboboxRef = useRef<HTMLDivElement | null>(null);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const latestSuggestQueryRef = useRef("");

  // Dismiss suggestions when clicking outside the combobox
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchComboboxRef.current && !searchComboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Clean up any pending debounce/abort on unmount.
  useEffect(() => {
    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }

      if (suggestAbortRef.current) {
        suggestAbortRef.current.abort();
        suggestAbortRef.current = null;
      }
    };
  }, []);

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchValue(value);
    setActiveSuggestionIdx(-1);

    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);

    const trimmed = value.trim();
    latestSuggestQueryRef.current = trimmed;

    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
      suggestAbortRef.current = null;
    }

    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    suggestDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json() as { suggestions: SearchSuggestion[] };
          if (latestSuggestQueryRef.current !== trimmed) {
            return;
          }
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // non-critical — ignore suggest failures silently
      } finally {
        if (suggestAbortRef.current === controller) {
          suggestAbortRef.current = null;
        }
      }
    }, 140);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const isOpen = showSuggestions && suggestions && suggestions.length > 0;

    if (e.key === "ArrowDown") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.min(prev + 1, suggestions!.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();

      // Only navigate to a suggestion when one is explicitly highlighted.
      if (isOpen && suggestions && activeSuggestionIdx >= 0) {
        const selected = suggestions[activeSuggestionIdx];
        if (selected) {
          handleSuggestionClick(selected);
          return;
        }
      }

      // No dropdown — search with the query text.
      if (searchValue.trim()) {
        router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideoId)}`);
        setShowSuggestions(false);
        setSearchValue("");
      }
    }
  }

  function handleSuggestionClick(suggestion: SearchSuggestion) {
    const url = suggestion.type === "track"
      ? suggestion.url
      : `${suggestion.url}?v=${encodeURIComponent(currentVideoId)}&resume=1`;
    setShowSuggestions(false);
    setSearchValue("");
    router.push(url);
  }

  return {
    searchValue,
    setSearchValue,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    activeSuggestionIdx,
    searchComboboxRef,
    handleSearchInput,
    handleSearchKeyDown,
    handleSuggestionClick,
  };
}
