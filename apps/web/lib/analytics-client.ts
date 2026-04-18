// Client-side analytics utility.
// Manages visitor/session IDs and fires events to /api/analytics.
// - visitorId: UUID stored in localStorage (persists across sessions = "repeat visitor")
// - sessionId: UUID stored in sessionStorage (new per tab/session)

const VISITOR_KEY = "ytr_vid";
const SESSION_KEY = "ytr_sid";
const GEO_KEY = "ytr_geo";
const GEO_CACHE_TTL_MS = 10 * 60 * 1000;

type GeoSnapshot = {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: number;
};

let geoSnapshotPromise: Promise<GeoSnapshot | null> | null = null;

function uuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreate(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = uuidV4();
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

function readCachedGeoSnapshot(now: number): GeoSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(GEO_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as GeoSnapshot;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const withinCache = now - Number(parsed.capturedAt ?? 0) <= GEO_CACHE_TTL_MS;
    if (!withinCache) {
      return null;
    }

    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    const accuracyMeters = parsed.accuracyMeters === null || parsed.accuracyMeters === undefined
      ? null
      : Number(parsed.accuracyMeters);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : null,
      capturedAt: Number(parsed.capturedAt ?? 0),
    };
  } catch {
    return null;
  }
}

function storeGeoSnapshot(snapshot: GeoSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(GEO_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage errors.
  }
}

async function getGeoSnapshot(): Promise<GeoSnapshot | null> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    return null;
  }

  const now = Date.now();
  const cached = readCachedGeoSnapshot(now);
  if (cached) {
    return cached;
  }

  if (!geoSnapshotPromise) {
    geoSnapshotPromise = new Promise<GeoSnapshot | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const snapshot: GeoSnapshot = {
            lat: Number(position.coords.latitude),
            lng: Number(position.coords.longitude),
            accuracyMeters: Number.isFinite(position.coords.accuracy) ? Number(position.coords.accuracy) : null,
            capturedAt: Date.now(),
          };
          storeGeoSnapshot(snapshot);
          resolve(snapshot);
        },
        () => resolve(null),
        {
          enableHighAccuracy: false,
          maximumAge: GEO_CACHE_TTL_MS,
          timeout: 3500,
        },
      );
    }).finally(() => {
      geoSnapshotPromise = null;
    });
  }

  return geoSnapshotPromise;
}

export async function trackPageView(): Promise<void> {
  const ids = getAnalyticsIds();
  if (!ids) return;
  try {
    const geo = await getGeoSnapshot();
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "page_view",
        ...ids,
        geoLat: geo?.lat,
        geoLng: geo?.lng,
        geoAccuracyMeters: geo?.accuracyMeters,
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
    const geo = await getGeoSnapshot();
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "video_view",
        ...ids,
        videoId,
        geoLat: geo?.lat,
        geoLng: geo?.lng,
        geoAccuracyMeters: geo?.accuracyMeters,
      }),
    });
  } catch {
    // Non-critical
  }
}
