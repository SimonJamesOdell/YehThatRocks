import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'trh3';
const SOURCE_VIDEO_ID = `${TEST_PREFIX}-src`;

function rowValuesText(row) {
  return Object.values(row)
    .map((value) => String(value ?? ''))
    .join(' | ')
    .toLowerCase();
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM related WHERE videoId LIKE '${TEST_PREFIX}%' OR related LIKE '${TEST_PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE '${TEST_PREFIX}%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM videos WHERE videoId LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  await prisma.video.createMany({
    data: [
      {
        videoId: SOURCE_VIDEO_ID,
        title: 'Hotspot Source',
        favourited: 0,
        viewCount: 500,
        description: 'Source video for related join hotspot tests',
      },
      {
        videoId: `${TEST_PREFIX}-a`,
        title: 'Related A',
        favourited: 40,
        viewCount: 1200,
        description: 'Related video A',
      },
      {
        videoId: `${TEST_PREFIX}-b`,
        title: 'Related B',
        favourited: 40,
        viewCount: 900,
        description: 'Related video B',
      },
      {
        videoId: `${TEST_PREFIX}-c`,
        title: 'Related C',
        favourited: 10,
        viewCount: 1500,
        description: 'Related video C',
      },
    ],
  });

  const rows = await prisma.video.findMany({
    where: { videoId: { startsWith: TEST_PREFIX } },
    select: { id: true, videoId: true },
  });
  const idByVideoId = new Map(rows.map((row) => [row.videoId, row.id]));

  const relatedAId = idByVideoId.get(`${TEST_PREFIX}-a`);
  const relatedBId = idByVideoId.get(`${TEST_PREFIX}-b`);
  const relatedCId = idByVideoId.get(`${TEST_PREFIX}-c`);

  if (!relatedAId || !relatedBId || !relatedCId) {
    throw new Error('Failed to resolve test video IDs for site_videos setup');
  }

  // Intentionally create multiple available rows for rel-a to exercise row-multiplication behavior.
  await prisma.siteVideo.createMany({
    data: [
      { videoId: relatedAId, title: 'Related A [available-1]', status: 'available', createdAt: new Date() },
      { videoId: relatedAId, title: 'Related A [available-2]', status: 'available', createdAt: new Date() },
      { videoId: relatedBId, title: 'Related B [available]', status: 'available', createdAt: new Date() },
      { videoId: relatedCId, title: 'Related C [available]', status: 'available', createdAt: new Date() },
      { videoId: relatedCId, title: 'Related C [blocked]', status: 'blocked', createdAt: new Date() },
    ],
  });

  // Intentionally create duplicate related links to require deterministic dedup in query output.
  await prisma.relatedCache.createMany({
    data: [
      { videoId: SOURCE_VIDEO_ID, related: `${TEST_PREFIX}-a`, createdAt: new Date(), updatedAt: new Date() },
      { videoId: SOURCE_VIDEO_ID, related: `${TEST_PREFIX}-a`, createdAt: new Date(), updatedAt: new Date() },
      { videoId: SOURCE_VIDEO_ID, related: `${TEST_PREFIX}-b`, createdAt: new Date(), updatedAt: new Date() },
      { videoId: SOURCE_VIDEO_ID, related: `${TEST_PREFIX}-c`, createdAt: new Date(), updatedAt: new Date() },
    ],
  });

  console.log('Setup complete: synthetic related/video/site_videos test data created');
}

async function runLegacyQuery(sourceVideoId) {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId,
        v.title,
        COALESCE(v.parsedArtist, NULL) AS channelTitle,
        v.favourited,
        v.description
      FROM related r
      INNER JOIN videos v ON v.videoId = r.related
      INNER JOIN (
        SELECT DISTINCT sv.video_id
        FROM site_videos sv
        WHERE sv.status = 'available'
      ) available_sv ON available_sv.video_id = v.id
      WHERE r.videoId = ?
        AND v.videoId IS NOT NULL
      GROUP BY v.videoId, v.title, v.parsedArtist, v.favourited, v.description
      ORDER BY v.favourited DESC, MAX(COALESCE(v.viewCount, 0)) DESC, v.videoId ASC
      LIMIT 36
    `,
    sourceVideoId,
  );
}

async function runOptimizedQuery(sourceVideoId) {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId,
        v.title,
        COALESCE(v.parsedArtist, NULL) AS channelTitle,
        v.favourited,
        v.description
      FROM related r
      INNER JOIN videos v ON v.videoId = r.related
      WHERE r.videoId = ?
        AND v.videoId IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
      GROUP BY v.videoId, v.title, v.parsedArtist, v.favourited, v.description, v.viewCount
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT 36
    `,
    sourceVideoId,
  );
}

