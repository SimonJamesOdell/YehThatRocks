// Client-side analytics utility.
// Manages visitor/session IDs and fires events to /api/analytics.
// - visitorId: UUID stored in localStorage (persists across sessions = "repeat visitor")
// - sessionId: UUID stored in sessionStorage (new per tab/session)

const VISITOR_KEY = "ytr_vid";
const SESSION_KEY = "ytr_sid";

function getOrCreate(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(key, id);
  }
  return id;
}

export function getAnalyticsIds(): { visitorId: string; sessionId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const visitorId = getOrCreate(localStorage, VISITOR_KEY);
    const sessionId = getOrCreate(sessionStorage, SESSION_KEY);
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
