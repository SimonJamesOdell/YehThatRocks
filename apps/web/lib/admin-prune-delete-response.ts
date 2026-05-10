import { NextResponse } from "next/server";

type AdminPruneResult = {
  pruned: boolean;
  deletedVideoRows: number;
  reason: string;
};

type AdminPruneDeleteResponse = {
  deleted: boolean;
  response: NextResponse;
};

export function mapAdminPruneResultToDeleteResponse(
  pruneResult: AdminPruneResult,
  successBody: Record<string, unknown>,
): AdminPruneDeleteResponse {
  if (pruneResult.reason === "not-found") {
    return {
      deleted: false,
      response: NextResponse.json({ error: "Video not found" }, { status: 404 }),
    };
  }

  if (!pruneResult.pruned) {
    return {
      deleted: false,
      response: NextResponse.json({ error: "Could not delete video", reason: pruneResult.reason }, { status: 409 }),
    };
  }

  return {
    deleted: true,
    response: NextResponse.json(successBody),
  };
}
