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
      let closed = false;
      let sendInFlight = false;
      let metricsTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stopStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (metricsTimer) {
          clearInterval(metricsTimer);
          metricsTimer = null;
        }

        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      controller.enqueue(encoder.encode(": connected\n\n"));

      const sendHealth = async () => {
        if (closed || sendInFlight) {
          return;
        }

        sendInFlight = true;

        try {
          const payload = await buildAdminHealthPayload();
          if (closed) {
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // If enqueue fails because client closed, stop timers immediately.
          stopStream();
        } finally {
          sendInFlight = false;
        }
      };

      await sendHealth();

      metricsTimer = setInterval(() => {
        void sendHealth();
      }, STREAM_INTERVAL_MS);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          stopStream();
        }
      }, 25_000);

      request.signal.addEventListener("abort", stopStream, { once: true });
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

