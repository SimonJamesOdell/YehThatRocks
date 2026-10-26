import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminDashboardOverviewTab } from "@/components/admin-dashboard-overview-tab";
import { buildAnalyticsGraph } from "@/components/admin-dashboard-graph-builders";
import type { AnalyticsBucket } from "@/components/admin-dashboard-types";

function buildAnalyticsRows(): AnalyticsBucket[] {
  return [
    {
      bucketStart: "2026-10-24T00:00:00.000Z",
      bucketEnd: "2026-10-25T00:00:00.000Z",
      label: "24 Oct",
      pageViews: 10,
      videoViews: 5,
      uniqueVisitors: 4,
      newVisitors: 2,
      returnVisits: 2,
      sessions: 6,
      magazineExternalLandings: 0,
      authEvents: 1,
    },
    {
      bucketStart: "2026-10-25T00:00:00.000Z",
      bucketEnd: "2026-10-26T00:00:00.000Z",
      label: "25 Oct",
      pageViews: 12,
      videoViews: 6,
      uniqueVisitors: 5,
      newVisitors: 1,
      returnVisits: 4,
      sessions: 7,
      magazineExternalLandings: 0,
      authEvents: 2,
    },
  ];
}

function buildBaseProps() {
  const analyticsSeriesOn = {
    pageViews: true,
    videoViews: true,
    visitors: true,
    newVisitors: true,
    returnVisits: true,
    sessions: true,
    magazineExternalLandings: true,
    authEvents: true,
  };

  return {
    dashboard: null,
    cpuAvgPeakText: "",
    showHostMetricsGraph: false,
    onToggleShowHostMetricsGraph: vi.fn(),
    hostMetricSeriesOn: {
      cpu: true,
      memory: true,
      swap: true,
      disk: true,
      network: true,
    },
    onToggleHostMetricSeries: vi.fn(),
    hostMetricRowsLength: 0,
    hostMetricsGraph: {
      width: 680,
      height: 220,
      axis: { paddingLeft: 46, paddingRight: 20, paddingTop: 14, paddingBottom: 28 },
      yTicks: [] as Array<{ y: number; value: number }>,
      xTicks: [] as Array<{ x: number; label: string }>,
      cpuPath: "",
      memoryPath: "",
      swapPath: "",
      diskPath: "",
      networkPath: "",
    },
    analyticsZoomLevel: "monthly" as const,
    onSelectAnalyticsZoom: vi.fn(),
    refreshingAnalytics: false,
    onRefreshOverviewAnalytics: vi.fn(),
    analyticsSeriesOn,
    onToggleAnalyticsSeries: vi.fn(),
    analyticsGraph: buildAnalyticsGraph(buildAnalyticsRows(), analyticsSeriesOn),
    onSelectAnalyticsPoint: vi.fn(),
    trafficEditEnabled: false,
    onToggleTrafficEdit: vi.fn(),
    onAdjustTrafficPoint: vi.fn(),
  };
}

describe("AdminDashboardOverviewTab traffic editing", () => {
  it("renders the Edit traffic button", () => {
    render(React.createElement(AdminDashboardOverviewTab, buildBaseProps()));

    const toggle = screen.getByTestId("traffic-edit-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent("Edit traffic");
  });

  it("wires the Edit traffic button to onToggleTrafficEdit", () => {
    const onToggleTrafficEdit = vi.fn();
    const props = { ...buildBaseProps(), onToggleTrafficEdit };

    render(React.createElement(AdminDashboardOverviewTab, props));

    fireEvent.click(screen.getByTestId("traffic-edit-toggle"));
    expect(onToggleTrafficEdit).toHaveBeenCalledTimes(1);
  });

  it("shows editing state and drag handles when traffic editing is enabled", () => {
    const props = { ...buildBaseProps(), trafficEditEnabled: true };

    render(React.createElement(AdminDashboardOverviewTab, props));

    expect(screen.getByTestId("traffic-edit-toggle")).toHaveTextContent("Editing traffic ✓");
    expect(screen.getByTestId("traffic-edit-toggle")).toHaveAttribute("aria-pressed", "true");

    for (const key of [
      "pageViews",
      "videoViews",
      "visitors",
      "newVisitors",
      "returnVisits",
      "sessions",
      "magazineExternalLandings",
      "authEvents",
    ]) {
      expect(screen.getAllByTestId(`traffic-handle-${key}`).length).toBeGreaterThan(0);
    }
  });

  it("does not render drag handles while traffic editing is disabled", () => {
    render(React.createElement(AdminDashboardOverviewTab, buildBaseProps()));

    expect(screen.queryByTestId("traffic-handle-pageViews")).not.toBeInTheDocument();
  });

  it("marks the toggle as not pressed when editing is disabled", () => {
    render(React.createElement(AdminDashboardOverviewTab, buildBaseProps()));

    expect(screen.getByTestId("traffic-edit-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});
