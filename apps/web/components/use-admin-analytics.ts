/**
 * Admin Analytics Hook
 * Handles analytics visualization state, filtering, and chart computation
 */

import { useCallback, useMemo, useState } from "react";
import { AnalyticsBucket, AnalyticsZoomLevel, MapDateRange, DashboardPayload } from "@/components/admin-dashboard-types";
import { readJson, readNoStoreJson } from "@/components/admin-dashboard-utils";

export function useAdminAnalytics() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);
  const [analyticsZoomLevel, setAnalyticsZoomLevel] = useState<AnalyticsZoomLevel>("daily");
  const [selectedAllTimeBucket, setSelectedAllTimeBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedMonthlyBucket, setSelectedMonthlyBucket] = useState<AnalyticsBucket | null>(null);
  const [selectedWeeklyBucket, setSelectedWeeklyBucket] = useState<AnalyticsBucket | null>(null);
  const [mapDateRange, setMapDateRange] = useState<MapDateRange>("allTime");
  const [showHostMetricsGraph, setShowHostMetricsGraph] = useState(false);
  const [analyticsSeriesOn, setAnalyticsSeriesOn] = useState({
    pageViews: true,
    videoViews: true,
    visitors: true,
    returnVisits: true,
    magazineExternalLandings: true,
    authEvents: true,
  });
  const [hostMetricSeriesOn, setHostMetricSeriesOn] = useState({
    cpu: true,
    memory: true,
    swap: true,
    disk: true,
    network: true,
  });

  const loadOverview = useCallback(async (forceRefresh = false) => {
    const query = forceRefresh ? `?refresh=1&t=${Date.now()}` : "";
    const url = `/api/admin/dashboard${query}`;
    const dashboardPayload = forceRefresh
      ? await readNoStoreJson<DashboardPayload>(url)
      : await readJson<DashboardPayload>(url);
    setDashboard(dashboardPayload);
  }, []);

  const refreshOverviewAnalytics = useCallback(async () => {
    setRefreshingAnalytics(true);
    try {
      await loadOverview(true);
    } finally {
      setRefreshingAnalytics(false);
    }
  }, [loadOverview]);

  // Memoized derived data for analytics filtering
  const filterBucketsWithinRange = useCallback(
    (rows: AnalyticsBucket[], range: AnalyticsBucket | null) => {
      if (!range) {
        return rows;
      }
      const filtered = rows.filter((row) => row.bucketStart >= range.bucketStart && row.bucketEnd <= range.bucketEnd);
      return filtered.length > 0 ? filtered : rows;
    },
    []
  );

  const analyticsSeries = dashboard?.analytics.series;

  const hourlySeries = useMemo(() => {
    const recent = (dashboard?.analytics.hourlyRecent ?? []).slice(-24);
    return recent.map((row) => {
      const bucketStartDate = new Date(row.bucketStart);
      const bucketEndDate = new Date(bucketStartDate.getTime() + 60 * 60 * 1000);
      return {
        bucketStart: row.bucketStart,
        bucketEnd: bucketEndDate.toISOString(),
        label: bucketStartDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        pageViews: row.pageViews,
        videoViews: row.videoViews,
        uniqueVisitors: row.uniqueVisitors,
        returnVisits: row.returnVisits,
        magazineExternalLandings: 0,
        authEvents: row.authEvents,
      } as AnalyticsBucket;
    });
  }, [dashboard]);

  const displayedAnalyticsRows = useMemo(() => {
    if (!analyticsSeries) {
      return [] as AnalyticsBucket[];
    }

    if (analyticsZoomLevel === "allTime") {
      return analyticsSeries.allTime;
    }

    if (analyticsZoomLevel === "monthly") {
      return filterBucketsWithinRange(analyticsSeries.monthly, selectedAllTimeBucket);
    }

    if (analyticsZoomLevel === "weekly") {
      return filterBucketsWithinRange(analyticsSeries.weekly, selectedMonthlyBucket);
    }

    if (analyticsZoomLevel === "hourly") {
      return hourlySeries;
    }

    return filterBucketsWithinRange(analyticsSeries.daily, selectedWeeklyBucket);
  }, [analyticsSeries, analyticsZoomLevel, selectedAllTimeBucket, selectedMonthlyBucket, selectedWeeklyBucket, hourlySeries, filterBucketsWithinRange]);

  return {
    // Data
    dashboard,
    // UI State
    analyticsZoomLevel,
    selectedAllTimeBucket,
    selectedMonthlyBucket,
    selectedWeeklyBucket,
    mapDateRange,
    showHostMetricsGraph,
    analyticsSeriesOn,
    hostMetricSeriesOn,
    refreshingAnalytics,
    // Derived data
    displayedAnalyticsRows,
    analyticsSeries,
    hourlySeries,
    // Setters
    setAnalyticsZoomLevel,
    setSelectedAllTimeBucket,
    setSelectedMonthlyBucket,
    setSelectedWeeklyBucket,
    setMapDateRange,
    setShowHostMetricsGraph,
    setAnalyticsSeriesOn,
    setHostMetricSeriesOn,
    // Actions
    loadOverview,
    refreshOverviewAnalytics,
  };
}
