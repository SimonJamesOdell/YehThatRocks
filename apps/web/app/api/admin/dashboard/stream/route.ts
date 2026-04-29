import { NextRequest } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { buildAdminHealthPayload } from "@/lib/admin-dashboard-health";

function readPositiveNumberEnv(name: string, defaultValue: number, minValue: number) {
  const raw = process.env[name];
  const parsed = Number(raw ?? defaultValue);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(minValue, parsed);
}

const STREAM_INTERVAL_MS = readPositiveNumberEnv("ADMIN_DASHBOARD_STREAM_MS", 125, 125);

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const sendHealth = async () => {
        try {
          const payload = await buildAdminHealthPayload();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Ignore transient metric read failures.
        }
      };

      await sendHealth();

      const metricsTimer = setInterval(() => {
        void sendHealth();
      }, STREAM_INTERVAL_MS);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(metricsTimer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

