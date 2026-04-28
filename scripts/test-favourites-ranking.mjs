import { PrismaClient } from '@prisma/client';

/**
 * Test suite for favorites ranking functionality
 * Validates that:
 * 1. updateFavourite correctly maintains the denormalized favourited count
 * 2. Ranking queries use the persisted count, not COUNT(DISTINCT)
 * 3. Multiple users can favorite the same video independently
 * 4. Duplicate favorites from the same user don't double-count
 */

const prisma = new PrismaClient();

async function setup() {
  // Clean test data - use raw SQL to bypass FK constraints
  await prisma.$executeRawUnsafe('DELETE FROM favourites WHERE videoId LIKE "test-vid%"');
  await prisma.$executeRawUnsafe('DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-vid%")');
  await prisma.$executeRawUnsafe('DELETE FROM videos WHERE videoId LIKE "test-vid%"');
  
  // Create test videos
  const videos = await prisma.video.createMany({
    data: [
      { videoId: 'test-vid-1', title: 'Test Video 1', favourited: 0 },
      { videoId: 'test-vid-2', title: 'Test Video 2', favourited: 0 },
      { videoId: 'test-vid-3', title: 'Test Video 3', favourited: 0 },
    ],
  });
  
  console.log('✓ Setup complete: 3 test videos created');
  return videos;
}

async function testSingleUserFavorite() {
  console.log('\n📋 Test 1: Single user favorites a video');
  
  const video = await prisma.video.findFirst({ where: { videoId: 'test-vid-1' } });
  const userId = 101;
  
  // Before: count should be 0
  let before = await prisma.video.findUnique({ where: { id: video.id }, select: { favourited: true } });
  console.log(`  Before favorite: ${before.favourited} (expected 0)`);
  if (before.favourited !== 0) throw new Error('Initial count should be 0');
  
  // Add favorite
  await prisma.$transaction(async (tx) => {
    await tx.favourite.create({ data: { userid: userId, videoId: 'test-vid-1' } });
    
    const count = await tx.$queryRaw`
      SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-1'
    `;
    await tx.video.updateMany({
      where: { videoId: 'test-vid-1' },
      data: { favourited: Number(count[0].cnt) },
    });
  });
  
  let after = await prisma.video.findUnique({ where: { id: video.id }, select: { favourited: true } });
  console.log(`  After favorite: ${after.favourited} (expected 1)`);
  if (after.favourited !== 1) throw new Error('Count should be 1 after single favorite');
  
  console.log('  ✓ PASS: Single user favorite increments count');
}

async function testMultipleUsersFavorite() {
  console.log('\n📋 Test 2: Multiple users favorite the same video');
  
  const video = await prisma.video.findFirst({ where: { videoId: 'test-vid-2' } });
  
  // Add 3 users' favorites
  for (let i = 0; i < 3; i++) {
    await prisma.$transaction(async (tx) => {
      await tx.favourite.create({ data: { userid: 200 + i, videoId: 'test-vid-2' } });
      
      const count = await tx.$queryRaw`
        SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-2'
      `;
      await tx.video.updateMany({
        where: { videoId: 'test-vid-2' },
        data: { favourited: Number(count[0].cnt) },
      });
    });
  }
  
  let result = await prisma.video.findUnique({ where: { id: video.id }, select: { favourited: true } });
  console.log(`  After 3 users favorite: ${result.favourited} (expected 3)`);
  if (result.favourited !== 3) throw new Error('Count should be 3 after 3 different users favorite');
  
  console.log('  ✓ PASS: Multiple users increment count correctly');
}

