#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Load DATABASE_URL from .env.local if not set
if (!process.env.DATABASE_URL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(__dirname, "../apps/web/.env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    const databaseUrlLine = lines.find((line) => line.startsWith("DATABASE_URL="));
    if (databaseUrlLine) {
      process.env.DATABASE_URL = databaseUrlLine.replace(/^DATABASE_URL="?/, "").replace(/"?$/, "");
    }
  }
}

const prisma = new PrismaClient();

// Color helpers
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const blue = (s) => `\x1b[36m${s}\x1b[0m`;

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ${green("✓")} ${message}`);
  } else {
    testsFailed++;
    console.log(`  ${red("✗")} ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function assertEqual(actual, expected, message) {
  if (actual === expected) {
    testsPassed++;
    console.log(`  ${green("✓")} ${message} (expected: ${expected})`);
  } else {
    testsFailed++;
    console.log(`  ${red("✗")} ${message} (expected: ${expected}, got: ${actual})`);
    throw new Error(`Assertion failed: ${message}`);
  }
  testsRun++;
}

async function cleanup() {
  console.log("\n📋 Cleaning up test data...");
  
  // Delete in correct order to avoid FK constraints
  await prisma.$executeRawUnsafe('DELETE FROM playlistitems WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-orphan-%")');
  await prisma.$executeRawUnsafe('DELETE FROM videosbyartist WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-orphan-%")');
  await prisma.$executeRawUnsafe('DELETE FROM favourites WHERE videoId LIKE "test-orphan-%"');
  await prisma.$executeRawUnsafe('DELETE FROM messages WHERE video_id LIKE "test-orphan-%"');
  await prisma.$executeRawUnsafe('DELETE FROM related WHERE videoId LIKE "test-orphan-%" OR related LIKE "test-orphan-%"');
  await prisma.$executeRawUnsafe('DELETE FROM site_video_availability_summary WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-orphan-%")');
  await prisma.$executeRawUnsafe('DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-orphan-%")');
  await prisma.$executeRawUnsafe('DELETE FROM videos WHERE videoId LIKE "test-orphan-%"');
  await prisma.$executeRawUnsafe('DELETE FROM rejected_videos WHERE video_id LIKE "test-orphan-%"');
  
  console.log("✓ Cleanup complete\n");
}

async function setupTestData() {
  console.log("📊 Setting up test data...\n");
  
  const now = new Date();
  
  // Create test videos with different scenarios
  const testVideos = [
    { videoId: "test-orphan-1", title: "Video with available site_videos", scenario: "available" },
    { videoId: "test-orphan-2", title: "Video with unavailable site_videos", scenario: "unavailable" },
    { videoId: "test-orphan-3", title: "Video with check-failed site_videos", scenario: "check-failed" },
    { videoId: "test-orphan-4", title: "Orphaned video (no site_videos)", scenario: "orphaned" },
    { videoId: "test-orphan-5", title: "Video with available AND unavailable", scenario: "mixed" },
  ];
  
  const created = [];
  for (const video of testVideos) {
    const v = await prisma.video.create({
      data: {
        videoId: video.videoId,
        title: video.title,
      },
    });
    created.push({ ...video, id: v.id });
  }
  
  // Create site_videos entries for each scenario
  for (const video of created) {
    if (video.scenario === "available") {
      await prisma.siteVideo.create({
        data: {
          videoId: video.id,
          title: video.title,
          status: "available",
        },
      });
    } else if (video.scenario === "unavailable") {
      await prisma.siteVideo.create({
        data: {
          videoId: video.id,
          title: video.title,
          status: "unavailable",
        },
      });
    } else if (video.scenario === "check-failed") {
      await prisma.siteVideo.create({
        data: {
          videoId: video.id,
          title: video.title,
          status: "check-failed",
        },
      });
    } else if (video.scenario === "mixed") {
      // Create both available and unavailable
      await prisma.siteVideo.create({
        data: {
          videoId: video.id,
          title: video.title + " (available)",
          status: "available",
        },
      });
      await prisma.siteVideo.create({
        data: {
          videoId: video.id,
          title: video.title + " (unavailable)",
          status: "unavailable",
        },
      });
    }
    // For orphaned: don't create any site_videos entry
  }
  
  // Create some related entries and playlist items to test cascading deletes
  const video2 = created.find((v) => v.scenario === "unavailable");
  const video4 = created.find((v) => v.scenario === "orphaned");
  
  if (video2 && video4) {
    // Create a playlist with items pointing to videos that will be deleted
    const playlist = await prisma.playlistName.create({
      data: {
        name: "Test Playlist",
        isPrivate: false,
      },
    });
    
    await prisma.playlistItem.create({
      data: {
        playlistId: playlist.id,
        videoId: video2.id,
      },
    });
    
    await prisma.playlistItem.create({
      data: {
        playlistId: playlist.id,
        videoId: video4.id,
      },
    });
    
    // Create artist-video links
    await prisma.artistVideo.create({
      data: {
        artist: "Test Artist",
        videoId: video2.id,
      },
    });
    
    await prisma.artistVideo.create({
      data: {
        artist: "Test Artist",
        videoId: video4.id,
      },
    });
  }
  
  console.log(`✓ Created ${created.length} test videos with various scenarios\n`);
  return created;
}

