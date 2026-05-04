import {
  collapseWhitespace,
  collectBracketTags as collectBracketMetadataTags,
  collectInlineFeatureTag as collectInlineFeatureMetadataTag,
  normalizeLooseToken as normalizeLooseMetadataToken,
  normalizePossiblyMojibakeText,
  sanitizeMetadataToken as sanitizeMetadataTitleToken,
  scoreLikelyMojibake,
  splitTitle as splitTitleForNormalization,
  stripKnownPrefix as stripKnownTrackPrefix,
  truncate,
} from "./catalog-metadata-normalization-shared";

export { normalizePossiblyMojibakeText, scoreLikelyMojibake };

export function normalizeParsedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") {
    return null;
  }

  return truncate(trimmed, maxLength);
}

export function normalizeParsedConfidence(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeLooseToken(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeArtistChannelConfidenceDelta(artist: string | null | undefined, channelTitle: string | null | undefined) {
  const normalizedArtist = normalizeLooseToken(artist);
  const normalizedChannel = normalizeLooseToken(channelTitle);

  if (!normalizedArtist || !normalizedChannel) {
    return 0;
  }

  if (["youtube", "unknown artist", "unknown"].includes(normalizedChannel)) {
    return 0;
  }

  const artistNeedle = ` ${normalizedArtist} `;
  const channelHaystack = ` ${normalizedChannel} `;
  if (channelHaystack.includes(artistNeedle)) {
    return 0.05;
  }

  const artistTerms = normalizedArtist.split(" ").filter(Boolean);
  if (artistTerms.length >= 2) {
    const overlap = artistTerms.filter((term) => channelHaystack.includes(` ${term} `)).length;
    if (overlap >= Math.max(1, Math.floor(artistTerms.length / 2))) {
      return 0.03;
    }
  }

  return -0.05;
}

function parseSimpleTitleSides(title: string) {
  const withDash = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (withDash.length >= 2) {
    return { left: withDash[0], right: withDash[1] };
  }

  const withPipe = title.split("|").map((part) => part.trim()).filter(Boolean);
  if (withPipe.length >= 2) {
    return { left: withPipe[0], right: withPipe[1] };
  }

  return null;
}

export function inferArtistFromTitle(title: string) {
  const sides = parseSimpleTitleSides(title);
  if (!sides) {
    return null;
  }

  const markerPattern = /\b(official|video|lyrics?|lyric|remaster(?:ed)?|live|hd|4k|audio|visualizer|feat\.?|ft\.?)\b|[\[(]/i;
  const leftHasMarkers = markerPattern.test(sides.left);
  const rightHasMarkers = markerPattern.test(sides.right);

  if (leftHasMarkers && !rightHasMarkers) {
    return sides.right;
  }

  if (rightHasMarkers && !leftHasMarkers) {
    return sides.left;
  }

  if (leftHasMarkers && rightHasMarkers) {
    return null;
  }

  const leftWords = sides.left.trim().split(/\s+/).filter(Boolean).length;
  const rightWords = sides.right.trim().split(/\s+/).filter(Boolean).length;

  if (leftWords >= 1 && leftWords <= 4 && rightWords >= 1 && rightWords <= 12) {
    return sides.left;
  }

  if (rightWords >= 1 && rightWords <= 4 && leftWords > 4) {
    return sides.right;
  }

  return null;
}

function sanitizeFallbackMetadataToken(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(official\s+video|official|lyrics?|lyric\s+video|audio|visualizer|hd|4k|remaster(?:ed)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeParsedString(cleaned, maxLength);
}

function deriveArtistFromChannelTitle(channelTitle: string | null | undefined, title?: string | null) {
  if (!channelTitle) {
    return null;
  }

  const cleaned = channelTitle
    .replace(/\s*-\s*topic\s*$/i, "")
    .replace(/\b(official|vevo|records|music channel)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidate = sanitizeFallbackMetadataToken(cleaned, 255);
  if (!candidate) {
    return null;
  }

  const normalizedCandidate = candidate.toLowerCase();
  if (normalizedCandidate === "youtube" || normalizedCandidate === "unknown artist") {
    return null;
  }

  if (title && normalizedCandidate === title.trim().toLowerCase()) {
    return null;
  }

  return candidate;
}

function pickArtistAndTrackFromTitleSides(
  sides: { left: string; right: string },
  channelArtist: string,
) {
  const channelArtistToken = normalizeLooseToken(channelArtist);
  if (!channelArtistToken) {
    return null;
  }

  const leftToken = normalizeLooseToken(sides.left);
  const rightToken = normalizeLooseToken(sides.right);
  if (!leftToken || !rightToken) {
    return null;
  }

  const channelWithBoundaries = ` ${channelArtistToken} `;
  const leftWithBoundaries = ` ${leftToken} `;
  const rightWithBoundaries = ` ${rightToken} `;

  const leftMatches =
    channelWithBoundaries.includes(leftWithBoundaries) || leftWithBoundaries.includes(channelWithBoundaries);
  const rightMatches =
    channelWithBoundaries.includes(rightWithBoundaries) || rightWithBoundaries.includes(channelWithBoundaries);

  if (leftMatches === rightMatches) {
    return null;
  }

  return leftMatches
    ? { artist: sides.left, track: sides.right }
    : { artist: sides.right, track: sides.left };
}

export function deriveAdminImportFallbackMetadata(
  title: string,
  channelTitle: string | null | undefined,
  playbackMinConfidence: number,
) {
  const sides = parseSimpleTitleSides(title);
  const channelArtist = deriveArtistFromChannelTitle(channelTitle, title);

  const matchedSideMetadata = sides && channelArtist ? pickArtistAndTrackFromTitleSides(sides, channelArtist) : null;
  const selectedArtistSource = matchedSideMetadata?.artist ?? channelArtist;
  const selectedTrackSource = matchedSideMetadata?.track ?? title;

  if (!selectedArtistSource) {
    return null;
  }

  const fallbackArtist = sanitizeFallbackMetadataToken(selectedArtistSource, 255);
  const fallbackTrack = sanitizeFallbackMetadataToken(
    selectedTrackSource,
    255,
  );

  if (!fallbackArtist || !fallbackTrack) {
    return null;
  }

  return {
    artist: fallbackArtist,
    track: fallbackTrack,
    videoType: "official",
    confidence: Math.max(playbackMinConfidence, 0.82),
    reason: matchedSideMetadata
      ? "Admin direct import fallback from channel/title side matching."
      : "Admin direct import fallback from channel title.",
  } as const;
}

export function buildNormalizedVideoTitleFromMetadata(
  originalTitle: string | null | undefined,
  artist: string | null | undefined,
  track: string | null | undefined,
) {
  const safeArtist = sanitizeMetadataTitleToken(artist);
  const safeTrack = sanitizeMetadataTitleToken(track);

  if (!safeArtist || !safeTrack) {
    return null;
  }

  const repairedTitle = normalizePossiblyMojibakeText(originalTitle ?? "");
  const split = splitTitleForNormalization(repairedTitle);

  let trackSide = split
    ? (() => {
        const leftNorm = normalizeLooseMetadataToken(split.left);
        const rightNorm = normalizeLooseMetadataToken(split.right);
        const artistNorm = normalizeLooseMetadataToken(safeArtist);

        if (leftNorm.includes(artistNorm) && !rightNorm.includes(artistNorm)) {
          return split.right;
        }
        if (rightNorm.includes(artistNorm) && !leftNorm.includes(artistNorm)) {
          return split.left;
        }
        return split.right;
      })()
    : repairedTitle;

  trackSide = collapseWhitespace(trackSide);
  const tagParts: string[] = [];
  const bracketTags = collectBracketMetadataTags(trackSide).concat(collectBracketMetadataTags(repairedTitle));
  for (const tag of bracketTags) {
    tagParts.push(tag);
  }

  const inlineFeature = collectInlineFeatureMetadataTag(trackSide);
  if (inlineFeature) {
    tagParts.push(inlineFeature);
  }

  const remainder = stripKnownTrackPrefix(trackSide, safeTrack);
  if (remainder && /(?:^|\s)(live|official|video|lyrics?|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)\b/i.test(remainder)) {
    tagParts.push(remainder);
  }

  const dedupedTags: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tagParts) {
    const repairedTag = sanitizeMetadataTitleToken(rawTag, 200);
    if (!repairedTag) {
      continue;
    }

    const key = normalizeLooseMetadataToken(repairedTag);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedTags.push(repairedTag);
  }

  const fullTrack = dedupedTags.length > 0
    ? `${safeTrack} ${dedupedTags.join(" ")}`
    : safeTrack;

  return truncate(`${safeArtist} - ${collapseWhitespace(fullTrack)}`, 255);
}
