import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "mysql://yeh:yehthatrocks@localhost:3307/yeh";
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

  // Helper: convert bigints to numbers for display
  function clean(obj) {
    return JSON.parse(JSON.stringify(obj, (k, v) => typeof v === "bigint" ? Number(v) : v));
  }

  // 1. Today's daily rollup row
  const today = await prisma.$queryRawUnsafe("SELECT * FROM admin_dashboard_analytics_daily WHERE day_date = CURDATE()");
  console.log("=== Today daily rollup ===");
  console.log(clean(today));

  // 2. Raw analytics_events for today
  const rawToday = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) AS video_views,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN visitor_id END) AS return_visits,
      SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 1 THEN 1 ELSE 0 END) AS new_visitor_events,
      SUM(CASE WHEN event_type = 'page_view' AND is_new_visitor = 0 THEN 1 ELSE 0 END) AS return_visitor_events
    FROM analytics_events
    WHERE DATE(created_at) = CURDATE()
  `);
  console.log("\n=== Raw analytics_events for today ===");
  console.log(clean(rawToday));

  // 3. Frequency distribution raw
  const freqRaw = await prisma.$queryRawUnsafe(`
    SELECT days_visited, COUNT(*) AS people
    FROM (
      SELECT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val,
             COUNT(DISTINCT DATE(created_at)) AS days_visited
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND is_new_visitor = 0
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY identity_val
    ) t
    GROUP BY days_visited
    ORDER BY days_visited ASC
  `);
  console.log("\n=== Frequency distribution raw (last 30 days, is_new_visitor=0 only) ===");
  console.log(clean(freqRaw));

  // 4. Total distinct returning visitors (30 days)
  const totalReturning = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND is_new_visitor = 0
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY identity_val
    ) t
  `);
  console.log("\n=== Total distinct returning visitors (30 days, is_new_visitor=0) ===");
  console.log(clean(totalReturning));

  // 5. Monthly unique visitors
  const monthlyUnique = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS unique_visitors
    FROM analytics_events
    WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
  `);
  console.log("\n=== Monthly unique visitors (current month, all page_view events) ===");
  console.log(clean(monthlyUnique));

  // 6. Top daily users - include their first-visit day
  const dailyUsers = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val,
           COUNT(DISTINCT DATE(created_at)) AS total_days_visited,
           SUM(CASE WHEN is_new_visitor = 0 THEN 1 ELSE 0 END) AS return_events,
           SUM(CASE WHEN is_new_visitor = 1 THEN 1 ELSE 0 END) AS new_events,
           MIN(DATE(created_at)) AS first_visit
    FROM analytics_events
    WHERE event_type = 'page_view'
      AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
    GROUP BY identity_val
    HAVING total_days_visited >= 10
    ORDER BY total_days_visited DESC
    LIMIT 5
  `);
  console.log("\n=== Top daily users (10+ total days, last 30 days) ===");
  console.log(clean(dailyUsers));

  // 7. Check: how many visitors had is_new_visitor = 1 within the last 30 days?
  // These are visitors whose FIRST EVER VISIT was within the last 30 days
  const newInWindow = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT COALESCE(CAST(user_id AS CHAR), visitor_id)) AS new_visitors_in_window
    FROM analytics_events
    WHERE event_type = 'page_view'
      AND is_new_visitor = 1
      AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
  `);
  console.log("\n=== New visitors (is_new_visitor=1) in last 30 days ===");
  console.log(clean(newInWindow));

  // 8. Corrected frequency distribution: count ALL distinct days (not just return events)
  const freqCorrected = await prisma.$queryRawUnsafe(`
    SELECT days_visited, COUNT(*) AS people
    FROM (
      SELECT COALESCE(CAST(user_id AS CHAR), visitor_id) AS identity_val,
             COUNT(DISTINCT DATE(created_at)) AS days_visited
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY identity_val
      HAVING days_visited > 1
    ) t
    GROUP BY days_visited
    ORDER BY days_visited ASC
  `);
  console.log("\n=== CORRECTED frequency (all page_view events, HAVING days_visited > 1) ===");
  console.log(clean(freqCorrected));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
