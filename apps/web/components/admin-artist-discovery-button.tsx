"use client";

import { useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type AdminArtistDiscoveryButtonProps = {
  artistName: string;
  isAdmin: boolean;
};

type DiscoveryResponse = {
  ok: boolean;
  scanned?: number;
  queued?: number;
  imported?: number;
  skipped?: number;
  prunedAsMismatch?: number;
  error?: string;
};

export function AdminArtistDiscoveryButton({ artistName, isAdmin }: AdminArtistDiscoveryButtonProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string>("");

  if (!isAdmin) {
    return null;
  }

  async function handleDiscover() {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setStatus("");

    try {
      const response = await fetchWithAuthRetry("/api/admin/artists/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artistName,
          maxResults: 20,
        }),
      });

      let payload: DiscoveryResponse | null = null;
      try {
        payload = (await response.json()) as DiscoveryResponse;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        setStatus(payload?.error?.trim() || "Discovery failed. Please try again.");
        return;
      }

      setStatus(
        `Discovery queued ${payload.queued ?? 0} track(s) from ${payload.scanned ?? 0} candidates.`
        + ` Imported: ${payload.imported ?? 0}, skipped: ${payload.skipped ?? 0}, pruned mismatch: ${payload.prunedAsMismatch ?? 0}.`,
      );
    } catch {
      setStatus("Discovery failed. Please try again.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="newPageSeenToggle"
        onClick={() => {
          void handleDiscover();
        }}
        disabled={isRunning}
        title="Find additional tracks for this artist and add them to admin pending review"
      >
        {isRunning ? "Discovering..." : "Discover more tracks"}
      </button>
      {status ? <p className="authMessage">{status}</p> : null}
    </>
  );
}