import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const top = await p.$queryRawUnsafe('SELECT videoId, title, favourited FROM videos ORDER BY favourited DESC LIMIT 10');
console.log('Top 10 by videos.favourited:');
top.forEach(r => console.log(`  ${String(Number(r.favourited)).padStart(6)} | ${r.videoId} | ${r.title?.substring(0,50)}`));

const actual = await p.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM favourites');
console.log('\nTotal rows in favourites table:', Number(actual[0].cnt));

const perUser = await p.$queryRawUnsafe('SELECT userId, COUNT(*) as cnt FROM favourites GROUP BY userId ORDER BY cnt DESC LIMIT 5');
console.log('Top 5 users by favourites count:', perUser.map(r => `user ${r.userId}: ${Number(r.cnt)}`).join(', '));

const dist = await p.$queryRawUnsafe('SELECT MAX(favourited) as mx, SUM(CASE WHEN favourited > 100 THEN 1 ELSE 0 END) as over100, SUM(CASE WHEN favourited > 0 THEN 1 ELSE 0 END) as withAny FROM videos');
console.log(`\nvideos.favourited — max: ${Number(dist[0].mx)}, over 100: ${Number(dist[0].over100)}, any > 0: ${Number(dist[0].withAny)}`);

await p.$disconnect();
