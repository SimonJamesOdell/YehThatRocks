"use client";

import { useEffect, useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { dispatchAppEvent, EVENT_NAMES } from "@/lib/events-contract";
import { parseJsonOrNull } from "@/lib/parse-json";
import { readGenrePreferences, writeGenrePreferences } from "@/lib/genre-preference-store";
import {
  DEFAULT_AUTOPLAY_MIX,
  rebalanceAutoplayMix,
  normalizeAutoplayGenreFilters,
  normalizeAutoplayMix,
  type AutoplayMixKey,
  type AutoplayMixSettings,
} from "@/lib/player-preferences-shared";

type PlayerPreferencesResponse = {
  autoplayMix?: Partial<AutoplayMixSettings> | null;
  autoplayGenreFilters?: string[] | null;
};

type CategoriesResponse = {
  categories?: Array<{ genre?: string | null }>;
};

type AutoplaySettingsEditorProps = {
  title?: string;
  className?: string;
  onSaved?: () => void;
  /** When false, settings are read from / written to localStorage instead of the server. */
  isAuthenticated?: boolean;
};

const LOCAL_AUTOPLAY_MIX_KEY = "ytr:autoplay-mix";

function readLocalAutoplayMix(): AutoplayMixSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUTOPLAY_MIX };
  try {
    const raw = window.localStorage.getItem(LOCAL_AUTOPLAY_MIX_KEY);
    if (!raw) return { ...DEFAULT_AUTOPLAY_MIX };
    return normalizeAutoplayMix(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUTOPLAY_MIX };
  }
}

function writeLocalAutoplayMix(mix: AutoplayMixSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_AUTOPLAY_MIX_KEY, JSON.stringify(mix));
  } catch { /* best-effort */ }
}

const MIX_LABELS: Record<AutoplayMixKey, string> = {
  top100: "Top 100",
  favourites: "Favourites",
  newest: "New",
  random: "Random",
};

