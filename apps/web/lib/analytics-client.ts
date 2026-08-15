// Client-side analytics utility.
// Manages visitor/session IDs and fires events to /api/analytics.
//
// - visitorId: a UUID stored in localStorage that never expires. It identifies
//   a "unique visitor" — one person/browser over their whole relationship with
//   the site.
// - sessionId: a time-boxed UUID. A session ends after SESSION_TIMEOUT_MS of
//   inactivity (the standard analytics session definition). A user who returns
//   after the timeout starts a brand-new session, so "5 visits over 12 hours"
//   becomes 5 sessions but still 1 unique visitor.

const VISITOR_KEY = "ytr_vid";
const SESSION_KEY = "ytr_sid";
const SESSION_LAST_ACTIVITY_KEY = "ytr_sid_last_active";

// 30 minutes of inactivity ends a session.
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, quota) — analytics is best-effort.
  }
}

function getOrCreateVisitorId(): string | null {
  let id = readStorage(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    writeStorage(VISITOR_KEY, id);
  }
  return id;
}

function resolveSessionId(): string | null {
  const now = Date.now();
  const existing = readStorage(SESSION_KEY);
  const lastActivityRaw = readStorage(SESSION_LAST_ACTIVITY_KEY);
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : 0;

  const expired =
    !existing
    || !Number.isFinite(lastActivity)
    || lastActivity <= 0
    || now - lastActivity > SESSION_TIMEOUT_MS;

  let sessionId = existing;
  if (expired) {
    sessionId = crypto.randomUUID();
  }

  // Persist the (possibly rotated) session id and refresh the activity
  // timestamp so continued activity keeps the same session alive.
  if (sessionId) {
    writeStorage(SESSION_KEY, sessionId);
    writeStorage(SESSION_LAST_ACTIVITY_KEY, String(now));
  }

  return sessionId;
}

export function getAnalyticsIds(): { visitorId: string; sessionId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const visitorId = getOrCreateVisitorId();
    const sessionId = resolveSessionId();
    if (!visitorId || !sessionId) return null;
    return { visitorId, sessionId };
  } catch {
    return null;
  }
}

export async function trackPageView(): Promise<void> {
  const ids = getAnalyticsIds();
  if (!ids) return;
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "page_view",
        ...ids,
      }),
    });
  } catch {
    // Non-critical
  }
}

export async function trackVideoView(videoId: string): Promise<void> {
  const ids = getAnalyticsIds();
  if (!ids) return;
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "video_view",
        ...ids,
        videoId,
      }),
    });
  } catch {
    // Non-critical
  }
}
