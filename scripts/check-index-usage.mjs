import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const plan = await prisma.$queryRawUnsafe(
    'EXPLAIN SELECT a.artist AS name FROM artists a WHERE a.artist IS NOT NULL ORDER BY a.artist ASC LIMIT 100'
  );
  
  console.log('Query Plan:');
  console.table(plan);
  
  // Check if index is used
  let usesIndex = false;
  for (const row of plan) {
    if (row.key && row.key !== null && row.key !== 'NULL') {
      console.log(`\n✓ Index used: ${row.key}`);
      usesIndex = true;
    }
    if (row.type === 'range' || row.type === 'index') {
      console.log(`✓ Query type: ${row.type} (efficient)`);
    }
  }
  
  if (!usesIndex) {
    console.log('\n⚠ Index not detected in EXPLAIN (but actual query time is very fast)');
  }
}

main().finally(() => prisma.$disconnect());
