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

async function cleanup() {
  console.log("\n📋 Cleaning up test data...");
  
  // Delete in correct order to avoid FK constraints
  await prisma.$executeRawUnsafe('DELETE FROM playlistitems WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-load-%")');
  await prisma.$executeRawUnsafe('DELETE FROM videosbyartist WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-load-%")');
  await prisma.$executeRawUnsafe('DELETE FROM favourites WHERE videoId LIKE "test-load-%"');
  await prisma.$executeRawUnsafe('DELETE FROM messages WHERE video_id LIKE "test-load-%"');
  await prisma.$executeRawUnsafe('DELETE FROM related WHERE videoId LIKE "test-load-%" OR related LIKE "test-load-%"');
  await prisma.$executeRawUnsafe('DELETE FROM site_video_availability_summary WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-load-%")');
  await prisma.$executeRawUnsafe('DELETE FROM site_videos WHERE video_id IN (SELECT id FROM videos WHERE videoId LIKE "test-load-%")');
  await prisma.$executeRawUnsafe('DELETE FROM videos WHERE videoId LIKE "test-load-%"');
  await prisma.$executeRawUnsafe('DELETE FROM rejected_videos WHERE video_id LIKE "test-load-%"');
  
  console.log("✓ Cleanup complete\n");
}

async function setupLargeTestData(count = 1000) {
  console.log(`📊 Setting up ${count} test videos...\n`);
  
  const scenarios = [
    { name: "available", ratio: 0.4 },      // 40% with available status
    { name: "unavailable", ratio: 0.3 },    // 30% with unavailable status
    { name: "orphaned", ratio: 0.3 },       // 30% orphaned (no site_videos)
  ];
  
  let created = 0;
  
  for (const scenario of scenarios) {
    const targetCount = Math.floor(count * scenario.ratio);
    
    console.log(`  Creating ${targetCount} ${scenario.name} videos...`);
    
    // Batch insert videos
    const videoData = [];
    for (let i = 0; i < targetCount; i++) {
      videoData.push({
        videoId: `test-load-${scenario.name}-${i}`,
        title: `${scenario.name} Video ${i}`,
      });
    }
    
    const videos = await prisma.video.createMany({
      data: videoData,
      skipDuplicates: true,
    });
    
    created += videos.count;
    
    // Create site_videos entries if not orphaned
    if (scenario.name !== "orphaned") {
      const siteVideoData = [];
      let videoIndex = 0;
      for (const v of (await prisma.video.findMany({
        where: { videoId: { startsWith: `test-load-${scenario.name}-` } },
        select: { id: true },
      }))) {
        siteVideoData.push({
          videoId: v.id,
          title: `${scenario.name} Video ${videoIndex}`,
          status: scenario.name,
        });
        videoIndex++;
      }
      
      await prisma.siteVideo.createMany({
        data: siteVideoData,
        skipDuplicates: true,
      });
    }
  }
  
  console.log(`✓ Created ${created} test videos\n`);
  return created;
}

