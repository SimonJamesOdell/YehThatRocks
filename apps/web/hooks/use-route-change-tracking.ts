import { useEffect, useRef } from "react";

type UseRouteChangeTrackingOptions = {
  pathname: string;
  onPathnameChange: (pathname: string) => void;
  onAnalyticsPageView: () => Promise<void>;
  onAnalyticsVideoView: (videoId: string) => Promise<void>;
  activeVideoId: string;
};

export function useRouteChangeTracking({
  pathname,
  onPathnameChange,
  onAnalyticsPageView,
  onAnalyticsVideoView,
  activeVideoId,
}: UseRouteChangeTrackingOptions): void {
  const previousPathnameRef = useRef<string | null>(null);
  const analyticsLastPathnameRef = useRef<string | null>(null);
  const analyticsLastVideoIdRef = useRef<string | null>(null);

  // Track pathname changes
  useEffect(() => {
    previousPathnameRef.current = pathname;
    onPathnameChange(pathname);
  }, [pathname, onPathnameChange]);

  // Analytics: fire page_view on initial load and every route path change
  useEffect(() => {
    if (!pathname || analyticsLastPathnameRef.current === pathname) {
      return;
    }
    analyticsLastPathnameRef.current = pathname;
    void onAnalyticsPageView();
  }, [pathname, onAnalyticsPageView]);

  // Analytics: fire video_view each time the active video changes
  useEffect(() => {
    if (activeVideoId && activeVideoId !== analyticsLastVideoIdRef.current) {
      analyticsLastVideoIdRef.current = activeVideoId;
      void onAnalyticsVideoView(activeVideoId);
    }
  }, [activeVideoId, onAnalyticsVideoView]);
}
