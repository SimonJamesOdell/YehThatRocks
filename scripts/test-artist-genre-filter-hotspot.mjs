import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_PREFIX = 'tgh4';

function normalizeArtistKey(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE '${TEST_PREFIX}%')`);
  await prisma.$executeRawUnsafe(`DELETE FROM videos WHERE videoId LIKE '${TEST_PREFIX}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM artists WHERE artist LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  await prisma.$executeRawUnsafe(`
    INSERT INTO artists (artist, country, genre1, genre2, genre3, genre4, genre5, genre6)
    VALUES
      ('${TEST_PREFIX} artist a', 'US', '8-bit metal', NULL, NULL, NULL, NULL, NULL),
      ('${TEST_PREFIX} artist b', 'US', 'synthwave', '8-bit', NULL, NULL, NULL, NULL),
      ('${TEST_PREFIX} artist c', 'US', 'doom metal', NULL, NULL, NULL, NULL, NULL)
  `);

  await prisma.video.createMany({
    data: [
      { videoId: `${TEST_PREFIX}a1`, title: 'A song', parsedArtist: `${TEST_PREFIX} artist a`, favourited: 10 },
      { videoId: `${TEST_PREFIX}b1`, title: 'B song', parsedArtist: `${TEST_PREFIX} artist b`, favourited: 8 },
      { videoId: `${TEST_PREFIX}c1`, title: 'C song', parsedArtist: `${TEST_PREFIX} artist c`, favourited: 5 },
    ],
  });

  const rows = await prisma.video.findMany({
    where: { videoId: { startsWith: TEST_PREFIX } },
    select: { id: true, videoId: true },
  });

  await prisma.siteVideo.createMany({
    data: rows.map((row) => ({
      videoId: row.id,
      title: row.videoId,
      status: 'available',
      createdAt: new Date(),
    })),
  });

  console.log('Setup complete for artist-genre hotspot test');
}

async function getLegacyNormalizedGenreArtistNames(genre) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT a.artist AS artistName
      FROM artists a
      WHERE (
        a.genre1 LIKE CONCAT('%', ?, '%')
        OR a.genre2 LIKE CONCAT('%', ?, '%')
        OR a.genre3 LIKE CONCAT('%', ?, '%')
        OR a.genre4 LIKE CONCAT('%', ?, '%')
        OR a.genre5 LIKE CONCAT('%', ?, '%')
        OR a.genre6 LIKE CONCAT('%', ?, '%')
      )
      LIMIT 64
    `,
    genre,
    genre,
    genre,
    genre,
    genre,
    genre,
  );

  return [...new Set(rows.map((row) => normalizeArtistKey(row.artistName ?? '')).filter(Boolean))].sort();
}

async function getVideosByNormalizedArtists(normalizedArtists) {
  if (normalizedArtists.length === 0) {
    return [];
  }

  const placeholders = normalizedArtists.map(() => '?').join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT v.videoId
      FROM videos v
      WHERE LOWER(TRIM(COALESCE(v.parsed_artist_norm, v.parsedArtist, ''))) IN (${placeholders})
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT 100
    `,
    ...normalizedArtists,
  );

  return rows.map((row) => row.videoId);
}

async function testPrefetchedArtistPathParity() {
  console.log('\nTest 1: Prefetched artist path parity vs legacy LIKE artist scan');

  const genre = '8-bit';
  const legacyNames = (await getLegacyNormalizedGenreArtistNames(genre)).filter((name) => name.includes(TEST_PREFIX));

  const prefetchedArtists = [
    { name: `${TEST_PREFIX} artist b` },
    { name: `${TEST_PREFIX} artist a` },
  ];
  const prefetchedNames = [...new Set(prefetchedArtists.map((artist) => normalizeArtistKey(artist.name)).filter(Boolean))].sort();

  if (JSON.stringify(legacyNames) !== JSON.stringify(prefetchedNames)) {
    throw new Error(`Prefetched normalized names mismatch: legacy=${legacyNames.join(',')} prefetched=${prefetchedNames.join(',')}`);
  }

  const legacyVideoIds = (await getVideosByNormalizedArtists(legacyNames)).filter((videoId) => videoId.startsWith(TEST_PREFIX));
  const prefetchedVideoIds = (await getVideosByNormalizedArtists(prefetchedNames)).filter((videoId) => videoId.startsWith(TEST_PREFIX));

  if (JSON.stringify(legacyVideoIds) !== JSON.stringify(prefetchedVideoIds)) {
    throw new Error(`Video result mismatch: legacy=${legacyVideoIds.join(',')} prefetched=${prefetchedVideoIds.join(',')}`);
  }

  console.log(`  PASS: Prefetched path matches legacy output (${legacyVideoIds.length} videos)`);
}

async function testSourceContainsOptimization() {
  console.log('\nTest 2: Source wiring uses prefetched artists to skip expensive scan');

  const catalogSource = await fs.readFile('apps/web/lib/catalog-data-core.ts', 'utf8');
  const pageSource = await fs.readFile('apps/web/app/(shell)/categories/[slug]/page.tsx', 'utf8');
  const apiSource = await fs.readFile('apps/web/app/api/categories/[slug]/route.ts', 'utf8');

  const hasPrefetchedNames = /const\s+prefetchedGenreArtistNames\s*=\s*\[\.\.\.new Set\(/m.test(catalogSource);
  const hasPrefetchedBypass = /prefetchedGenreArtistNames\.length\s*>\s*0/m.test(catalogSource);
  const pagePassesArtists = /getVideosByGenre\(genre,\s*\{[\s\S]*artists/m.test(pageSource);
  const apiPassesArtists = /const\s+videosWithProbe\s*=\s*await\s+getVideosByGenre\(genre,\s*\{[\s\S]*artists/m.test(apiSource);

  if (!hasPrefetchedNames || !hasPrefetchedBypass || !pagePassesArtists || !apiPassesArtists) {
    throw new Error('Expected prefetched-artist hotspot optimization wiring not found in source');
  }

  console.log('  PASS: Source contains hotspot optimization wiring');
}

async function main() {
  console.log('ARTIST GENRE FILTER HOTSPOT TEST SUITE');

  try {
    await setup();
    await testPrefetchedArtistPathParity();
    await testSourceContainsOptimization();

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
