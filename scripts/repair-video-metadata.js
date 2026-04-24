#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

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

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function truncate(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function scoreLikelyMojibake(value) {
  const markerCount = (value.match(/(?:Ã.|Â.|â.|Ð.|Ñ.|┬.|�)/g) || []).length;
  const replacementCount = (value.match(/�/g) || []).length;
  const boxDrawingCount = (value.match(/[┬▒░]/g) || []).length;
  return markerCount * 3 + replacementCount * 4 + boxDrawingCount * 2;
}

function normalizePossiblyMojibakeText(value) {
  const input = collapseWhitespace(value);
  if (!input) {
    return input;
  }

  const originalScore = scoreLikelyMojibake(input);
  if (originalScore === 0) {
    return input;
  }

  const candidates = new Set();
  const repairedOnce = Buffer.from(input, "latin1").toString("utf8").trim();
  if (repairedOnce && repairedOnce !== input) {
    candidates.add(repairedOnce);
  }

  const repairedTwice = Buffer.from(repairedOnce, "latin1").toString("utf8").trim();
  if (repairedTwice && repairedTwice !== input) {
    candidates.add(repairedTwice);
  }

  let best = input;
  let bestScore = originalScore;

  for (const candidate of candidates) {
    const candidateScore = scoreLikelyMojibake(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return bestScore <= originalScore - 2 ? best : input;
}

function sanitizeMetadataToken(value, maxLength = 255) {
  const normalized = normalizePossiblyMojibakeText(value || "");
  if (!normalized) {
    return null;
  }

  const cleaned = collapseWhitespace(normalized);
  if (!cleaned) {
    return null;
  }

  return truncate(cleaned, maxLength);
}

function splitTitle(title) {
  const raw = collapseWhitespace(title);
  if (!raw) {
    return null;
  }

  const separators = [" - ", " – ", " — ", " | "];
  let best = null;

  for (const separator of separators) {
    const idx = raw.indexOf(separator);
    if (idx <= 0) {
      continue;
    }

    if (!best || idx < best.idx) {
      best = { idx, separator };
    }
  }

  if (!best) {
    return null;
  }

  const left = raw.slice(0, best.idx).trim();
  const right = raw.slice(best.idx + best.separator.length).trim();

  if (!left || !right) {
    return null;
  }

  return { left, right };
}

function stripKnownPrefix(text, token) {
  if (!text || !token) {
    return text;
  }

  const textNorm = normalizeLoose(text);
  const tokenNorm = normalizeLoose(token);
  if (!tokenNorm) {
    return text;
  }

  if (!textNorm.startsWith(tokenNorm)) {
    return text;
  }

  const consumed = text.slice(0, token.length);
  if (normalizeLoose(consumed) !== tokenNorm) {
    return text;
  }

  return text.slice(consumed.length).trim();
}

function collectBracketTags(text) {
  const tags = [];
  const tagRegex = /(\([^)]*(?:live|official|video|lyrics?|lyric\s+video|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)[^)]*\)|\[[^\]]*(?:live|official|video|lyrics?|lyric\s+video|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)[^\]]*\])/gi;

  for (const match of text.matchAll(tagRegex)) {
    const value = collapseWhitespace(match[0]);
    if (value) {
      tags.push(value);
    }
  }

  return tags;
}

function collectInlineFeatureTag(text) {
  const featureRegex = /(?:^|\s)(feat\.?|ft\.?|featuring)\s+[^\[\]()]+$/i;
  const hit = text.match(featureRegex);
  if (!hit) {
    return null;
  }

  return collapseWhitespace(hit[0]);
}

function buildNormalizedTitle(originalTitle, artist, track) {
  const safeArtist = sanitizeMetadataToken(artist);
  const safeTrack = sanitizeMetadataToken(track);

  if (!safeArtist || !safeTrack) {
    return null;
  }

  const repairedTitle = normalizePossiblyMojibakeText(originalTitle || "");
  const split = splitTitle(repairedTitle);

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

  const tagParts = [];
  const bracketTags = collectBracketTags(trackSide).concat(collectBracketTags(repairedTitle));
  for (const tag of bracketTags) {
    tagParts.push(tag);
  }

  const inlineFeature = collectInlineFeatureTag(trackSide);
  if (inlineFeature) {
    tagParts.push(inlineFeature);
  }

  const remainder = stripKnownPrefix(trackSide, safeTrack);
  if (remainder && /(?:^|\s)(live|official|video|lyrics?|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)\b/i.test(remainder)) {
    tagParts.push(remainder);
  }

  const dedupedTags = [];
  const seen = new Set();
  for (const rawTag of tagParts) {
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

    await prisma.$transaction(async (tx) => {
      for (const item of planned) {
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
    });

    console.log(`\nUpdated rows: ${updated}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
