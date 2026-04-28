import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'tgh6';

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM analytics_events WHERE visitor_id LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  const insert = async (eventType, visitorId, geoLat, geoLng, createdAt) => {
    await prisma.$executeRaw`
      INSERT INTO analytics_events (
        event_type,
        visitor_id,
        session_id,
        is_new_visitor,
        user_id,
        video_id,
        geo_lat,
        geo_lng,
        geo_accuracy_m,
        created_at
      )
      VALUES (
        ${eventType},
        ${visitorId},
        ${`${visitorId}-session`},
        ${false},
        ${null},
        ${null},
        ${geoLat},
        ${geoLng},
        ${null},
        ${createdAt}
      )
    `;
  };

  await insert('page_view', `${TEST_PREFIX}-a`, 10.0, 20.0, new Date('2026-04-27T10:00:00Z'));
  await insert('video_view', `${TEST_PREFIX}-a`, 12.0, 22.0, new Date('2026-04-27T11:00:00Z'));
  await insert('page_view', `${TEST_PREFIX}-b`, 30.0, 40.0, new Date('2026-04-26T09:00:00Z'));
  await insert('page_view', `${TEST_PREFIX}-b`, null, 41.0, new Date('2026-04-26T10:00:00Z'));
  await insert('page_view', `${TEST_PREFIX}-c`, null, null, new Date('2026-04-25T10:00:00Z'));

  console.log('Setup complete for analytics geo hotspot tests');
}

async function runLegacyQuery() {
  return prisma.$queryRaw`
    SELECT
      visitor_id AS visitorId,
      AVG(geo_lat) AS lat,
      AVG(geo_lng) AS lng,
      COUNT(*) AS eventCount,
      MAX(created_at) AS lastSeenAt
    FROM analytics_events
    WHERE geo_lat IS NOT NULL
      AND geo_lng IS NOT NULL
      AND visitor_id LIKE ${`${TEST_PREFIX}%`}
    GROUP BY visitor_id
    ORDER BY lastSeenAt DESC
    LIMIT 1000
  `;
}

async function runOptimizedQuery() {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        visitor_id AS visitorId,
        AVG(geo_lat) AS lat,
        AVG(geo_lng) AS lng,
        COUNT(*) AS eventCount,
        MAX(created_at) AS lastSeenAt
      FROM analytics_events
      WHERE has_geo_coords = 1
        AND visitor_id LIKE ?
      GROUP BY visitor_id
      ORDER BY lastSeenAt DESC
      LIMIT 1000
    `,
    `${TEST_PREFIX}%`,
  );
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    visitorId: String(row.visitorId),
    lat: Number(row.lat),
    lng: Number(row.lng),
    eventCount: Number(row.eventCount),
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : String(row.lastSeenAt),
  }));
}

async function testParity() {
  console.log('\nTest 1: Optimized geo query parity');
  const legacyRows = normalizeRows(await runLegacyQuery());
  const optimizedRows = normalizeRows(await runOptimizedQuery());

  if (JSON.stringify(legacyRows) !== JSON.stringify(optimizedRows)) {
    throw new Error(`Parity mismatch: legacy=${JSON.stringify(legacyRows)} optimized=${JSON.stringify(optimizedRows)}`);
  }

  console.log(`  PASS: Optimized query matches legacy output (${legacyRows.length} visitors)`);
}

async function testGeneratedColumnAndIndex() {
  console.log('\nTest 2: Generated column and index exist');
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM analytics_events LIKE 'has_geo_coords'");
  const indexes = await prisma.$queryRawUnsafe("SHOW INDEX FROM analytics_events");
  const hasIndex = indexes.some((row) => row.Key_name === 'idx_analytics_events_geo_grouping');

  if (columns.length === 0) {
    throw new Error('Missing generated has_geo_coords column');
  }
  if (!hasIndex) {
    throw new Error('Missing idx_analytics_events_geo_grouping index');
  }

  console.log('  PASS: Generated column and covering index exist');
}

async function testExplainReferencesIndex() {
  console.log('\nTest 3: EXPLAIN references geo grouping index');
  const plan = await prisma.$queryRawUnsafe(
    `
      EXPLAIN
      SELECT
        visitor_id AS visitorId,
        AVG(geo_lat) AS lat,
        AVG(geo_lng) AS lng,
        COUNT(*) AS eventCount,
        MAX(created_at) AS lastSeenAt
      FROM analytics_events
      WHERE has_geo_coords = 1
      GROUP BY visitor_id
      ORDER BY lastSeenAt DESC
      LIMIT 1000
    `,
  );

  const planText = JSON.stringify(plan, (_, value) => (typeof value === 'bigint' ? value.toString() : value)).toLowerCase();
  if (!planText.includes('idx_analytics_events_geo_grouping')) {
    throw new Error('EXPLAIN did not reference idx_analytics_events_geo_grouping');
  }

  console.log('  PASS: EXPLAIN references new index');
}

async function main() {
  console.log('ANALYTICS GEO VISITOR HOTSPOT TEST SUITE');
  try {
    await setup();
    await testParity();
    await testGeneratedColumnAndIndex();
    await testExplainReferencesIndex();
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