async function testStep7CleanupQuery() {
  console.log(blue("\n🧪 Testing Step 7: Delete videos without available site_videos\n"));
  
  // Disable foreign key checks for testing
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  
  // Count videos before cleanup
  const beforeVideos = await prisma.video.count({
    where: { videoId: { startsWith: "test-orphan-" } },
  });
  
  const beforeRejected = await prisma.rejectedVideo.count({
    where: { videoId: { startsWith: "test-orphan-" } },
  });
  
  console.log(`Before cleanup:`);
  console.log(`  Videos: ${beforeVideos}`);
  console.log(`  Rejected: ${beforeRejected}\n`);
  
  // Step 1: Capture unavailable and check-failed videos to rejected_videos
  console.log("Executing: Step 1 - Capture unavailable/check-failed videos...");
  const step1Result = await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO rejected_videos (video_id, reason, rejected_at)
    SELECT
      v.videoId AS video_id,
      sv.status AS reason,
      COALESCE(sv.created_at, v.created_at, NOW()) AS rejected_at
    FROM videos v
    INNER JOIN site_videos sv ON sv.video_id = v.id
    WHERE sv.status IN ('unavailable', 'check-failed')
      AND v.videoId IS NOT NULL
      AND v.videoId LIKE 'test-orphan-%'
  `);
  console.log(`  Inserted/ignored: ${step1Result} rows\n`);
  
  // Step 2: Capture orphaned videos
  console.log("Executing: Step 2 - Capture orphaned videos (NOT EXISTS)...");
  const step2Result = await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO rejected_videos (video_id, reason, rejected_at)
    SELECT
      v.videoId AS video_id,
      'orphaned' AS reason,
      COALESCE(v.created_at, NOW()) AS rejected_at
    FROM videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id
    )
      AND v.videoId IS NOT NULL
      AND v.videoId LIKE 'test-orphan-%'
  `);
  console.log(`  Inserted/ignored: ${step2Result} rows\n`);
  
  // Verify Step 2 was captured
  const orphanedCaptured = await prisma.rejectedVideo.count({
    where: { videoId: { startsWith: "test-orphan-" }, reason: "orphaned" },
  });
  assertEqual(orphanedCaptured, 1, "Exactly 1 orphaned video captured");
  
  // Step 3: Delete site_videos for unavailable/check-failed
  console.log("\nExecuting: Step 3 - Delete site_videos for unavailable/check-failed...");
  const step3Result = await prisma.$executeRawUnsafe(`
    DELETE sv
    FROM site_videos sv
    INNER JOIN videos v ON v.id = sv.video_id
    WHERE sv.status IN ('unavailable', 'check-failed')
      AND v.videoId LIKE 'test-orphan-%'
  `);
  console.log(`  Deleted: ${step3Result} rows\n`);
  
  // Step 4: Delete orphaned site_videos entries
  console.log("Executing: Step 4 - Delete orphaned site_videos entries...");
  const step4Result = await prisma.$executeRawUnsafe(`
    DELETE sv
    FROM site_videos sv
    WHERE sv.video_id NOT IN (SELECT id FROM videos WHERE videoId LIKE 'test-orphan-%')
      OR sv.video_id IS NULL
  `);
  console.log(`  Deleted: ${step4Result} rows\n`);
  
  // Step 5: Delete playlist items pointing to videos with no available site_videos
  console.log("Executing: Step 5 - Delete playlist items...");
  const step5Result = await prisma.$executeRawUnsafe(`
    DELETE pi
    FROM playlistitems pi
    INNER JOIN videos v ON v.id = pi.video_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-orphan-%'
  `);
  console.log(`  Deleted: ${step5Result} rows\n`);
  
  // Verify playlist items were deleted
  const playlistItemsRemaining = await prisma.playlistItem.count({
    where: {
      video: {
        videoId: { startsWith: "test-orphan-" },
      },
    },
  });
  assertEqual(playlistItemsRemaining, 0, "All playlist items for videos without available site_videos are deleted");
  
  // Step 6: Delete artist-video links
  console.log("Executing: Step 6 - Delete artist-video links...");
  const step6Result = await prisma.$executeRawUnsafe(`
    DELETE va
    FROM videosbyartist va
    INNER JOIN videos v ON v.id = va.video_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-orphan-%'
  `);
  console.log(`  Deleted: ${step6Result} rows\n`);
  
  // Verify artist links were deleted
  const artistLinksRemaining = await prisma.artistVideo.count({
    where: {
      video: {
        videoId: { startsWith: "test-orphan-" },
      },
    },
  });
  assertEqual(artistLinksRemaining, 0, "All artist links for videos without available site_videos are deleted");
  
  // Step 7: THE SLOW QUERY - Delete videos without available site_videos
  console.log("Executing: Step 7 - Delete videos without available site_videos (NOT EXISTS anti-join)...");
  const step7Start = Date.now();
  const step7Result = await prisma.$executeRawUnsafe(`
    DELETE v
    FROM videos v
    WHERE NOT EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-orphan-%'
  `);
  const step7Duration = Date.now() - step7Start;
  console.log(`  Deleted: ${step7Result} rows in ${step7Duration}ms\n`);
  
  // Verify final state
  const afterVideos = await prisma.video.count({
    where: { videoId: { startsWith: "test-orphan-" } },
  });
  
  const siteVideosRemaining = await prisma.siteVideo.count({
    where: {
      video: {
        videoId: { startsWith: "test-orphan-" },
      },
    },
  });
  
  const rejectedVideos = await prisma.rejectedVideo.count({
    where: { videoId: { startsWith: "test-orphan-" } },
  });
  
  console.log(`After cleanup:`);
  console.log(`  Videos: ${afterVideos}`);
  console.log(`  Site Videos (should be 1 - only available): ${siteVideosRemaining}`);
  console.log(`  Rejected Videos (should be 4): ${rejectedVideos}\n`);
  
  assertEqual(afterVideos, 2, "Videos with available site_videos entries remain (test-orphan-1 and test-orphan-5)");
  assertEqual(siteVideosRemaining, 2, "2 site_videos entries remain (1 available from test-orphan-1, 1 available from test-orphan-5)");
  assertEqual(rejectedVideos, 4, "4 videos captured as rejected");
  
  // Re-enable foreign key checks
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
  
  console.log(green("\n✓ Step 7 cleanup test passed\n"));
  return { step7Result, step7Duration };
}

