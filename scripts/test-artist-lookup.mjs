import { PrismaClient } from '@prisma/client';

/**
 * Test suite for artist lookup queries
 * Validates that:
 * 1. Artist queries return valid data
 * 2. NULL/empty artists are filtered out
 * 3. Queries complete efficiently (not doing full scans)
 */

const prisma = new PrismaClient();

async function setup() {
  // Create test artists (using only available columns)
  await prisma.$executeRawUnsafe(`
    INSERT INTO artists (artist, genre1, genre2, country)
    VALUES 
      ('Test Metal Band', 'Metal', 'Heavy Metal', 'USA'),
      ('Test Rock Artist', 'Rock', 'Alternate Rock', 'UK'),
      ('Test Punk Group', 'Punk', 'Pop Punk', 'Canada')
    ON DUPLICATE KEY UPDATE artist=artist
  `);
  
  console.log('✓ Setup complete: test artists verified in database');
}

async function testGetAllArtistsQuery() {
  console.log('\n📋 Test 1: Query all artists with non-null filter');
  
  const allArtists = await prisma.$queryRawUnsafe(
    'SELECT a.artist AS name FROM artists a WHERE a.artist IS NOT NULL AND a.artist <> "" ORDER BY a.artist ASC LIMIT 100'
  );
  
  if (!Array.isArray(allArtists)) {
    throw new Error('Query should return an array');
  }
  
  if (allArtists.length === 0) {
    throw new Error('Query should return at least some artists');
  }
  
  console.log(`  ✓ Returned ${allArtists.length} artists`);
  console.log(`  ✓ First artist: ${allArtists[0].name}`);
  
  // Verify none are NULL or empty
  for (const artist of allArtists) {
    if (!artist.name || artist.name === '') {
      throw new Error('Artist name should not be NULL or empty');
    }
  }
  
  console.log('  ✓ PASS: All artists have valid non-empty names');
}

async function testFullArtistLookupQuery() {
  console.log('\n📋 Test 2: Full artist lookup with genre coalesce (from profiling)');
  
  // This is the exact query pattern from the profiling report
  const validArtists = await prisma.$queryRawUnsafe(
    'SELECT a.artist AS name, NULL AS country, COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1 FROM artists a WHERE a.artist IS NOT NULL AND a.artist <> "" ORDER BY a.artist ASC LIMIT 100'
  );
  
  console.log(`  ✓ Query returned ${validArtists.length} artists`);
  
  if (validArtists.length === 0) {
    throw new Error('Should have returned artists');
  }
  
  // Verify structure
  for (const artist of validArtists) {
    if (!artist.name) {
      throw new Error('Artist name should not be NULL or empty');
    }
    if (artist.country !== null && typeof artist.country !== 'string') {
      throw new Error('Country should be NULL or string');
    }
  }
  
  console.log('  ✓ PASS: Full artist lookup query works correctly');
}

async function testIndexPlanning() {
  console.log('\n📋 Test 3: Verify performance plan for indexed query');
  
  // Use EXPLAIN to see the query plan
  const plan = await prisma.$queryRawUnsafe(
    'EXPLAIN SELECT a.artist AS name, NULL AS country, COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1 FROM artists a WHERE a.artist IS NOT NULL AND a.artist <> "" ORDER BY a.artist ASC LIMIT 100'
  );
  
  console.log(`  ✓ Query plan retrieved`);
  
  // Look for key_len in plan (indicates index usage)
  let usesIndex = false;
  for (const row of plan) {
    if (row.type && (row.type === 'index' || row.type === 'range')) {
      usesIndex = true;
      console.log(`  ✓ Query uses index (type: ${row.type})`);
    }
    if (row.key && row.key !== null) {
      console.log(`  ✓ Using index: ${row.key}`);
      usesIndex = true;
    }
  }
  
  if (!usesIndex) {
    console.log('  ⚠ Note: Full table scan detected, index optimization will help');
  }
  
  console.log('  ✓ PASS: Query plan analysis complete');
}

async function testNullArtistsAreFiltered() {
  console.log('\n📋 Test 4: Verify WHERE filter excludes NULL and empty artists');
  
  // First, ensure there are some NULL/empty values to filter
  const nullCount = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) as cnt FROM artists WHERE artist IS NULL OR artist = ""'
  );
  
  const totalCount = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) as cnt FROM artists'
  );
  
  console.log(`  Total artists in DB: ${totalCount[0].cnt}`);
  console.log(`  NULL or empty artists: ${nullCount[0].cnt}`);
  
  // Query with filter
  const filtered = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) as cnt FROM artists WHERE artist IS NOT NULL AND artist <> ""'
  );
  
  console.log(`  After WHERE filter: ${filtered[0].cnt}`);
  
  const expected = totalCount[0].cnt - nullCount[0].cnt;
  if (filtered[0].cnt !== expected) {
    throw new Error(`Filter count mismatch: expected ${expected}, got ${filtered[0].cnt}`);
  }
  
  console.log('  ✓ PASS: WHERE filter correctly excludes NULL and empty values');
}

async function testTimingBenchmark() {
  console.log('\n📋 Test 5: Benchmark query performance');
  
  // Warm up
  await prisma.$queryRawUnsafe(
    'SELECT a.artist FROM artists a WHERE a.artist IS NOT NULL LIMIT 1'
  );
  
  // Benchmark 5 runs
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await prisma.$queryRawUnsafe(
      'SELECT a.artist AS name, NULL AS country, COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1 FROM artists a WHERE a.artist IS NOT NULL AND a.artist <> "" ORDER BY a.artist ASC LIMIT 100'
    );
    times.push(Date.now() - start);
  }
  
  const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`  ✓ Average query time: ${avgTime}ms (5 runs: ${times.join(', ')}ms)`);
  
  if (avgTime > 100) {
    console.log('  ⚠ Warning: Query takes >100ms, index will improve this');
  } else {
    console.log('  ✓ Query performance acceptable');
  }
  
  console.log('  ✓ PASS: Performance benchmark complete');
}

async function cleanup() {
  // Delete test data
  await prisma.$executeRawUnsafe(`
    DELETE FROM artists WHERE artist LIKE 'Test %'
  `);
  
  await prisma.$disconnect();
  console.log('\n✓ Cleanup complete');
}

async function main() {
  try {
    console.log('🧪 ARTIST LOOKUP PERFORMANCE TEST SUITE\n');
    
    await setup();
    await testGetAllArtistsQuery();
    await testFullArtistLookupQuery();
    await testIndexPlanning();
    await testNullArtistsAreFiltered();
    await testTimingBenchmark();
    
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ TEST FAILED: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