export function AutoplaySettingsEditor({
  title = "Sources",
  className,
  onSaved,
  isAuthenticated = false,
}: AutoplaySettingsEditorProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [mix, setMix] = useState<AutoplayMixSettings>({ ...DEFAULT_AUTOPLAY_MIX });
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [limitGenresEnabled, setLimitGenresEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      // ── Local-only path: read from localStorage ──
      if (!isAuthenticated) {
        if (cancelled) return;
        const localMix = readLocalAutoplayMix();
        const localGenres = readGenrePreferences() ?? [];
        const normalizedGenres = normalizeAutoplayGenreFilters(localGenres);

        // Also fetch categories for genre options (public endpoint, no auth needed).
        let nextOptions: string[] = [];
        try {
          const catRes = await fetch("/api/categories", { method: "GET", cache: "no-store" });
          const catPayload = catRes.ok ? await parseJsonOrNull<CategoriesResponse>(catRes) : null;
          nextOptions = [...new Set(
            (catPayload?.categories ?? [])
              .map((entry) => (typeof entry.genre === "string" ? entry.genre.trim().toLowerCase() : ""))
              .filter((genre) => genre.length > 0),
          )].sort((a, b) => a.localeCompare(b));
        } catch { /* options remain empty */ }

        if (cancelled) return;
        setMix(localMix);
        setSelectedGenres(normalizedGenres);
        setLimitGenresEnabled(normalizedGenres.length > 0);
        setGenreOptions(nextOptions);
        setIsLoading(false);
        return;
      }

      // ── Authenticated path: read from server ──
      try {
        const [prefsResponse, categoriesResponse] = await Promise.all([
          fetchWithAuthRetry("/api/player-preferences", {
            method: "GET",
            cache: "no-store",
          }),
          fetch("/api/categories", {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        if (!prefsResponse.ok) {
          throw new Error("Could not load your autoplay settings.");
        }

        const prefsPayload = await parseJsonOrNull<PlayerPreferencesResponse>(prefsResponse);
        const categoriesPayload = categoriesResponse.ok
          ? await parseJsonOrNull<CategoriesResponse>(categoriesResponse)
          : null;

        if (cancelled) {
          return;
        }

        const nextMix = normalizeAutoplayMix(prefsPayload?.autoplayMix ?? DEFAULT_AUTOPLAY_MIX);
        const nextGenres = normalizeAutoplayGenreFilters(prefsPayload?.autoplayGenreFilters ?? []);
        const nextOptions = [...new Set(
          (categoriesPayload?.categories ?? [])
            .map((entry) => (typeof entry.genre === "string" ? entry.genre.trim().toLowerCase() : ""))
            .filter((genre) => genre.length > 0),
        )].sort((a, b) => a.localeCompare(b));

        setMix(nextMix);
        setSelectedGenres(nextGenres);
        setLimitGenresEnabled(nextGenres.length > 0);
        setGenreOptions(nextOptions);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Could not load your autoplay settings.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const handleSliderChange = (key: AutoplayMixKey, value: number) => {
    setSavedMessage(null);
    setMix((current) => rebalanceAutoplayMix(current, key, value));
  };

  const handleToggleGenre = (genre: string) => {
    setSavedMessage(null);

    setSelectedGenres((current) => {
      if (current.includes(genre)) {
        return current.filter((entry) => entry !== genre);
      }

      if (current.length >= 24) {
        return current;
      }

      return [...current, genre];
    });
  };

  const handleReset = () => {
    setSavedMessage(null);
    setMix({ ...DEFAULT_AUTOPLAY_MIX });
    setSelectedGenres([]);
    setLimitGenresEnabled(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSavedMessage(null);
    setErrorMessage(null);

    const effectiveGenreFilters = limitGenresEnabled ? selectedGenres : [];

    // ── Local-only path: save to localStorage ──
    if (!isAuthenticated) {
      writeLocalAutoplayMix(mix);
      writeGenrePreferences(effectiveGenreFilters);
      dispatchAppEvent(EVENT_NAMES.AUTOPLAY_SETTINGS_UPDATED, null);
      setSavedMessage("Autoplay settings saved locally.");
      setIsSaving(false);
      onSaved?.();
      return;
    }

    // ── Authenticated path: save to server ──
    try {
      const response = await fetchWithAuthRetry("/api/player-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          autoplayMix: mix,
          autoplayGenreFilters: effectiveGenreFilters,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not save autoplay settings.");
      }

      dispatchAppEvent(EVENT_NAMES.AUTOPLAY_SETTINGS_UPDATED, null);
      setSavedMessage("Autoplay settings saved.");
      onSaved?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save autoplay settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className={className}><p className="autoplaySettingsStatus">Loading autoplay settings...</p></div>;
  }

  return (
    <div className={className}>
      <div className="autoplaySettingsPanel">
        <div className="autoplaySettingsHeader">
          <h3>{title}</h3>
        </div>

        <div className="autoplaySettingsMixGrid">
          {(Object.keys(MIX_LABELS) as AutoplayMixKey[]).map((key) => (
            <label key={key} className="autoplaySettingsSliderRow">
              <span>{MIX_LABELS[key]}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={mix[key]}
                onChange={(event) => {
                  handleSliderChange(key, Number(event.currentTarget.value));
                }}
              />
              <strong>{mix[key]}%</strong>
            </label>
          ))}
        </div>

        {genreOptions.length > 0 ? (
          <div className="autoplaySettingsGenres">
            <label className="autoplaySettingsGenreEnableRow">
              <input
                type="checkbox"
                checked={limitGenresEnabled}
                onChange={(event) => {
                  setLimitGenresEnabled(event.currentTarget.checked);
                }}
              />
              <span>Limit to selected genres</span>
            </label>

            {limitGenresEnabled ? (
              <div className="autoplaySettingsGenreGrid">
                {genreOptions.map((genre) => (
                  <label key={genre} className="autoplaySettingsGenreChip">
                    <input
                      type="checkbox"
                      checked={selectedGenres.includes(genre)}
                      onChange={() => {
                        handleToggleGenre(genre);
                      }}
                    />
                    <span>{genre}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {errorMessage ? (
          <p className="autoplaySettingsError">{errorMessage}</p>
        ) : null}

        {savedMessage ? (
          <p className="autoplaySettingsSaved">{savedMessage}</p>
        ) : null}

        <div className="autoplaySettingsActions">
          <button type="button" className="autoplaySettingsButtonSecondary" onClick={handleReset} disabled={isSaving}>Reset</button>
          <button type="button" className="autoplaySettingsButtonPrimary" onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save autoplay settings"}</button>
        </div>
      </div>
    </div>
  );
}