async function testAlternativeOptimization() {
  console.log(blue("\n🚀 Testing alternative LEFT JOIN optimization\n"));
  
  // Set up fresh test data for the optimization test
  await cleanup();
  await setupTestData();
  
  // Disable foreign key checks for testing
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  
  console.log("Executing: Alternative LEFT JOIN approach...\n");
  
  // Must run prerequisite cleanup steps first (Steps 5 & 6)
  await prisma.$executeRawUnsafe(`
    DELETE pi
    FROM playlistitems pi
    INNER JOIN videos v ON v.id = pi.video_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-orphan-%'
  `);
  
  await prisma.$executeRawUnsafe(`
    DELETE va
    FROM videosbyartist va
    INNER JOIN videos v ON v.id = va.video_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM site_videos sv
      WHERE sv.video_id = v.id
        AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-orphan-%'
  `);
  
  const altStart = Date.now();
  const altResult = await prisma.$executeRawUnsafe(`
    DELETE v
    FROM videos v
    LEFT JOIN (
      SELECT DISTINCT video_id
      FROM site_videos
      WHERE status = 'available'
    ) sv_available ON sv_available.video_id = v.id
    WHERE sv_available.video_id IS NULL
      AND v.videoId LIKE 'test-orphan-%'
  `);
  const altDuration = Date.now() - altStart;
  
  console.log(`  Deleted: ${altResult} rows in ${altDuration}ms\n`);
  
  const afterVideos = await prisma.video.count({
    where: { videoId: { startsWith: "test-orphan-" } },
  });
  
  assertEqual(afterVideos, 2, "LEFT JOIN approach: Videos with available site_videos entries remain");
  
  // Re-enable foreign key checks
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
  
  console.log(green("\n✓ LEFT JOIN optimization test passed\n"));
  
  return { altResult, altDuration };
}

