import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'tsh8';

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE '${TEST_PREFIX}%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM videos WHERE videoId LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  await prisma.video.createMany({
    data: [
      { videoId: `${TEST_PREFIX}a01`, title: 'Summary hotspot A', parsedArtist: `${TEST_PREFIX} artist`, favourited: 7, description: 'A' },
      { videoId: `${TEST_PREFIX}b01`, title: 'Summary hotspot B', parsedArtist: `${TEST_PREFIX} artist`, favourited: 5, description: 'B' },
      { videoId: `${TEST_PREFIX}c01`, title: 'Summary hotspot C', parsedArtist: `${TEST_PREFIX} other`, favourited: 1, description: 'C' },
    ],
  });

  const videos = await prisma.video.findMany({
    where: { videoId: { startsWith: TEST_PREFIX } },
    select: { id: true, videoId: true },
  });
  const byVideoId = new Map(videos.map((row) => [row.videoId, row.id]));

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO site_videos (video_id, title, status, created_at)
      VALUES (?, ?, ?, NOW()), (?, ?, ?, NOW()), (?, ?, ?, NOW()), (?, ?, ?, NOW())
    `,
    byVideoId.get(`${TEST_PREFIX}a01`), `${TEST_PREFIX}a01 available 1`, 'available',
    byVideoId.get(`${TEST_PREFIX}a01`), `${TEST_PREFIX}a01 available 2`, 'available',
    byVideoId.get(`${TEST_PREFIX}b01`), `${TEST_PREFIX}b01 available`, 'available',
    byVideoId.get(`${TEST_PREFIX}c01`), `${TEST_PREFIX}c01 blocked`, 'blocked',
  );
}

async function runLegacyArtistCountQuery() {
  return prisma.$queryRaw`
    SELECT COUNT(DISTINCT v.videoId) AS videoCount
    FROM videos v
    INNER JOIN (
      SELECT DISTINCT sv.video_id
      FROM site_videos sv
      WHERE sv.status = 'available'
    ) sv_avail ON sv_avail.video_id = v.id
    WHERE LOWER(TRIM(v.parsedArtist)) = ${`${TEST_PREFIX} artist`}
      AND v.videoId IS NOT NULL
  `;
}

async function runSummaryArtistCountQuery() {
  return prisma.$queryRaw`
    SELECT COUNT(DISTINCT v.videoId) AS videoCount
    FROM videos v
    INNER JOIN site_video_availability_summary sv_avail
      ON sv_avail.video_id = v.id
     AND sv_avail.has_available = 1
    WHERE LOWER(TRIM(v.parsedArtist)) = ${`${TEST_PREFIX} artist`}
      AND v.videoId IS NOT NULL
  `;
}

async function runLegacyThumbnailQuery() {
  return prisma.$queryRaw`
    SELECT v.videoId AS thumbnailVideoId
    FROM videos v
    INNER JOIN (
      SELECT DISTINCT sv.video_id
      FROM site_videos sv
      WHERE sv.status = 'available'
    ) sv_avail ON sv_avail.video_id = v.id
    WHERE LOWER(TRIM(v.parsedArtist)) = ${`${TEST_PREFIX} artist`}
      AND v.videoId IS NOT NULL
    ORDER BY v.id ASC
    LIMIT 1
  `;
}

async function runSummaryThumbnailQuery() {
  return prisma.$queryRaw`
    SELECT v.videoId AS thumbnailVideoId
    FROM videos v
    INNER JOIN site_video_availability_summary sv_avail
      ON sv_avail.video_id = v.id
     AND sv_avail.has_available = 1
    WHERE LOWER(TRIM(v.parsedArtist)) = ${`${TEST_PREFIX} artist`}
      AND v.videoId IS NOT NULL
    ORDER BY v.id ASC
    LIMIT 1
  `;
}

async function testParity() {
  console.log('\nTest 1: Summary join parity with legacy DISTINCT join');
  const legacyCountRows = await runLegacyArtistCountQuery();
  const summaryCountRows = await runSummaryArtistCountQuery();
  const legacyThumbRows = await runLegacyThumbnailQuery();
  const summaryThumbRows = await runSummaryThumbnailQuery();

  const legacyCount = Number(legacyCountRows[0]?.videoCount ?? 0);
  const summaryCount = Number(summaryCountRows[0]?.videoCount ?? 0);
  const legacyThumb = String(legacyThumbRows[0]?.thumbnailVideoId ?? '');
  const summaryThumb = String(summaryThumbRows[0]?.thumbnailVideoId ?? '');

  if (legacyCount !== summaryCount || legacyThumb !== summaryThumb) {
    throw new Error(`Parity mismatch: legacyCount=${legacyCount} summaryCount=${summaryCount} legacyThumb=${legacyThumb} summaryThumb=${summaryThumb}`);
  }

  console.log('  PASS: Summary join matches legacy count and thumbnail output');
}

async function testTriggerSync() {
  console.log('\nTest 2: Summary triggers stay in sync with site_videos changes');
  const targetRows = await prisma.$queryRawUnsafe(`SELECT id, video_id FROM site_videos WHERE title = ? LIMIT 1`, `${TEST_PREFIX}b01 available`);
  const targetId = Number(targetRows[0]?.id ?? 0);
  const targetVideoId = Number(targetRows[0]?.video_id ?? 0);

  if (!targetId || !targetVideoId) {
    throw new Error('Could not resolve test site_videos row for trigger sync test');
  }

  await prisma.$executeRawUnsafe(`UPDATE site_videos SET status = 'blocked' WHERE id = ?`, targetId);

  const summaryRows = await prisma.$queryRawUnsafe(
    `SELECT available_count AS availableCount, blocked_count AS blockedCount, has_available AS hasAvailable FROM site_video_availability_summary WHERE video_id = ? LIMIT 1`,
    targetVideoId,
  );

  const availableCount = Number(summaryRows[0]?.availableCount ?? -1);
  const blockedCount = Number(summaryRows[0]?.blockedCount ?? -1);
  const hasAvailable = Number(summaryRows[0]?.hasAvailable ?? -1);

  if (availableCount !== 0 || blockedCount < 1 || hasAvailable !== 0) {
    throw new Error(`Unexpected summary row after update: ${JSON.stringify(summaryRows[0])}`);
  }

  console.log('  PASS: Trigger sync updates summary counts and flags');
}

async function testSchemaAndSourceWiring() {
  console.log('\nTest 3: Schema and source wiring use summary join with fallback');
  const summaryColumns = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM site_video_availability_summary`);
  const catalogSource = await fs.readFile('apps/web/lib/catalog-data-core.ts', 'utf8');
  const rebuildSource = await fs.readFile('scripts/rebuild-artist-stats.js', 'utf8');

  const hasColumn = summaryColumns.some((row) => row.Field === 'has_available');
  const hasCatalogHelper = /getAvailableSiteVideosJoinClause\(/m.test(catalogSource);
  const hasCatalogSummaryJoin = /site_video_availability_summary[\s\S]*has_available = 1/m.test(catalogSource);
  const hasRebuildHelper = /getAvailableSiteVideosJoin\(prisma\)/m.test(rebuildSource);

  if (!hasColumn || !hasCatalogHelper || !hasCatalogSummaryJoin || !hasRebuildHelper) {
    throw new Error('Missing summary schema or source wiring');
  }

  console.log('  PASS: Summary schema and source wiring found');
}

async function main() {
  console.log('SITE VIDEO AVAILABILITY SUMMARY HOTSPOT TEST SUITE');
  try {
    await setup();
    await testParity();
    await testTriggerSync();
    await testSchemaAndSourceWiring();
    console.log('\nALL TESTS PASSED');
    process.exit(0);
  } catch (error) {
    console.error(`\nTEST FAILED: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main();