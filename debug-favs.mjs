import { PrismaClient } from "./node_modules/.prisma/client/index.js";

const p = new PrismaClient();

try {
  const rows = await p.favourite.findMany({ orderBy: { id: "desc" }, take: 10 });
  console.log("favs", rows);

  const vids = [...new Set(rows.map((r) => r.videoId).filter(Boolean))];
  const matches = await p.video.findMany({
    where: { videoId: { in: vids } },
    select: { videoId: true, title: true },
    take: 10,
  });

  console.log("matches", matches.length, matches);
} catch (error) {
  console.error(error);
} finally {
  await p.$disconnect();
}