async function main() {
  try {
    console.log(`\n${blue("🔬 Testing Orphaned Data Cleanup Queries")}\n`);
    console.log("This test suite verifies that the orphan cleanup migration works correctly");
    console.log("and measures performance of the anti-join pattern vs. optimized alternatives.\n");
    
    // Cleanup any existing test data first
    await cleanup();
    
    // Set up test data
    const testData = await setupTestData();
    
    // Test Step 7 (the slow query)
    const step7Metrics = await testStep7CleanupQuery();
    
    // Clean again and test optimization
    await cleanup();
    await setupTestData();
    const altMetrics = await testAlternativeOptimization();
    
    // Summary
    console.log(blue("\n📊 Performance Comparison\n"));
    console.log(`Step 7 (NOT EXISTS anti-join): ${step7Metrics.step7Duration}ms`);
    console.log(`Alternative (LEFT JOIN):       ${altMetrics.altDuration}ms`);
    
    const improvement = ((step7Metrics.step7Duration - altMetrics.altDuration) / step7Metrics.step7Duration * 100).toFixed(1);
    if (altMetrics.altDuration < step7Metrics.step7Duration) {
      console.log(`${green(`✓ ${improvement}% faster`)}\n`);
    } else {
      console.log(`Note: Results may vary based on query planner optimization\n`);
    }
    
    // Final cleanup
    await cleanup();
    
    // Test summary
    console.log(blue("\n📋 Test Summary\n"));
    console.log(`${green(testsPassed)} passed`);
    if (testsFailed > 0) {
      console.log(`${red(testsFailed)} failed`);
    }
    console.log(`${testsRun} total\n`);
    
    if (testsFailed === 0) {
      console.log(green("✓ All tests passed!\n"));
      process.exit(0);
    } else {
      console.log(red("✗ Some tests failed\n"));
      process.exit(1);
    }
  } catch (error) {
    console.error(red("\n✗ Test execution failed:\n"), error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
