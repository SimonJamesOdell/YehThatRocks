const artistVideoCountCache = new Map<string, number | null>();
const artistVideoCountInFlight = new Map<string, Promise<number | null>>();

export async function fetchArtistVideoCountForCard(artistSlug: string, videoId: string): Promise<number | null> {
  const cacheKey = `${artistSlug}:${videoId}`;

  if (artistVideoCountCache.has(cacheKey)) {
    return artistVideoCountCache.get(cacheKey) ?? null;
  }

  const existing = artistVideoCountInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const query = new URLSearchParams();
      query.set("v", videoId);

      const response = await fetch(`/api/artists/${encodeURIComponent(artistSlug)}?${query.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        artistVideoCountCache.set(cacheKey, null);
        return null;
      }

      const payload = await response.json() as {
        videoCount?: number | null;
        videos?: Array<{ id?: string }>;
      };

      const resolvedCount = Number(payload?.videoCount);
      const fallbackCount = Array.isArray(payload?.videos) ? payload.videos.length : null;
      const count = Number.isFinite(resolvedCount) ? resolvedCount : fallbackCount;

      artistVideoCountCache.set(cacheKey, count);
      return count;
    } catch {
      artistVideoCountCache.set(cacheKey, null);
      return null;
    } finally {
      artistVideoCountInFlight.delete(cacheKey);
    }
  })();

  artistVideoCountInFlight.set(cacheKey, request);
  return request;
}