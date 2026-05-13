"use client";

import type { ChangeEventHandler, KeyboardEventHandler, MutableRefObject } from "react";

import type { SearchSuggestion } from "@/components/use-search-autocomplete";

type ShellSearchBarProps = {
  searchComboboxRef: MutableRefObject<HTMLDivElement | null>;
  showSuggestions: boolean;
  searchValue: string;
  suggestions: SearchSuggestion[];
  activeSuggestionIdx: number;
  onSearchInput: ChangeEventHandler<HTMLInputElement>;
  onSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onSearchFocus: () => void;
  onSuggestionClick: (suggestion: SearchSuggestion) => void;
  onSearchSubmit: () => void;
};

export function ShellSearchBar({
  searchComboboxRef,
  showSuggestions,
  searchValue,
  suggestions,
  activeSuggestionIdx,
  onSearchInput,
  onSearchKeyDown,
  onSearchFocus,
  onSuggestionClick,
  onSearchSubmit,
}: ShellSearchBarProps) {
  return (
    <div className="searchWrap">
      <div className="searchBar">
        <div className="searchCombobox" ref={searchComboboxRef} role="combobox" aria-expanded={showSuggestions} aria-haspopup="listbox">
          <input
            id="search"
            type="search"
            placeholder="Search rock, metal, artists..."
            required
            autoComplete="off"
            value={searchValue}
            onChange={onSearchInput}
            onKeyDown={onSearchKeyDown}
            onFocus={onSearchFocus}
            aria-expanded={showSuggestions}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
            aria-activedescendant={activeSuggestionIdx >= 0 ? `search-suggestion-${activeSuggestionIdx}` : undefined}
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="searchSuggestions" id="search-suggestions" role="listbox">
              {suggestions.map((suggestion, index) => (
                <li key={`${suggestion.type}-${suggestion.label}`} role="option" aria-selected={index === activeSuggestionIdx}>
                  <button
                    type="button"
                    id={`search-suggestion-${index}`}
                    className="searchSuggestionItem"
                    aria-selected={index === activeSuggestionIdx}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      onSuggestionClick(suggestion);
                    }}
                  >
                    <span className="searchSuggestionType">{suggestion.type}</span>
                    <span className="searchSuggestionLabel">{suggestion.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={onSearchSubmit}>
          Search
        </button>
        <label className="searchLabel srOnly" htmlFor="search">
          Search artists, tracks, and chaos
        </label>
      </div>
    </div>
  );
}
