import { afterEach, describe, expect, it } from "vitest";

import { buildWalkerDumpResponse, slowDripSlotAvailable } from "./walker-dump";

const ENV_KEYS = [
  "DECOY_DUMP_ENABLED",
  "DECOY_DUMP_BYTES",
  "DECOY_DRIP_ENABLED",
  "DECOY_DRIP_INTERVAL_MS",
  "DECOY_DRIP_CHUNK_BYTES",
  "DECOY_DRIP_MAX_CONCURRENT",
];

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("buildWalkerDumpResponse", () => {
  it("serves instant JSON when the slow drip is disabled", async () => {
    process.env.DECOY_DRIP_ENABLED = "0";
    process.env.DECOY_DUMP_BYTES = "16384";

    const res = buildWalkerDumpResponse();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");

    const body = await res.text();
    expect(JSON.parse(body)).toBeInstanceOf(Array);
  });

  it("slow-drips the full decoy catalog and still delivers complete JSON", async () => {
    process.env.DECOY_DRIP_ENABLED = "1";
    process.env.DECOY_DRIP_INTERVAL_MS = "10";
    process.env.DECOY_DUMP_BYTES = "16384";

    const res = buildWalkerDumpResponse();
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.text();
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("enforces the concurrency cap and releases the slot when consumed", async () => {
    process.env.DECOY_DRIP_ENABLED = "1";
    process.env.DECOY_DRIP_INTERVAL_MS = "10";
    process.env.DECOY_DUMP_BYTES = "16384";
    process.env.DECOY_DRIP_MAX_CONCURRENT = "1";

    expect(slowDripSlotAvailable()).toBe(true);

    // Creating the response takes the only slot synchronously.
    const first = buildWalkerDumpResponse();
    expect(slowDripSlotAvailable()).toBe(false);

    // Consuming it releases the slot.
    await first.text();
    expect(slowDripSlotAvailable()).toBe(true);
  });
});
