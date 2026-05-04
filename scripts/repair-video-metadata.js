#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  collapseWhitespace,
  collectBracketTags,
  collectInlineFeatureTag,
  normalizeLooseToken: normalizeLoose,
  normalizePossiblyMojibakeText,
  sanitizeMetadataToken,
  splitTitle,
  stripKnownPrefix,
  truncate,
} = require("../apps/web/lib/catalog-metadata-normalization-shared.js");

const APPLY_CONFIRM_TOKEN = "REPAIR_VIDEO_METADATA";

function loadDatabaseEnv() {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(process.cwd(), ".env.production"),
    path.resolve(process.cwd(), "apps/web/.env.production"),
  ];

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (process.env[key]) {
        continue;
      }

      process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
    }
  }
}

function getArgValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Returns true when the meaningful inner content of a bracket/paren tag is already
 * present in the track name — prevents re-appending feat. artists or other tokens
 * that are already baked into parsedTrack.
 */
function tagContentAlreadyInTrack(tag, trackName) {
  const inner = collapseWhitespace(tag.replace(/^[\[(]|[\])]$/g, ""));
  if (!inner) {
    return false;
  }
  // Strip the feat./ft./featuring keyword itself so we compare the artist name
  const coreContent = inner.replace(/^(?:feat\.?|ft\.?|featuring)\s*/i, "").trim();
  if (!coreContent) {
    return false;
  }
  return normalizeLoose(trackName).includes(normalizeLoose(coreContent));
}