async function testOriginalApproach() {
  console.log(blue("\n📊 Testing ORIGINAL: NOT EXISTS anti-join\n"));
  
  const start = Date.now();
  
  // Clean prerequisite rows
  await prisma.$executeRawUnsafe(`
    DELETE pi FROM playlistitems pi
    INNER JOIN videos v ON v.id = pi.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  await prisma.$executeRawUnsafe(`
    DELETE va FROM videosbyartist va
    INNER JOIN videos v ON v.id = va.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  // The slow query - NOT EXISTS anti-join
  const queryStart = Date.now();
  const result = await prisma.$executeRawUnsafe(`
    DELETE v FROM videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM site_videos sv
      WHERE sv.video_id = v.id AND sv.status = 'available'
    )
      AND v.videoId LIKE 'test-load-%'
  `);
  const queryDuration = Date.now() - queryStart;
  const totalDuration = Date.now() - start;
  
  console.log(`  Deleted: ${result} rows`);
  console.log(`  Query time: ${queryDuration}ms`);
  console.log(`  Total time (with prerequisites): ${totalDuration}ms\n`);
  
  return { result, queryDuration, totalDuration };
}

async function testOptimizedApproach() {
  console.log(blue("\n🚀 Testing OPTIMIZED: Temp table + IN approach\n"));
  
  const start = Date.now();
  
  // Clean prerequisite rows
  await prisma.$executeRawUnsafe(`
    DELETE pi FROM playlistitems pi
    INNER JOIN videos v ON v.id = pi.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  await prisma.$executeRawUnsafe(`
    DELETE va FROM videosbyartist va
    INNER JOIN videos v ON v.id = va.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  // The optimized approach - use temp table
  const queryStart = Date.now();
  
  // Build temp table once
  await prisma.$executeRawUnsafe(`
    CREATE TEMPORARY TABLE available_video_ids_test AS
    SELECT DISTINCT video_id FROM site_videos
    WHERE status = 'available' AND video_id IS NOT NULL
  `);
  
  // Create index on temp table
  await prisma.$executeRawUnsafe(`
    CREATE INDEX idx_available_video_ids_test ON available_video_ids_test(video_id)
  `);
  
  // Simple IN-based delete
  const result = await prisma.$executeRawUnsafe(`
    DELETE v FROM videos v
    WHERE v.id NOT IN (SELECT video_id FROM available_video_ids_test)
      AND v.videoId LIKE 'test-load-%'
  `);
  
  const queryDuration = Date.now() - queryStart;
  const totalDuration = Date.now() - start;
  
  console.log(`  Deleted: ${result} rows`);
  console.log(`  Query time: ${queryDuration}ms`);
  console.log(`  Total time (with prerequisites): ${totalDuration}ms\n`);
  
  return { result, queryDuration, totalDuration };
}

async function testAlternativeLEFTJOINApproach() {
  console.log(blue("\n↔️  Testing ALTERNATIVE: LEFT JOIN anti-join\n"));
  
  const start = Date.now();
  
  // Clean prerequisite rows
  await prisma.$executeRawUnsafe(`
    DELETE pi FROM playlistitems pi
    INNER JOIN videos v ON v.id = pi.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  await prisma.$executeRawUnsafe(`
    DELETE va FROM videosbyartist va
    INNER JOIN videos v ON v.id = va.video_id
    WHERE NOT EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available')
      AND v.videoId LIKE 'test-load-%'
  `);
  
  // LEFT JOIN based anti-join
  const queryStart = Date.now();
  const result = await prisma.$executeRawUnsafe(`
    DELETE v FROM videos v
    LEFT JOIN (
      SELECT DISTINCT video_id FROM site_videos WHERE status = 'available'
    ) sv_available ON sv_available.video_id = v.id
    WHERE sv_available.video_id IS NULL
      AND v.videoId LIKE 'test-load-%'
  `);
  const queryDuration = Date.now() - queryStart;
  const totalDuration = Date.now() - start;
  
  console.log(`  Deleted: ${result} rows`);
  console.log(`  Query time: ${queryDuration}ms`);
  console.log(`  Total time (with prerequisites): ${totalDuration}ms\n`);
  
  return { result, queryDuration, totalDuration };
}

async function main() {
  try {
    console.log(`\n${blue("📊 Load Testing: Orphan Cleanup Query Optimization")}\n`);
    
    await cleanup();
    const testDataCount = await setupLargeTestData(1000);
    
    // Test original approach
    const originalMetrics = await testOriginalApproach();
    
    // Reset test data
    await cleanup();
    await setupLargeTestData(1000);
    
    // Test optimized approach
    const optimizedMetrics = await testOptimizedApproach();
    
    // Reset test data
    await cleanup();
    await setupLargeTestData(1000);
    
    // Test alternative approach
    const altMetrics = await testAlternativeLEFTJOINApproach();
    
    // Summary
    console.log(blue("\n📊 Performance Comparison\n"));
    console.log(`Dataset: ${testDataCount} videos\n`);
    
    console.log("Query Time Comparison:");
    console.log(`  Original (NOT EXISTS):   ${originalMetrics.queryDuration}ms`);
    console.log(`  Optimized (Temp Table):  ${optimizedMetrics.queryDuration}ms`);
    console.log(`  Alternative (LEFT JOIN): ${altMetrics.queryDuration}ms\n`);
    
    let bestApproach = "Original";
    let bestTime = originalMetrics.queryDuration;
    
    if (optimizedMetrics.queryDuration < bestTime) {
      bestApproach = "Optimized (Temp Table)";
      bestTime = optimizedMetrics.queryDuration;
    }
    
    if (altMetrics.queryDuration < bestTime) {
      bestApproach = "Alternative (LEFT JOIN)";
      bestTime = altMetrics.queryDuration;
    }
    
    if (bestApproach === "Optimized (Temp Table)") {
      const improvement = ((originalMetrics.queryDuration - optimizedMetrics.queryDuration) / originalMetrics.queryDuration * 100).toFixed(1);
      console.log(green(`✓ WINNER: Optimized approach is ${improvement}% faster\n`));
    } else {
      console.log(`ℹ️  ${bestApproach} performed best\n`);
    }
    
    console.log("Total Time (including prerequisites):");
    console.log(`  Original: ${originalMetrics.totalDuration}ms`);
    console.log(`  Optimized: ${optimizedMetrics.totalDuration}ms`);
    console.log(`  Alternative: ${altMetrics.totalDuration}ms\n`);
    
    // Cleanup
    await cleanup();
    
    console.log(green("✓ Load testing complete\n"));
    process.exit(0);
  } catch (error) {
    console.error(red("\n✗ Test execution failed:\n"), error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
