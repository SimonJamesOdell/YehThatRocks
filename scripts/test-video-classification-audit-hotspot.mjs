import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_PREFIX = 'tvh5';

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM videos WHERE videoId LIKE '${TEST_PREFIX}%'`);
}

async function setup() {
  await cleanup();

  await prisma.video.createMany({
    data: [
      {
        videoId: `${TEST_PREFIX}a01`,
        title: 'H5 LLM day 1',
        parseMethod: 'groq-llm',
        parsedAt: new Date('2026-04-27T10:00:00Z'),
      },
      {
        videoId: `${TEST_PREFIX}a02`,
        title: 'H5 Error day 1',
        parseMethod: 'groq-error',
        parsedAt: new Date('2026-04-27T11:00:00Z'),
      },
      {
        videoId: `${TEST_PREFIX}b01`,
        title: 'H5 LLM day 2',
        parseMethod: 'groq-llm',
        parsedAt: new Date('2026-04-26T09:00:00Z'),
      },
      {
        videoId: `${TEST_PREFIX}c01`,
        title: 'H5 non-groq method',
        parseMethod: 'legacy-parser',
        parsedAt: new Date('2026-04-27T12:00:00Z'),
      },
    ],
  });

  console.log('Setup complete for classification-audit hotspot tests');
}

async function runAuditQueryForTestRows() {
  return prisma.$queryRaw`
    SELECT
      DATE(parsedAt) AS day,
      SUM(CASE WHEN parseMethod LIKE 'groq-llm%' THEN 1 ELSE 0 END) AS classified,
      SUM(CASE WHEN parseMethod = 'groq-error' THEN 1 ELSE 0 END) AS errors
    FROM videos
    WHERE parseMethod LIKE 'groq%'
      AND parsedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      AND videoId LIKE ${`${TEST_PREFIX}%`}
    GROUP BY DATE(parsedAt)
    ORDER BY day DESC
    LIMIT 14
  `;
}

async function testAggregationSemantics() {
  console.log('\nTest 1: Classification audit aggregation semantics');
  const rows = await runAuditQueryForTestRows();

  const normalizeDayKey = (dayValue) => {
    if (dayValue instanceof Date) {
      return dayValue.toISOString().slice(0, 10);
    }
    const asString = String(dayValue ?? '').trim();
    if (!asString) {
      return '';
    }
    const parsed = new Date(asString);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return asString.slice(0, 10);
  };

  const map = new Map(rows.map((row) => [normalizeDayKey(row.day), {
    classified: Number(row.classified ?? 0),
    errors: Number(row.errors ?? 0),
  }]));

  const day1 = map.get('2026-04-27');
  const day2 = map.get('2026-04-26');

  if (!day1 || day1.classified !== 1 || day1.errors !== 1) {
    throw new Error(`Unexpected day1 aggregation: ${JSON.stringify(day1)}`);
  }

  if (!day2 || day2.classified !== 1 || day2.errors !== 0) {
    throw new Error(`Unexpected day2 aggregation: ${JSON.stringify(day2)}`);
  }

  console.log('  PASS: Aggregation semantics are correct');
}

async function testIndexExists() {
  console.log('\nTest 2: Composite index exists for hotspot filter');

  const indexes = await prisma.$queryRawUnsafe("SHOW INDEX FROM videos");
  const hotIndexRows = indexes.filter((row) => row.Key_name === 'idx_videos_parsemethod_parsedat');

  if (hotIndexRows.length === 0) {
    throw new Error('Missing idx_videos_parsemethod_parsedat index');
  }

  const colsInOrder = hotIndexRows
    .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
    .map((row) => row.Column_name);

  if (colsInOrder[0] !== 'parseMethod' || colsInOrder[1] !== 'parsedAt') {
    throw new Error(`Unexpected index columns/order: ${colsInOrder.join(',')}`);
  }

  console.log('  PASS: Composite index exists with correct column order');
}

async function testExplainReferencesIndex() {
  console.log('\nTest 3: EXPLAIN exposes new index as candidate');

  const plan = await prisma.$queryRawUnsafe(
    `
      EXPLAIN
      SELECT
        DATE(parsedAt) AS day,
        SUM(CASE WHEN parseMethod LIKE 'groq-llm%' THEN 1 ELSE 0 END) AS classified,
        SUM(CASE WHEN parseMethod = 'groq-error' THEN 1 ELSE 0 END) AS errors
      FROM videos
      WHERE parseMethod LIKE 'groq%'
        AND parsedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
      GROUP BY DATE(parsedAt)
      ORDER BY day DESC
      LIMIT 14
    `,
  );

  const planText = JSON.stringify(
    plan,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
  ).toLowerCase();
  if (!planText.includes('idx_videos_parsemethod_parsedat')) {
    throw new Error('EXPLAIN did not reference idx_videos_parsemethod_parsedat as a usable key');
  }

  console.log('  PASS: EXPLAIN references hotspot index');
}

async function main() {
  console.log('VIDEO CLASSIFICATION AUDIT HOTSPOT TEST SUITE');

  try {
    await setup();
    await testAggregationSemantics();
    await testIndexExists();
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
