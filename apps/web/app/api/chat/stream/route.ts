import { NextRequest } from "next/server";
import { z } from "zod";

import { getOptionalApiAuth } from "@/lib/auth-request";
import { chatChannel, chatEvents } from "@/lib/chat-events";

const streamQuerySchema = z.object({
  mode: z.enum(["global", "video"]).default("global"),
  videoId: z.string().trim().min(1).max(32).optional(),
});

const SSE_CONNECTION_LIMIT_TOTAL = Math.max(50, Number(process.env.CHAT_SSE_MAX_CONNECTIONS_TOTAL || "500"));
const SSE_CONNECTION_LIMIT_PER_IP = Math.max(1, Number(process.env.CHAT_SSE_MAX_CONNECTIONS_PER_IP || "6"));

const activeSseConnectionIds = new Set<string>();
const activeSseConnectionIdsByIp = new Map<string, Set<string>>();

function resolveClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

function reserveSseConnectionSlot(clientIp: string):
  | { ok: true; connectionId: string }
  | { ok: false; reason: "global-limit" | "ip-limit" } {
  if (activeSseConnectionIds.size >= SSE_CONNECTION_LIMIT_TOTAL) {
    return { ok: false, reason: "global-limit" };
  }

  const existingForIp = activeSseConnectionIdsByIp.get(clientIp);
  const ipCount = existingForIp?.size ?? 0;
  if (ipCount >= SSE_CONNECTION_LIMIT_PER_IP) {
    return { ok: false, reason: "ip-limit" };
  }

  const connectionId = crypto.randomUUID();
  activeSseConnectionIds.add(connectionId);

  if (existingForIp) {
    existingForIp.add(connectionId);
  } else {
    activeSseConnectionIdsByIp.set(clientIp, new Set([connectionId]));
  }

  return { ok: true, connectionId };
}

function releaseSseConnectionSlot(clientIp: string, connectionId: string) {
  activeSseConnectionIds.delete(connectionId);

  const existingForIp = activeSseConnectionIdsByIp.get(clientIp);
  if (!existingForIp) {
    return;
  }

  existingForIp.delete(connectionId);
  if (existingForIp.size === 0) {
    activeSseConnectionIdsByIp.delete(clientIp);
  }
}

export async function GET(request: NextRequest) {
  const authContext = await getOptionalApiAuth(request);

  const parsed = streamQuerySchema.safeParse({
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
    videoId: request.nextUrl.searchParams.get("videoId") ?? undefined,
  });

  if (!parsed.success) {
    return new Response("Bad request", { status: 400 });
  }

  const { mode, videoId } = parsed.data;

  if (mode !== "global" && !authContext) {
    return new Response("Unauthorized", { status: 401 });
  }

  const clientIp = resolveClientIp(request);
  const reservedSlot = reserveSseConnectionSlot(clientIp);
  if (!reservedSlot.ok) {
    const message = reservedSlot.reason === "ip-limit" ? "Too many stream connections for this client" : "SSE capacity reached";
    return new Response(message, {
      status: 429,
      headers: {
        "Retry-After": "15",
      },
    });
  }

  const channel = chatChannel(mode, mode === "video" ? videoId : null);
  const encoder = new TextEncoder();
  const { connectionId } = reservedSlot;
  let releaseResources: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const cleanup = (closeController: boolean) => {
        if (closed) {
          return;
        }

        closed = true;
        chatEvents.off(channel, handler);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onAbort);
        releaseSseConnectionSlot(clientIp, connectionId);
        releaseResources = null;

        if (closeController) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      releaseResources = () => cleanup(false);

      controller.enqueue(encoder.encode(": connected\n\n"));

      const handler = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup(false);
        }
      };

      chatEvents.on(channel, handler);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup(false);
        }
      }, 25_000);

      const onAbort = () => cleanup(true);
      request.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      releaseResources?.();
      releaseResources = null;
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
