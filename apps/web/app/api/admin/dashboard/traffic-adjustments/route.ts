import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyTrafficEdit, patchCachedTrafficValue } from "@/lib/admin-traffic-editor";
import { withAuthAndBody } from "@/lib/api-route-pipeline";
import {
  TRAFFIC_ADJUSTMENT_SERIES_KEYS,
  type TrafficAdjustmentGranularity,
  type TrafficAdjustmentSeries,
} from "@/components/admin-dashboard-types";

const TRAFFIC_GRANULARITIES = ["allTime", "monthly", "weekly", "daily", "hourly"] as const;

const bodySchema = z.object({
  granularity: z.enum(TRAFFIC_GRANULARITIES),
  series: z.enum(TRAFFIC_ADJUSTMENT_SERIES_KEYS),
  bucketStart: z.string().trim().min(1).max(64),
  bucketEnd: z.string().trim().max(64),
  targetValue: z.number().int().min(0).max(1_000_000_000),
});

// Hourly rollups only carry a subset of the series. Everything else is editable.
const HOURLY_EDITABLE_SERIES = new Set<TrafficAdjustmentSeries>([
  "pageViews",
  "videoViews",
  "visitors",
  "returnVisits",
  "authEvents",
]);

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, bodySchema);

  if (!result.ok) {
    return result.response;
  }

  const { granularity, series, bucketStart, bucketEnd, targetValue } = result.data;

  if (granularity === "hourly" && !HOURLY_EDITABLE_SERIES.has(series as TrafficAdjustmentSeries)) {
    return NextResponse.json(
      { error: "That traffic series is not available at hourly granularity." },
      { status: 400 },
    );
  }

  try {
    const edit = await applyTrafficEdit({
      granularity: granularity as TrafficAdjustmentGranularity,
      series: series as TrafficAdjustmentSeries,
      bucketStart,
      bucketEnd,
      targetValue,
    });

    await patchCachedTrafficValue({
      granularity: granularity as TrafficAdjustmentGranularity,
      bucketStart,
      series: series as TrafficAdjustmentSeries,
      value: edit.value,
    });

    return NextResponse.json({ ok: true, value: edit.value });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Traffic edit failed." },
      { status: 500 },
    );
  }
}