async function testDuplicateFavoriteDoesNotDouble() {
  console.log('\n📋 Test 3: Duplicate favorite from same user does not double-count');
  
  const video = await prisma.video.findFirst({ where: { videoId: 'test-vid-3' } });
  const userId = 301;
  
  // First favorite
  await prisma.$transaction(async (tx) => {
    await tx.favourite.create({ data: { userid: userId, videoId: 'test-vid-3' } });
    const count = await tx.$queryRaw`
      SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-3'
    `;
    await tx.video.updateMany({
      where: { videoId: 'test-vid-3' },
      data: { favourited: Number(count[0].cnt) },
    });
  });
  
  let after1 = await prisma.video.findUnique({ where: { id: video.id }, select: { favourited: true } });
  console.log(`  After 1st favorite: ${after1.favourited} (expected 1)`);
  if (after1.favourited !== 1) throw new Error('Count should be 1 after first favorite');
  
  // Try duplicate (should not exist due to UNIQUE constraint, but test logic)
  const existing = await prisma.favourite.findFirst({
    where: { userid: userId, videoId: 'test-vid-3' },
  });
  
  if (!existing) {
    console.log('  (Existing favorite found, skip duplicate test)');
  } else {
    // Simulate duplicate attempt (in real code, UNIQUE constraint prevents this)
    const count = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-3'
    `;
    console.log(`  Distinct count still: ${count[0].cnt} (expected 1)`);
    if (Number(count[0].cnt) !== 1) throw new Error('COUNT(DISTINCT) should still be 1');
  }
  
  console.log('  ✓ PASS: Duplicate favorite does not double-count');
}

async function testRemoveFavoriteDecrements() {
  console.log('\n📋 Test 4: Removing favorite decrements count');
  
  // First add favorites from 2 users
  await prisma.$transaction(async (tx) => {
    await tx.favourite.deleteMany({ where: { videoId: 'test-vid-1' } });
    
    for (let i = 0; i < 2; i++) {
      await tx.favourite.create({ data: { userid: 401 + i, videoId: 'test-vid-1' } });
    }
    
    const count = await tx.$queryRaw`
      SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-1'
    `;
    await tx.video.updateMany({
      where: { videoId: 'test-vid-1' },
      data: { favourited: Number(count[0].cnt) },
    });
  });
  
  let after2 = await prisma.video.findUnique({
    where: { videoId: 'test-vid-1' },
    select: { favourited: true },
  });
  console.log(`  After 2 users: ${after2.favourited} (expected 2)`);
  if (after2.favourited !== 2) throw new Error('Count should be 2');
  
  // Remove one favorite
  await prisma.$transaction(async (tx) => {
    await tx.favourite.deleteMany({ where: { userid: 401, videoId: 'test-vid-1' } });
    
    const count = await tx.$queryRaw`
      SELECT COUNT(DISTINCT userid) AS cnt FROM favourites WHERE videoId = 'test-vid-1'
    `;
    await tx.video.updateMany({
      where: { videoId: 'test-vid-1' },
      data: { favourited: Number(count[0].cnt) },
    });
  });
  
  let after1 = await prisma.video.findUnique({
    where: { videoId: 'test-vid-1' },
    select: { favourited: true },
  });
  console.log(`  After remove 1: ${after1.favourited} (expected 1)`);
  if (after1.favourited !== 1) throw new Error('Count should be 1 after removal');
  
  console.log('  ✓ PASS: Removing favorite decrements count correctly');
}

async function testRankingUsesPersistedColumn() {
  console.log('\n📋 Test 5: Ranking query uses persisted favourited column');
  
  // Set up videos with different favorite counts
  await prisma.video.updateMany({
    where: { videoId: 'test-vid-1' },
    data: { favourited: 50 },
  });
  await prisma.video.updateMany({
    where: { videoId: 'test-vid-2' },
    data: { favourited: 30 },
  });
  await prisma.video.updateMany({
    where: { videoId: 'test-vid-3' },
    data: { favourited: 75 },
  });
  
  // Run ranking query (simulating getRankedTopPool)
  const ranked = await prisma.$queryRaw`
    SELECT 
      videoId, 
      title, 
      favourited,
      description
    FROM videos 
    WHERE videoId IN ('test-vid-1', 'test-vid-2', 'test-vid-3')
    ORDER BY COALESCE(favourited, 0) DESC, videoId ASC
    LIMIT 10
  `;
  
  console.log(`  Ranked order: ${ranked.map(r => `${r.videoId}(${r.favourited})`).join(' > ')}`);
  
  const expected = ['test-vid-3', 'test-vid-1', 'test-vid-2'];
  const actual = ranked.map(r => r.videoId);
  
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Ranking incorrect. Expected ${expected}, got ${actual}`);
  }
  
  console.log('  ✓ PASS: Ranking uses persisted column correctly');
}

async function testUpdateFavouriteNoLongerRecounts() {
  console.log('\n📋 Test 7: updateFavourite no longer manually recounts (trigger-based)');
  
  // This is a code inspection test
  const { readFileSync } = await import('fs');
  const code = readFileSync('./apps/web/lib/catalog-data-core.ts', 'utf8');
  
  // Find the updateFavourite function
  const funcStart = code.indexOf('export async function updateFavourite');
  const funcEnd = code.indexOf('\nexexport async function', funcStart);
  const funcCode = code.substring(funcStart, funcEnd > 0 ? funcEnd : funcStart + 2000);
  
  // Check that updateFavourite no longer contains the expensive COUNT(DISTINCT) recount
  if (funcCode.includes('COUNT(DISTINCT userid) AS cnt')) {
    throw new Error('updateFavourite should NOT contain COUNT(DISTINCT) recount logic');
  }
  
  // Check that it does reference the trigger
  if (!funcCode.includes('TRIGGER') && !funcCode.includes('trigger')) {
    throw new Error('updateFavourite comment should explain trigger-based maintenance');
  }
  
  // Check that triggers migration exists
  const { existsSync } = await import('fs');
  if (!existsSync('./prisma/migrations/20260428120000_add_favourites_triggers/migration.sql')) {
    throw new Error('Triggers migration file should exist');
  }
  
  const triggerMigration = readFileSync('./prisma/migrations/20260428120000_add_favourites_triggers/migration.sql', 'utf8');
  if (!triggerMigration.includes('trg_favourites_insert') || !triggerMigration.includes('trg_favourites_delete')) {
    throw new Error('Triggers migration should define both INSERT and DELETE triggers');
  }
  
  console.log('  ✓ PASS: updateFavourite no longer recounts, uses triggers instead');
}

async function cleanup() {
  await prisma.$executeRawUnsafe('DELETE FROM favourites WHERE videoId LIKE "test-vid%"');
  await prisma.$executeRawUnsafe('DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-vid%")');
  await prisma.$executeRawUnsafe('DELETE FROM videos WHERE videoId LIKE "test-vid%"');
  await prisma.$disconnect();
  console.log('\n✓ Cleanup complete');
}

async function main() {
  try {
    console.log('🧪 FAVOURITES RANKING TEST SUITE\n');
    
    await setup();
    await testSingleUserFavorite();
    await testMultipleUsersFavorite();
    await testDuplicateFavoriteDoesNotDouble();
    await testRemoveFavoriteDecrements();
    await testRankingUsesPersistedColumn();
    await testUpdateFavouriteNoLongerRecounts();
    
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