async function benchmark(label, iterations, queryFn) {
  const timings = [];

  for (let i = 0; i < iterations; i += 1) {
    const startedAt = Date.now();
    await queryFn();
    timings.push(Date.now() - startedAt);
  }

  const avg = Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length);
  console.log(`  ${label} avg: ${avg}ms (${timings.join(', ')}ms)`);
  return avg;
}

async function testResultParity(sourceVideoId) {
  console.log('\nTest 1: Legacy vs optimized result parity');
  const legacyRows = await runLegacyQuery(sourceVideoId);
  const optimizedRows = await runOptimizedQuery(sourceVideoId);

  const legacyIds = legacyRows.map((row) => row.videoId);
  const optimizedIds = optimizedRows.map((row) => row.videoId);

  if (legacyIds.length !== optimizedIds.length) {
    throw new Error(`Row count mismatch: legacy=${legacyIds.length}, optimized=${optimizedIds.length}`);
  }

  for (let i = 0; i < legacyIds.length; i += 1) {
    if (legacyIds[i] !== optimizedIds[i]) {
      throw new Error(`Ordering mismatch at position ${i}: legacy=${legacyIds[i]}, optimized=${optimizedIds[i]}`);
    }
  }

  console.log(`  PASS: Same ordered ${legacyIds.length} related videos`);
}

async function testIndexPlan(sourceVideoId) {
  console.log('\nTest 2: Optimized query uses related/site_videos indexes');

  const planRows = await prisma.$queryRawUnsafe(
    `
      EXPLAIN
      SELECT
        v.videoId,
        v.title,
        COALESCE(v.parsedArtist, NULL) AS channelTitle,
        v.favourited,
        v.description
      FROM related r
      INNER JOIN videos v ON v.videoId = r.related
      WHERE r.videoId = ?
        AND v.videoId IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
      GROUP BY v.videoId, v.title, v.parsedArtist, v.favourited, v.description, v.viewCount
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT 36
    `,
    sourceVideoId,
  );

  const planDump = planRows.map(rowValuesText).join('\n');
  const usesRelatedIndex = planDump.includes('idx_related_videoid_related') || planDump.includes('idx_related_videoid');
  const usesSiteVideosIndex =
    planDump.includes('idx_site_videos_video_id_status') ||
    planDump.includes('idx_site_videos_status_video_id');

  if (!usesRelatedIndex) {
    throw new Error('Expected related table index usage was not detected in EXPLAIN output');
  }

  if (!usesSiteVideosIndex) {
    throw new Error('Expected site_videos index usage was not detected in EXPLAIN output');
  }

  console.log('  PASS: EXPLAIN shows related + site_videos index usage');
}

async function testPerformance(sourceVideoId) {
  console.log('\nTest 3: Optimized query performance vs legacy');

  await runLegacyQuery(sourceVideoId);
  await runOptimizedQuery(sourceVideoId);

  const legacyAvg = await benchmark('legacy', 5, () => runLegacyQuery(sourceVideoId));
  const optimizedAvg = await benchmark('optimized', 5, () => runOptimizedQuery(sourceVideoId));

  if (optimizedAvg > legacyAvg * 1.5) {
    throw new Error(`Optimized query regressed: legacy=${legacyAvg}ms optimized=${optimizedAvg}ms`);
  }

  const improvement = legacyAvg > 0 ? (((legacyAvg - optimizedAvg) / legacyAvg) * 100).toFixed(1) : '0.0';
  console.log(`  PASS: No regression. Improvement=${improvement}%`);
}

async function testSourceIsOptimized() {
  console.log('\nTest 4: Source query shape uses EXISTS-based availability filter');

  const fs = await import('node:fs/promises');
  const source = await fs.readFile('apps/web/lib/catalog-data-core.ts', 'utf8');

  const hasRelatedExistsQuery = /FROM related r[\s\S]*INNER JOIN videos v ON v\.videoId = r\.related[\s\S]*AND EXISTS \([\s\S]*FROM site_videos sv[\s\S]*sv\.video_id = v\.id[\s\S]*sv\.status = 'available'/m.test(source);
  const hasOptimizedOrder = /ORDER BY v\.favourited DESC, COALESCE\(v\.viewCount, 0\) DESC, v\.videoId ASC/m.test(source);

  if (!hasRelatedExistsQuery || !hasOptimizedOrder) {
    throw new Error('Source does not contain optimized EXISTS-based related query');
  }

  console.log('  PASS: Source contains optimized related query pattern');
}

async function main() {
  console.log('RELATED JOIN HOTSPOT TEST SUITE');

  try {
    await setup();

    await testResultParity(SOURCE_VIDEO_ID);
    await testIndexPlan(SOURCE_VIDEO_ID);
    await testPerformance(SOURCE_VIDEO_ID);
    await testSourceIsOptimized();

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
