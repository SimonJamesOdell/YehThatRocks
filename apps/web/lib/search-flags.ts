export const SEARCH_FLAG_REASONS = [
  "not-relevant",
  "wrong-artist",
  "wrong-trackname",
] as const;

export type SearchFlagReason = (typeof SEARCH_FLAG_REASONS)[number];

export const SEARCH_FLAG_MIN_USERS_FOR_ACTION = 3;

export const SEARCH_FLAG_REASON_LABELS: Record<SearchFlagReason, string> = {
  "not-relevant": "Not relevant to search",
  "wrong-artist": "Wrong artist",
  "wrong-trackname": "Wrong track name",
};

export const SEARCH_FLAG_REASON_INFO: Record<SearchFlagReason, string> = {
  "not-relevant": "This item doesn't match your search query or is completely unrelated to the music you're looking for.",
  "wrong-artist": "The artist/channel in this item is incorrect. You can provide the right one below.",
  "wrong-trackname": "The track name/title in this item is incorrect. You can provide the right one below.",
  // DESIGN NOTES on "not-relevant":
  // 
  // False positives in search occur due to:
  // 1. Metadata issues: Remixes, covers, live versions tagged as originals with wrong metadata
  // 2. YouTube indexing: Foreign language channels using English keywords in descriptions  
  // 3. Ambiguous search terms: "Iron Maiden" matches "Iron Maiden drummer interview" videos
  // 4. Title padding: Videos with artist name in title but unrelated content
  //
  // Community feedback via "not-relevant" flags helps identify and exclude false positives.
  // Multiple flags from regular users trigger review; admin flags apply immediately.
  // 
  // "wrong-artist" and "wrong-trackname" flags with corrections become metadata feedback
  // for improving the search index and catalog accuracy.
};

export function normalizeSearchFlagQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 255);
}

export function normalizeSearchFlagCorrection(value?: string | null) {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return normalized.length > 0 ? normalized.slice(0, 255) : null;
}
