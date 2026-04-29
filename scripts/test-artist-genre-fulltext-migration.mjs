import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'tgh4ft';

function normalizeArtist(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM artists WHERE artist LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();
  await prisma.$executeRawUnsafe(`
    INSERT INTO artists (artist, country, genre1, genre2, genre3, genre4, genre5, genre6)
    VALUES
      ('${TEST_PREFIX} alpha', 'US', '8-bit metal', NULL, NULL, NULL, NULL, NULL),
      ('${TEST_PREFIX} beta', 'US', 'chiptune', '8-bit', NULL, NULL, NULL, NULL),
      ('${TEST_PREFIX} gamma', 'US', 'doom metal', NULL, NULL, NULL, NULL, NULL)
  `);
}

async function testSchemaSupport() {
  console.log('\nTest 1: genre_all column + fulltext index exist');

  const colRows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artists LIKE 'genre_all'");
  const indexRows = await prisma.$queryRawUnsafe("SHOW INDEX FROM artists");
  const hasFulltext = indexRows.some((row) => row.Column_name === 'genre_all' && String(row.Index_type).toUpperCase() === 'FULLTEXT');

  if (colRows.length === 0) {
    throw new Error('artists.genre_all column is missing');
  }
  if (!hasFulltext) {
    throw new Error('FULLTEXT index on artists.genre_all is missing');
  }

  console.log('  PASS: schema objects exist');
}

async function testTriggerSync() {
  console.log('\nTest 2: trigger synchronization keeps genre_all fresh');

  await prisma.$executeRawUnsafe(
    `UPDATE artists SET genre2 = 'synthwave' WHERE artist = ?`,
    `${TEST_PREFIX} alpha`,
  );

  const rows = await prisma.$queryRawUnsafe(
    `SELECT artist, genre_all FROM artists WHERE artist = ? LIMIT 1`,
    `${TEST_PREFIX} alpha`,
  );

  const blob = String(rows[0]?.genre_all ?? '').toLowerCase();
  if (!blob.includes('8-bit') || !blob.includes('synthwave')) {
    throw new Error(`genre_all did not reflect updated genres: ${blob}`);
  }

  console.log('  PASS: trigger sync works');
}

async function testFulltextAndLikeParityForSample() {
  console.log('\nTest 3: fulltext path returns same sample set as legacy LIKE for 8-bit');

  const fulltextRows = await prisma.$queryRaw`
    SELECT a.artist AS name
    FROM artists a
    WHERE MATCH(a.genre_all) AGAINST (${"bit* 8bit*"} IN BOOLEAN MODE)
      AND a.artist LIKE ${`${TEST_PREFIX}%`}
    ORDER BY a.artist ASC
  `;

  const likeRows = await prisma.$queryRaw`
    SELECT a.artist AS name
    FROM artists a
    WHERE (
      a.genre1 LIKE CONCAT('%', ${'8-bit'}, '%')
      OR a.genre2 LIKE CONCAT('%', ${'8-bit'}, '%')
      OR a.genre3 LIKE CONCAT('%', ${'8-bit'}, '%')
      OR a.genre4 LIKE CONCAT('%', ${'8-bit'}, '%')
      OR a.genre5 LIKE CONCAT('%', ${'8-bit'}, '%')
      OR a.genre6 LIKE CONCAT('%', ${'8-bit'}, '%')
    )
      AND a.artist LIKE ${`${TEST_PREFIX}%`}
    ORDER BY a.artist ASC
  `;

  const f = fulltextRows.map((r) => normalizeArtist(r.name));
  const l = likeRows.map((r) => normalizeArtist(r.name));

  if (JSON.stringify(f) !== JSON.stringify(l)) {
    throw new Error(`parity mismatch: fulltext=${f.join(',')} like=${l.join(',')}`);
  }

  console.log(`  PASS: parity holds for sample (${f.length} artists)`);
}

async function testSourceWiring() {
  console.log('\nTest 4: source contains guarded fulltext + LIKE fallback path');
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('apps/web/lib/catalog-data-core.ts', 'utf8');

  const hasGuard = /ensureArtistGenreFulltextAvailable\(/m.test(source);
  const hasBuilder = /function\s+buildGenreFulltextQuery\(/m.test(source);
  const hasFallback = /if \(artists\.length === 0\) \{\s*artists = await loadArtistsByLike\(\);/m.test(source);

  if (!hasGuard || !hasBuilder || !hasFallback) {
    throw new Error('missing fulltext guard/builder/fallback source wiring');
  }

  console.log('  PASS: source wiring found');
}

async function main() {
  console.log('ARTIST GENRE FULLTEXT MIGRATION TEST SUITE');
  try {
    await setup();
    await testSchemaSupport();
    await testTriggerSync();
    await testFulltextAndLikeParityForSample();
    await testSourceWiring();
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
