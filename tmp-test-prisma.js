const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('@prisma/client');

// Simulate exactly what verify-deps-full.ps1 does: only the custom vars, no inherited env
const url = process.env.DATABASE_URL;
console.log('DATABASE_URL present:', Boolean(url));
console.log('PATH present:', Boolean(process.env.PATH));
console.log('SystemRoot present:', Boolean(process.env.SystemRoot));
console.log('TEMP present:', Boolean(process.env.TEMP));
console.log('All env keys count:', Object.keys(process.env).length);

if (!url) {
    console.log('No DATABASE_URL, skipping connection test');
    process.exit(0);
}

const adapter = new PrismaMariaDb(url);
const prisma = new PrismaClient({ adapter });

prisma.$queryRawUnsafe('SELECT 1 AS test')
  .then(r => { console.log('CONNECT OK:', r); return prisma.$disconnect(); })
  .catch(e => { console.error('CONNECT FAIL:', e.constructor.name, '-', e.message); return prisma.$disconnect().catch(() => {}); });