function buildNormalizedTitle(originalTitle, artist, track) {
  const safeArtist = sanitizeMetadataToken(artist);
  const safeTrack = sanitizeMetadataToken(track);

  if (!safeArtist || !safeTrack) {
    return null;
  }

  const repairedTitle = normalizePossiblyMojibakeText(originalTitle || "");
  const split = splitTitle(repairedTitle);

  // Identify which side of the primary separator is the track portion.
  let trackSide = split
    ? (() => {
        const leftNorm = normalizeLoose(split.left);
        const rightNorm = normalizeLoose(split.right);
        const artistNorm = normalizeLoose(safeArtist);

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

  // Repair mojibake in the track side independently before comparison, otherwise
  // a repaired safeTrack won't match an unrepaired trackSide and stripKnownPrefix fails.
  const repairedTrackSide = normalizePossiblyMojibakeText(trackSide);

  // Isolate everything AFTER the bare track name — this is the qualifier suffix.
  const afterTrack = collapseWhitespace(stripKnownPrefix(repairedTrackSide, safeTrack));

  // Collect individual bracket/paren qualifier tags from the suffix only.
  // Do NOT re-scan the full title — that causes double-collection of tags that
  // already appear in the track side.
  const rawTags = [];

  for (const tag of collectBracketTags(afterTrack)) {
    // Skip tags whose core content is already embedded in the track name.
    if (!tagContentAlreadyInTrack(tag, safeTrack)) {
      rawTags.push(tag);
    }
  }

  // Capture trailing inline feat. only when not already part of the track name.
  const inlineFeature = collectInlineFeatureTag(afterTrack);
  if (inlineFeature) {
    const featureArtist = inlineFeature.replace(/^(?:feat\.?|ft\.?|featuring)\s*/i, "").trim();
    if (!normalizeLoose(safeTrack).includes(normalizeLoose(featureArtist))) {
      rawTags.push(inlineFeature);
    }
  }

  // Deduplicate by normalised key — guards against the same tag appearing multiple
  // times in the original title (e.g. "(Official Video) (Official Video)").
  const dedupedTags = [];
  const seen = new Set();
  for (const rawTag of rawTags) {
    const repairedTag = sanitizeMetadataToken(rawTag, 200);
    if (!repairedTag) {
      continue;
    }
    const key = normalizeLoose(repairedTag);
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

async function detectArtistNormColumn(prisma) {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artists");
  const names = new Set(columns.map((column) => String(column.Field || "")));

  if (names.has("artist_name_norm")) {
    return "artist_name_norm";
  }

  return null;
}

async function loadKnownArtistSet(prisma) {
  const normColumn = await detectArtistNormColumn(prisma);
  const expr = normColumn
    ? `LOWER(TRIM(${normColumn}))`
    : "LOWER(TRIM(artist))";

  const rows = await prisma.$queryRawUnsafe(`
    SELECT ${expr} AS norm
    FROM artists
    WHERE artist IS NOT NULL
      AND TRIM(artist) <> ''
  `);

  const artistSet = new Set();
  for (const row of rows) {
    const norm = normalizeLoose(row.norm || "");
    if (norm) {
      artistSet.add(norm);
    }
  }

  return artistSet;
}

function shouldSwapArtistTrack(row, artistSet) {
  const artistNorm = normalizeLoose(row.parsedArtist || "");
  const trackNorm = normalizeLoose(row.parsedTrack || "");

  if (!artistNorm || !trackNorm || artistNorm === trackNorm) {
    return false;
  }

  if (!artistSet.has(trackNorm) || artistSet.has(artistNorm)) {
    return false;
  }

  const split = splitTitle(row.title || "");
  if (!split) {
    return true;
  }

  const leftNorm = normalizeLoose(split.left);
  const rightNorm = normalizeLoose(split.right);

  if (leftNorm.includes(trackNorm) && rightNorm.includes(artistNorm)) {
    return true;
  }

  // When title does not provide directional evidence, still allow swap based on artist-table certainty.
  return true;
}

function usage() {
  console.log(`Usage:
  node scripts/repair-video-metadata.js [--limit=250000] [--batch-size=2000] [--sample=20]
  node scripts/repair-video-metadata.js --apply --confirm=${APPLY_CONFIRM_TOKEN} [--limit=250000] [--batch-size=2000]

Behavior:
  - Dry-run by default.
  - Corrects likely reversed parsedArtist/parsedTrack using artists table evidence.
  - Rebuilds title as "[artist] - [track]" and preserves qualifier tags (live/official/feat/etc).
  - Repairs likely mojibake text in title/tag fragments where possible.
`);
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  if (hasFlag("help") || hasFlag("h")) {
    usage();
    return;
  }

  const apply = hasFlag("apply");
  const confirm = getArgValue("confirm", "");
  const limit = parsePositiveInt(getArgValue("limit", "250000"), 250000);
  const batchSize = parsePositiveInt(getArgValue("batch-size", "2000"), 2000);
  const sampleSize = parsePositiveInt(getArgValue("sample", "20"), 20);

  if (apply && confirm !== APPLY_CONFIRM_TOKEN) {
    throw new Error(`Refusing to write to DB without --confirm=${APPLY_CONFIRM_TOKEN}`);
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const artistSet = await loadKnownArtistSet(prisma);

    let scanned = 0;
    let lastId = 0;
    let swapped = 0;
    let titleChanged = 0;
    const planned = [];

    while (scanned < limit) {
      const remaining = limit - scanned;
      const take = Math.min(batchSize, remaining);

      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT id, videoId, title, parsedArtist, parsedTrack
          FROM videos
          WHERE id > ?
            AND parsedArtist IS NOT NULL
            AND parsedTrack IS NOT NULL
            AND TRIM(parsedArtist) <> ''
            AND TRIM(parsedTrack) <> ''
          ORDER BY id ASC
          LIMIT ?
        `,
        lastId,
        take,
      );

      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        scanned += 1;
        lastId = row.id;

        const shouldSwap = shouldSwapArtistTrack(row, artistSet);
        const nextArtist = sanitizeMetadataToken(shouldSwap ? row.parsedTrack : row.parsedArtist);
        const nextTrack = sanitizeMetadataToken(shouldSwap ? row.parsedArtist : row.parsedTrack);

        if (!nextArtist || !nextTrack) {
          continue;
        }

        const nextTitle = buildNormalizedTitle(row.title || "", nextArtist, nextTrack);
        if (!nextTitle) {
          continue;
        }

        const artistChanged = normalizeLoose(nextArtist) !== normalizeLoose(row.parsedArtist || "");
        const trackChanged = normalizeLoose(nextTrack) !== normalizeLoose(row.parsedTrack || "");
        const normalizedCurrentTitle = collapseWhitespace(row.title || "");
        const titleIsChanged = normalizeLoose(nextTitle) !== normalizeLoose(normalizedCurrentTitle);

        if (!artistChanged && !trackChanged && !titleIsChanged) {
          continue;
        }

        if (shouldSwap && (artistChanged || trackChanged)) {
          swapped += 1;
        }
        if (titleIsChanged) {
          titleChanged += 1;
        }

        planned.push({
          id: row.id,
          videoId: row.videoId,
          oldArtist: row.parsedArtist,
          oldTrack: row.parsedTrack,
          oldTitle: row.title,
          newArtist: nextArtist,
          newTrack: nextTrack,
          newTitle: nextTitle,
          swapped: shouldSwap,
        });
      }
    }

    console.log(`Scanned rows: ${scanned}`);
    console.log(`Planned row updates: ${planned.length}`);
    console.log(`Planned swaps: ${swapped}`);
    console.log(`Planned title normalizations: ${titleChanged}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

    const sample = planned.slice(0, sampleSize);
    if (sample.length > 0) {
      console.log("\nSample changes:");
      for (const item of sample) {
        console.log(
          `- id=${item.id} videoId=${item.videoId} swap=${item.swapped ? "yes" : "no"} | artist: "${item.oldArtist}" -> "${item.newArtist}" | track: "${item.oldTrack}" -> "${item.newTrack}" | title: "${item.oldTitle}" -> "${item.newTitle}"`,
        );
      }
    }

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply and --confirm token to write changes.");
      return;
    }

    if (planned.length === 0) {
      console.log("\nNo changes required.");
      return;
    }

    const now = new Date();
    let updated = 0;
    const updateBatches = chunkArray(planned, 500);

    for (const batch of updateBatches) {
      await prisma.$transaction(async (tx) => {
        for (const item of batch) {
          await tx.$executeRaw`
            UPDATE videos
            SET
              parsedArtist = ${item.newArtist},
              parsedTrack = ${item.newTrack},
              title = ${item.newTitle},
              parseMethod = ${"metadata-repair-script"},
              parseReason = ${item.swapped
                ? "Artist/track repaired from artists-table evidence and title normalized."
                : "Title normalized from parsed metadata with qualifier preservation."},
              parsedAt = ${now}
            WHERE id = ${item.id}
          `;
          updated += 1;
        }
      }, { maxWait: 60000, timeout: 600000 });
    }

    console.log(`\nUpdated rows: ${updated}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
