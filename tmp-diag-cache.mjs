import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "mysql://yeh:yehthatrocks@localhost:3307/yeh";
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

  const rows = await prisma.$queryRawUnsafe("SELECT LEFT(payload, 200) AS preview, CHAR_LENGTH(payload) AS len, computed_at FROM admin_dashboard_cache WHERE id = 1");
  const row = rows[0];
  console.log("Cache size:", row?.len, "bytes, computed:", row?.computed_at);
  console.log("Preview:", row?.preview?.substring(0, 200));

  const full = await prisma.$queryRawUnsafe("SELECT payload FROM admin_dashboard_cache WHERE id = 1");
  if (full[0]) {
    const payload = JSON.parse(full[0].payload);
    
    // Find today's bucket
    const todayBucket = (payload.analytics?.series?.daily || []).find(
      (b) => (b.bucketStart || "").startsWith("2026-07-22")
    );
    console.log("\n=== Today bucket (2026-07-22) from cache series.daily ===");
    console.log(todayBucket ? JSON.stringify(todayBucket) : "NOT FOUND");

    // Yesterday
    const yesterdayBucket = (payload.analytics?.series?.daily || []).find(
      (b) => (b.bucketStart || "").startsWith("2026-07-21")
    );
    console.log("\n=== Yesterday bucket (2026-07-21) from cache series.daily ===");
    console.log(yesterdayBucket ? JSON.stringify(yesterdayBucket) : "NOT FOUND");

    // Lengths
    console.log("\nseries.daily length:", payload.analytics?.series?.daily?.length);
    console.log("analytics.daily length:", payload.analytics?.daily?.length);

    // newVsRepeat
    console.log("newVsRepeat:", JSON.stringify(payload.analytics?.newVsRepeat));

    // audience data
    if (payload.audience) {
      console.log("\naudience.frequencyDistribution:", JSON.stringify(payload.audience.frequencyDistribution));
      console.log("audience.retentionCohorts:", JSON.stringify(payload.audience.retentionCohorts));
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
