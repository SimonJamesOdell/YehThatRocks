"use client";

import { useEffect } from "react";

const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
const YOUTUBE_IFRAME_API_ID = "youtube-iframe-api";

export function YouTubeIframeApiLoader() {
  useEffect(() => {
    if (("YT" in window && Boolean((window as Window & { YT?: unknown }).YT)) || document.getElementById(YOUTUBE_IFRAME_API_ID)) {
      return;
    }

    const script = document.createElement("script");
    script.id = YOUTUBE_IFRAME_API_ID;
    script.src = YOUTUBE_IFRAME_API_URL;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return null;
}
