"use client";

import { useState } from "react";

export function MagazineGenerateNowButton() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateNow() {
    if (isRunning) return;

    setIsRunning(true);
    setError(null);
    setStatus("Generating article...");

    try {
      const response = await fetch("/api/admin/magazine/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Generation failed");
        setStatus(null);
        return;
      }

      setStatus("Generation triggered.");
    } catch {
      setError("Generation failed");
      setStatus(null);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="magazineAdminGenerateWrap">
      <button
        type="button"
        className="magazineAdminGenerateButton"
        onClick={handleGenerateNow}
        disabled={isRunning}
      >
        {isRunning ? "Generating..." : "Generate article now"}
      </button>
      {status ? <p className="magazineAdminGenerateStatus">{status}</p> : null}
      {error ? <p className="magazineAdminGenerateError">{error}</p> : null}
    </div>
  );
}
