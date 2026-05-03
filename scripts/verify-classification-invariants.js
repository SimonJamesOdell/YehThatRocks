#!/usr/bin/env node

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  catalogDataArtists: path.join(ROOT, "apps/web/lib/catalog-data-artists.ts"),
  metadataUtils: path.join(ROOT, "apps/web/lib/catalog-metadata-utils.ts"),
};

function main() {
  const failures = [];
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const catalogDataArtistsSource = readFileStrict(files.catalogDataArtists, ROOT);
  const metadataUtilsSource = readFileStrict(files.metadataUtils, ROOT);
  const classificationSource = `${catalogDataSource}\n${metadataUtilsSource}`;

  // Strict related-cascade admission invariants.
  assertContains(catalogDataSource, "const admissionDecision = admissionRow ? evaluatePlaybackMetadataEligibility(admissionRow) : null;", "Related cascade computes metadata admission decision", failures);
  assertContains(catalogDataSource, "!admissionRow || !Boolean(admissionRow.hasAvailable) || !admissionDecision?.allowed", "Related cascade requires available embed and metadata eligibility", failures);
  assertContains(catalogDataSource, "await pruneVideoAndAssociationsByVideoId(candidate.id, \"related-cascade-strict-admission\").catch(() => undefined);", "Related cascade prunes rejected candidates", failures);

  // Classification confidence-signal invariants.
  assertContains(catalogDataSource, "const ROCK_METAL_GENRE_PATTERN =", "Classifier defines rock/metal genre pattern", failures);
  assertContains(classificationSource, "function computeArtistChannelConfidenceDelta", "Classifier defines artist/channel consistency signal", failures);
  assertContains(catalogDataSource, "const ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS =", "Classifier caches artist evidence lookups", failures);
  assertContains(catalogDataArtistsSource, "const artistCatalogEvidenceCache = new BoundedMap", "Classifier keeps artist evidence cache in a bounded map", failures);
  assertContains(catalogDataSource, "async function getArtistCatalogEvidence(artistName: string)", "Classifier exposes artist catalog evidence helper", failures);
  assertContains(catalogDataSource, "Known artist lacks strong rock/metal genre evidence.", "Classifier penalizes known artists lacking rock/metal evidence", failures);
  assertContains(catalogDataSource, "Artist token matched channel title.", "Classifier boosts confidence for artist/channel match", failures);
  assertContains(catalogDataSource, "if (isLikelyNonMusicText(video.title, video.description ?? \"\"))", "Classifier applies non-music dampening during persistence", failures);
  assertContains(catalogDataSource, "const mojibakeScore = scoreLikelyMojibake(video.title);", "Classifier applies mojibake dampening", failures);

  // Admin direct import fallback must avoid artist/track reversal guesses.
  assertContains(classificationSource, "function pickArtistAndTrackFromTitleSides", "Admin fallback defines channel/title side matcher", failures);
  assertContains(classificationSource, "const matchedSideMetadata = sides && channelArtist ? pickArtistAndTrackFromTitleSides(sides, channelArtist) : null;", "Admin fallback only infers title-side artist when channel evidence matches", failures);
  assertContains(classificationSource, "Admin direct import fallback from channel/title side matching.", "Admin fallback records channel/title side matching reason", failures);

  // Prompt intent invariant.
  assertContains(catalogDataSource, "YehThatRocks is a rock/metal catalog.", "Groq prompt encodes rock/metal-only extraction intent", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Classification invariant check failed.",
    successMessage: "Classification invariant check passed.",
  });
}

main();
