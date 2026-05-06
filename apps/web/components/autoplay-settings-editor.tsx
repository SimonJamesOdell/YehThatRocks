"use client";

import { useEffect, useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { dispatchAppEvent, EVENT_NAMES } from "@/lib/events-contract";
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
};

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

        const prefsPayload = (await prefsResponse.json().catch(() => null)) as PlayerPreferencesResponse | null;
        const categoriesPayload = categoriesResponse.ok
          ? ((await categoriesResponse.json().catch(() => null)) as CategoriesResponse | null)
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
  }, []);

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

    try {
      const response = await fetchWithAuthRetry("/api/player-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          autoplayMix: mix,
          autoplayGenreFilters: limitGenresEnabled ? selectedGenres : [],
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

        <div className="autoplaySettingsGenres">
          <label className="autoplaySettingsGenresToggle">
            <input
              type="checkbox"
              checked={limitGenresEnabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setLimitGenresEnabled(enabled);
                setSavedMessage(null);
                if (!enabled) {
                  setSelectedGenres([]);
                }
              }}
            />
            <span>Limit genres</span>
          </label>
          {limitGenresEnabled ? (
            genreOptions.length === 0 ? (
              <p className="autoplaySettingsStatus">No genres available right now.</p>
            ) : (
              <div className="autoplaySettingsGenreGrid">
                {genreOptions.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    className={selectedGenres.includes(genre) ? "autoplaySettingsGenreChip autoplaySettingsGenreChipActive" : "autoplaySettingsGenreChip"}
                    onClick={() => handleToggleGenre(genre)}
                    aria-pressed={selectedGenres.includes(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>

        <div className="autoplaySettingsActions">
          <button type="button" className="autoplaySettingsButtonSecondary" onClick={handleReset} disabled={isSaving}>Reset</button>
          <button type="button" className="autoplaySettingsButtonPrimary" onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save autoplay settings"}</button>
        </div>

        {savedMessage ? <p className="autoplaySettingsStatus">{savedMessage}</p> : null}
        {errorMessage ? <p className="autoplaySettingsStatus autoplaySettingsStatusError">{errorMessage}</p> : null}
      </div>
    </div>
  );
}
