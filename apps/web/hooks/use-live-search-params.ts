"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EVENT_NAMES } from "@/lib/events-contract";
export const LIVE_SEARCH_PARAMS_EVENT = EVENT_NAMES.URL_SEARCH_PARAMS_CHANGED;

function readWindowSearchParams(fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;
}

export function useLiveSearchParams() {
  const nextSearchParams = useSearchParams();
  const nextSearchParamsKey = nextSearchParams.toString();
  const [searchParamsKey, setSearchParamsKey] = useState(() => readWindowSearchParams(nextSearchParamsKey));

  useEffect(() => {
    setSearchParamsKey(readWindowSearchParams(nextSearchParamsKey));
  }, [nextSearchParamsKey]);

  useEffect(() => {
    const syncSearchParams = () => {
      setSearchParamsKey(readWindowSearchParams(nextSearchParamsKey));
    };

    window.addEventListener("popstate", syncSearchParams);
    window.addEventListener(LIVE_SEARCH_PARAMS_EVENT, syncSearchParams as EventListener);

    return () => {
      window.removeEventListener("popstate", syncSearchParams);
      window.removeEventListener(LIVE_SEARCH_PARAMS_EVENT, syncSearchParams as EventListener);
    };
  }, [nextSearchParamsKey]);

  return useMemo(() => new URLSearchParams(searchParamsKey), [searchParamsKey]);
}