import { finiteOrNull } from "@/components/admin-dashboard-utils";
import type { AnalyticsBucket, DashboardPayload } from "@/components/admin-dashboard-types";

type HostMetricRow = DashboardPayload["hostMetrics"]["minute"][number];

type AnalyticsSeriesOn = {
  pageViews: boolean;
  videoViews: boolean;
  visitors: boolean;
  returnVisits: boolean;
  magazineExternalLandings: boolean;
  authEvents: boolean;
};

export function filterBucketsWithinRange(rows: AnalyticsBucket[], range: AnalyticsBucket | null) {
  if (!range) {
    return rows;
  }

  const filtered = rows.filter((row) => row.bucketStart >= range.bucketStart && row.bucketEnd <= range.bucketEnd);
  return filtered.length > 0 ? filtered : rows;
}

export function buildAnalyticsGraph(displayedAnalyticsRows: AnalyticsBucket[], analyticsSeriesOn: AnalyticsSeriesOn) {
  const width = 680;
  const height = 220;
  const paddingLeft = 46;
  const paddingRight = 20;
  const paddingTop = 14;
  const paddingBottom = 46;

  if (displayedAnalyticsRows.length === 0) {
    return {
      width,
      height,
      pageViewsPath: "",
      videoViewsPath: "",
      visitorsPath: "",
      returnVisitsPath: "",
      magazineExternalLandingsPath: "",
      authEventsPath: "",
      yTicks: [] as Array<{ y: number; value: number }>,
      xTicks: [] as Array<{ x: number; label: string }>,
      points: [] as Array<{
        x: number;
        yPageViews: number;
        yVideoViews: number;
        yVisitors: number;
        yReturnVisits: number;
        yMagazineExternalLandings: number;
        yAuthEvents: number;
        bucketStart: string;
        bucketEnd: string;
        label: string;
        pageViews: number;
        videoViews: number;
        uniqueVisitors: number;
        returnVisits: number;
        magazineExternalLandings: number;
        authEvents: number;
      }>,
      axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
    };
  }

  const enabledSeriesMaxPerDay = (row: AnalyticsBucket) => Math.max(
    analyticsSeriesOn.pageViews ? row.pageViews : 0,
    analyticsSeriesOn.videoViews ? row.videoViews : 0,
    analyticsSeriesOn.visitors ? row.uniqueVisitors : 0,
    analyticsSeriesOn.returnVisits ? row.returnVisits : 0,
    analyticsSeriesOn.magazineExternalLandings ? row.magazineExternalLandings : 0,
    analyticsSeriesOn.authEvents ? row.authEvents : 0,
  );

  const maxVal = Math.max(1, ...displayedAnalyticsRows.map((row) => enabledSeriesMaxPerDay(row)));
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const step = displayedAnalyticsRows.length > 1 ? chartWidth / (displayedAnalyticsRows.length - 1) : 0;

  const points = displayedAnalyticsRows.map((item, index) => {
    const x = paddingLeft + index * step;
    return {
      x,
      yPageViews: paddingTop + chartHeight - (item.pageViews / maxVal) * chartHeight,
      yVideoViews: paddingTop + chartHeight - (item.videoViews / maxVal) * chartHeight,
      yVisitors: paddingTop + chartHeight - (item.uniqueVisitors / maxVal) * chartHeight,
      yReturnVisits: paddingTop + chartHeight - (item.returnVisits / maxVal) * chartHeight,
      yMagazineExternalLandings: paddingTop + chartHeight - (item.magazineExternalLandings / maxVal) * chartHeight,
      yAuthEvents: paddingTop + chartHeight - (item.authEvents / maxVal) * chartHeight,
      bucketStart: item.bucketStart,
      bucketEnd: item.bucketEnd,
      label: item.label,
      pageViews: item.pageViews,
      videoViews: item.videoViews,
      uniqueVisitors: item.uniqueVisitors,
      returnVisits: item.returnVisits,
      magazineExternalLandings: item.magazineExternalLandings,
      authEvents: item.authEvents,
    };
  });

  const makePath = (ys: number[]) =>
    ys.map((y, index) => `${index === 0 ? "M" : "L"} ${(paddingLeft + index * step).toFixed(2)} ${y.toFixed(2)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: paddingTop + chartHeight - ratio * chartHeight,
    value: Math.round(maxVal * ratio),
  }));

  const tickCount = Math.min(6, points.length);
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const pointIndex = tickCount === 1 ? 0 : Math.round((index / (tickCount - 1)) * (points.length - 1));
    const point = points[pointIndex];

    return {
      x: point.x,
      label: point.label,
    };
  });

  return {
    width,
    height,
    yTicks,
    xTicks,
    points,
    axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
    pageViewsPath: makePath(points.map((point) => point.yPageViews)),
    videoViewsPath: makePath(points.map((point) => point.yVideoViews)),
    visitorsPath: makePath(points.map((point) => point.yVisitors)),
    returnVisitsPath: makePath(points.map((point) => point.yReturnVisits)),
    magazineExternalLandingsPath: makePath(points.map((point) => point.yMagazineExternalLandings)),
    authEventsPath: makePath(points.map((point) => point.yAuthEvents)),
  };
}

export function buildHostMetricsGraph(hostMetricRows: HostMetricRow[]) {
  const width = 680;
  const height = 220;
  const paddingLeft = 46;
  const paddingRight = 20;
  const paddingTop = 14;
  const paddingBottom = 28;

  if (hostMetricRows.length === 0) {
    return {
      width,
      height,
      axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
      cpuPath: "",
      memoryPath: "",
      swapPath: "",
      diskPath: "",
      networkPath: "",
      xTicks: [] as Array<{ x: number; label: string }>,
      yTicks: [] as Array<{ y: number; value: number }>,
    };
  }

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const percentToY = (value: number) => paddingTop + chartHeight - (Math.max(0, Math.min(100, value)) / 100) * chartHeight;
  const xForIndex = (index: number) => {
    if (hostMetricRows.length === 1) {
      return paddingLeft + chartWidth / 2;
    }

    return paddingLeft + (index / (hostMetricRows.length - 1)) * chartWidth;
  };

  const points = hostMetricRows.map((row, index) => ({
    x: xForIndex(index),
    cpu: finiteOrNull(row.cpuUsagePercent),
    memory: finiteOrNull(row.memoryUsagePercent),
    swap: finiteOrNull(row.swapUsagePercent),
    disk: finiteOrNull(row.diskUsagePercent),
    network: finiteOrNull(row.networkUsagePercent),
    bucketStart: row.bucketStart,
  }));

  const makePath = (values: Array<number | null>) => {
    let path = "";

    values.forEach((value, index) => {
      if (value === null) {
        return;
      }

      const command = path === "" || values[index - 1] === null ? "M" : "L";
      path += `${command}${points[index].x.toFixed(1)},${percentToY(value).toFixed(1)}`;
    });

    return path;
  };

  const tickCount = Math.min(6, hostMetricRows.length);
  const xTicks = Array.from({ length: tickCount }, (_, tickIndex) => {
    const rowIndex = tickCount === 1
      ? 0
      : Math.round((tickIndex / (tickCount - 1)) * (hostMetricRows.length - 1));
    const row = hostMetricRows[rowIndex];
    const date = new Date(row.bucketStart);
    const label = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return {
      x: xForIndex(rowIndex),
      label,
    };
  });

  const yTicks = [0, 25, 50, 75, 100].map((value) => ({
    value,
    y: percentToY(value),
  }));

  return {
    width,
    height,
    axis: { paddingLeft, paddingRight, paddingTop, paddingBottom },
    cpuPath: makePath(points.map((point) => point.cpu)),
    memoryPath: makePath(points.map((point) => point.memory)),
    swapPath: makePath(points.map((point) => point.swap)),
    diskPath: makePath(points.map((point) => point.disk)),
    networkPath: makePath(points.map((point) => point.network)),
    xTicks,
    yTicks,
  };
}
