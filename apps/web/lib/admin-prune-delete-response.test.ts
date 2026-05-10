import { describe, expect, it } from "vitest";

import { mapAdminPruneResultToDeleteResponse } from "@/lib/admin-prune-delete-response";

describe("mapAdminPruneResultToDeleteResponse", () => {
  it("returns hard-delete success payload for admin videos delete flow", async () => {
    const result = mapAdminPruneResultToDeleteResponse(
      {
        pruned: true,
        deletedVideoRows: 3,
        reason: "admin-hard-delete",
      },
      {
        ok: true,
        deletedVideoRows: 3,
      },
    );

    expect(result.deleted).toBe(true);
    expect(result.response.status).toBe(200);
    await expect(result.response.json()).resolves.toEqual({
      ok: true,
      deletedVideoRows: 3,
    });
  });

  it("returns pending-remove success payload for admin pending delete flow", async () => {
    const result = mapAdminPruneResultToDeleteResponse(
      {
        pruned: true,
        deletedVideoRows: 2,
        reason: "admin-pending-remove",
      },
      {
        ok: true,
        videoId: "abc123def45",
        action: "remove",
        deletedVideoRows: 2,
      },
    );

    expect(result.deleted).toBe(true);
    expect(result.response.status).toBe(200);
    await expect(result.response.json()).resolves.toEqual({
      ok: true,
      videoId: "abc123def45",
      action: "remove",
      deletedVideoRows: 2,
    });
  });

  it("maps not-found prune result to 404 with exact error payload", async () => {
    const result = mapAdminPruneResultToDeleteResponse(
      {
        pruned: false,
        deletedVideoRows: 0,
        reason: "not-found",
      },
      {
        ok: true,
        deletedVideoRows: 0,
      },
    );

    expect(result.deleted).toBe(false);
    expect(result.response.status).toBe(404);
    await expect(result.response.json()).resolves.toEqual({ error: "Video not found" });
  });

  it("maps prune failures to 409 with exact reason payload", async () => {
    const result = mapAdminPruneResultToDeleteResponse(
      {
        pruned: false,
        deletedVideoRows: 0,
        reason: "fk-constraint-delete-failed",
      },
      {
        ok: true,
        deletedVideoRows: 0,
      },
    );

    expect(result.deleted).toBe(false);
    expect(result.response.status).toBe(409);
    await expect(result.response.json()).resolves.toEqual({
      error: "Could not delete video",
      reason: "fk-constraint-delete-failed",
    });
  });
});
