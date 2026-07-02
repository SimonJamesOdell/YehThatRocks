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
  catalogDataIngestion: path.join(ROOT, "apps/web/lib/catalog-data-video-ingestion.ts"),
  catalogDataUtils: path.join(ROOT, "apps/web/lib/catalog-data-utils.ts"),
  catalogDataArtists: path.join(ROOT, "apps/web/lib/catalog-data-artists.ts"),
  metadataUtils: path.join(ROOT, "apps/web/lib/catalog-metadata-utils.ts"),
};

function main() {
  const failures = [];
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const catalogDataIngestionSource = readFileStrict(files.catalogDataIngestion, ROOT);
  const catalogDataUtilsSource = readFileStrict(files.catalogDataUtils, ROOT);
  const catalogDataArtistsSource = readFileStrict(files.catalogDataArtists, ROOT);
  const metadataUtilsSource = readFileStrict(files.metadataUtils, ROOT);
  const classificationSource = `${catalogDataSource}\n${metadataUtilsSource}`;

  // Strict related-cascade admission invariants.
  assertContains(catalogDataIngestionSource, "const admissionDecision = admissionRow ? evaluatePlaybackMetadataEligibility(admissionRow) : null;", "Related cascade computes metadata admission decision", failures);
  assertContains(catalogDataIngestionSource, "!admissionRow || !admissionRow.hasAvailable || !admissionDecision?.allowed", "Related cascade requires available embed and metadata eligibility", failures);
  assertContains(catalogDataIngestionSource, "await pruneVideoAndAssociationsByVideoId(candidate.id, \"related-cascade-strict-admission\").catch(() => undefined);", "Related cascade prunes rejected candidates", failures);

  // Classification confidence-signal invariants.
  assertContains(catalogDataUtilsSource, "ROCK_METAL_GENRE_PATTERN =", "Classifier defines rock/metal genre pattern", failures);
  assertContains(classificationSource, "function computeArtistChannelConfidenceDelta", "Classifier defines artist/channel consistency signal", failures);
  assertContains(catalogDataArtistsSource, "ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS", "Classifier caches artist evidence lookups", failures);
  assertContains(catalogDataArtistsSource, "const artistCatalogEvidenceCache = new BoundedMap", "Classifier keeps artist evidence cache in a bounded map", failures);
  assertContains(catalogDataArtistsSource, "async function getArtistCatalogEvidence", "Classifier exposes artist catalog evidence helper", failures);
  assertContains(catalogDataIngestionSource, "Known artist lacks strong rock/metal genre evidence.", "Classifier penalizes known artists lacking rock/metal evidence", failures);
  assertContains(catalogDataIngestionSource, "Artist token matched channel title.", "Classifier boosts confidence for artist/channel match", failures);
  assertContains(catalogDataIngestionSource, "isLikelyNonMusicText(video.title, video.description ?? \"\")", "Classifier applies non-music dampening during persistence", failures);
  assertContains(catalogDataIngestionSource, "const mojibakeScore = scoreLikelyMojibake(video.title);", "Classifier applies mojibake dampening", failures);

  // Admin direct import fallback must avoid artist/track reversal guesses.
  assertContains(classificationSource, "function pickArtistAndTrackFromTitleSides", "Admin fallback defines channel/title side matcher", failures);
  assertContains(classificationSource, "const matchedSideMetadata = sides && channelArtist ? pickArtistAndTrackFromTitleSides(sides, channelArtist) : null;", "Admin fallback only infers title-side artist when channel evidence matches", failures);
  assertContains(classificationSource, "Admin direct import fallback from channel/title side matching.", "Admin fallback records channel/title side matching reason", failures);

  // Prompt intent invariant.
  assertContains(catalogDataIngestionSource, "YehThatRocks", "Groq prompt and error messages encode rock/metal-only extraction intent", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Classification invariant check failed.",
    successMessage: "Classification invariant check passed.",
  });
}

main();