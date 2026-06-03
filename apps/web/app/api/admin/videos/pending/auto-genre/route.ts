import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withAuthAndBody } from "@/lib/api-route-pipeline";
import { suggestGenreForVideo } from "@/lib/admin-pending-video-enrichment";

const autoGenreSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
});

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, autoGenreSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.pending.moderate",
  });

  if (!result.ok) {
    return result.response;
  }

  const { videoId } = result.data;
  const suggestion = await suggestGenreForVideo(videoId);

  return NextResponse.json({
    ok: true,
    videoId,
    suggestion,
  });
}
