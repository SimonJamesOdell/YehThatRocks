import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'tph7';

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM playlistitems WHERE playlist_id IN (SELECT id FROM playlistnames WHERE name LIKE '${TEST_PREFIX}%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM playlistnames WHERE name LIKE '${TEST_PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE '${TEST_PREFIX}%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM videos WHERE videoId LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  await prisma.video.createMany({
    data: [
      { videoId: `${TEST_PREFIX}a01`, title: 'Playlist hotspot A', parsedArtist: 'Artist A', favourited: 9, description: 'Track A' },
      { videoId: `${TEST_PREFIX}b01`, title: 'Playlist hotspot B', parsedArtist: 'Artist B', favourited: 5, description: 'Track B' },
      { videoId: `${TEST_PREFIX}c01`, title: 'Playlist hotspot C', parsedArtist: 'Artist C', favourited: 1, description: 'Track C' },
    ],
  });

  const videos = await prisma.video.findMany({
    where: { videoId: { startsWith: TEST_PREFIX } },
    select: { id: true, videoId: true },
  });
  const videoIdMap = new Map(videos.map((row) => [row.videoId, row.id]));

  await prisma.$executeRawUnsafe(
    `INSERT INTO playlistnames (name, user_id, is_private) VALUES (?, ?, ?)`,
    `${TEST_PREFIX} playlist`,
    null,
    1,
  );

  const playlistRows = await prisma.$queryRawUnsafe(
    `SELECT id FROM playlistnames WHERE name = ? ORDER BY id DESC LIMIT 1`,
    `${TEST_PREFIX} playlist`,
  );
  const playlistId = Number(playlistRows[0]?.id ?? 0);

  if (!playlistId) {
    throw new Error('Failed to create hotspot test playlist');
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO playlistitems (playlist_id, video_id, sort_order)
      VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)
    `,
    playlistId,
    videoIdMap.get(`${TEST_PREFIX}b01`),
    0,
    playlistId,
    videoIdMap.get(`${TEST_PREFIX}a01`),
    1,
    playlistId,
    videoIdMap.get(`${TEST_PREFIX}c01`),
    2,
  );

  return playlistId;
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    playlistItemId: String(row.playlistItemId),
    videoId: String(row.videoId),
    title: String(row.title),
    channelTitle: row.channelTitle == null ? null : String(row.channelTitle),
    favourited: Number(row.favourited ?? 0),
    description: row.description == null ? null : String(row.description),
  }));
}

async function runFallbackQuery(playlistId) {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        pi.id AS playlistItemId,
        COALESCE(v.videoId, CAST(pi.video_id AS CHAR)) AS videoId,
        COALESCE(v.title, CONCAT('Video ', CAST(pi.video_id AS CHAR))) AS title,
        COALESCE(v.parsedArtist, NULL) AS channelTitle,
        COALESCE(v.favourited, 0) AS favourited,
        COALESCE(v.description, 'Playlist track') AS description
      FROM playlistitems pi
      LEFT JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = ?
      ORDER BY pi.sort_order ASC, pi.id ASC
    `,
    playlistId,
  );
}

async function runOptimizedQuery(playlistId) {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        pi.id AS playlistItemId,
        v.videoId AS videoId,
        v.title AS title,
        v.parsedArtist AS channelTitle,
        COALESCE(v.favourited, 0) AS favourited,
        v.description AS description
      FROM playlistitems pi
      INNER JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = ?
      ORDER BY pi.sort_order ASC, pi.id ASC
    `,
    playlistId,
  );
}

async function testParity(playlistId) {
  console.log('\nTest 1: Optimized playlist join parity');
  const fallbackRows = normalizeRows(await runFallbackQuery(playlistId));
  const optimizedRows = normalizeRows(await runOptimizedQuery(playlistId));

  if (JSON.stringify(fallbackRows) !== JSON.stringify(optimizedRows)) {
    throw new Error(`Parity mismatch: fallback=${JSON.stringify(fallbackRows)} optimized=${JSON.stringify(optimizedRows)}`);
  }

  console.log(`  PASS: Optimized join matches fallback output (${optimizedRows.length} rows)`);
}

async function testIndexExists() {
  console.log('\nTest 2: Playlist read index exists');
  const indexes = await prisma.$queryRawUnsafe(`SHOW INDEX FROM playlistitems`);
  const rows = indexes.filter((row) => row.Key_name === 'idx_playlistitems_playlist_order_video');

  if (rows.length === 0) {
    throw new Error('Missing idx_playlistitems_playlist_order_video index');
  }

  console.log('  PASS: Playlist read index exists');
}

async function testExplainUsesIndex(playlistId) {
  console.log('\nTest 3: EXPLAIN references playlist read index');
  const plan = await prisma.$queryRawUnsafe(
    `
      EXPLAIN
      SELECT
        pi.id AS playlistItemId,
        v.videoId AS videoId,
        v.title AS title,
        v.parsedArtist AS channelTitle,
        COALESCE(v.favourited, 0) AS favourited,
        v.description AS description
      FROM playlistitems pi
      INNER JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = ?
      ORDER BY pi.sort_order ASC, pi.id ASC
    `,
    playlistId,
  );

  const planText = JSON.stringify(plan, (_, value) => (typeof value === 'bigint' ? value.toString() : value)).toLowerCase();
  if (!planText.includes('idx_playlistitems_playlist_order_video')) {
    throw new Error('EXPLAIN did not reference idx_playlistitems_playlist_order_video');
  }

  console.log('  PASS: EXPLAIN references playlist read index');
}

async function testSourceContainsFastPath() {
  console.log('\nTest 4: Source contains strict fast path with guarded fallback');
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('apps/web/lib/catalog-data-core.ts', 'utf8');

  const hasFastPath = /INNER JOIN videos v ON v\.id = pi\.video_id[\s\S]*WHERE pi\.playlist_id = \$\{numericId\}[\s\S]*ORDER BY pi\.sort_order ASC, pi\.id ASC/m.test(source);
  const hasGuard = /if \(expectedMappedItemCount === null \|\| videoRows\.length < expectedMappedItemCount\)/m.test(source);
  const hasFallback = /LEFT JOIN videos v ON \$\{joinCondition\}/m.test(source);

  if (!hasFastPath || !hasGuard || !hasFallback) {
    throw new Error('Missing fast path, fallback guard, or legacy fallback query in source');
  }

  console.log('  PASS: Source wiring contains strict fast path and guarded fallback');
}

async function main() {
  console.log('PLAYLIST ITEM JOIN HOTSPOT TEST SUITE');

  try {
    const playlistId = await setup();
    await testParity(playlistId);
    await testIndexExists();
    await testExplainUsesIndex(playlistId);
    await testSourceContainsFastPath();
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