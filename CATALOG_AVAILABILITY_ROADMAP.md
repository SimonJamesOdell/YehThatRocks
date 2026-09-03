# Catalog Availability & Bot-Defense Roadmap

> Self-contained handoff for a **fresh context window**. This file captures
> everything learned and agreed so a new session can execute without prior
> memory. All items below are **approved for execution** ("yes to all").

---

## 0. How to trigger this work (in a fresh session)

Paste this into the new context window:

```
Read CATALOG_AVAILABILITY_ROADMAP.md in the repo root (C:\Users\simon\yeh2)
and execute items A1→A7 in order. Honor every boundary, dry-run rule, and
verification step in the file. Do NOT redo the already-shipped bot-analytics
and font work. Commit each logical group separately with the exact commit
messages in section 7. Before any DELETE/UPDATE on the live production DB,
run a dry-run count and report the numbers, then proceed (the user has
pre-approved these specific cleanups). Stop and ask only if you find
something not covered by this roadmap.
```

---

## 1. Project & environment

- **Repo**: `C:\Users\simon\yeh2` — Next.js 16 monorepo (Turbopack), workspaces `apps/*` (main app `apps/web`), Prisma 7.9, **MySQL 8.0** (prod and local dev both mysql:8.0).
- **Prisma adapter**: `@prisma/adapter-mariadb` (works fine against MySQL 8.0).
- **Local DB**: docker container `yeh2-db-1`, port `3307`, db `yeh`, user `root` / `yehthatrocks`. Local DB is a live mirror (last restored ~2026-08-16; may be stale — always prefer LIVE for truth).
- **Live server**: `root@206.189.122.114`, app at `/srv/yehthatrocks`, containers `yehthatrocks-web-1` + `yehthatrocks-db-1`, prod env `.env.production`, compose file `docker-compose.prod.yml`.
- **Schema**: `prisma/schema.prisma`. Migrations: `prisma/migrations/<ts>_<name>/migration.sql` (hand-written Prisma-style).
- **Quality gate**: `scripts/verify-*.js` are CommonJS invariant scripts run via `node scripts/verify-*.js` (no Vitest/Jest needed for them). Unit tests: Vitest (`apps/web/vitest.config.ts`, `npx vitest run <path>` from `apps/web`).

### Live DB query pattern (read-only) — PowerShell here-string → ssh

```powershell
$q = @'
cd /srv/yehthatrocks
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE" -N -e "SELECT ..."'
'@
$q | ssh -o ConnectTimeout=20 root@206.189.122.114 'bash -s'
```

### Local DB query pattern

```powershell
docker exec yeh2-db-1 mysql -uroot -pyehthatrocks yeh -N -e "..."
```

---

## 2. Boundaries (non-negotiable — do not violate)

1. **Deployment is manual, local-only.** Never modify or run anything under `deploy/`, `.github/workflows/`, `docker-compose.prod.yml`, `Dockerfile`, or `docker/entrypoint.sh`. Never run `npm run build`, `npm run ship:*`, `npx next build`, or `prisma migrate deploy` (production-only). The **user runs the deploy cycle** (`deploy/ship-local.ps1`) themselves.
2. **Migrations**: hand-write migration SQL, update `prisma/schema.prisma`, then run `npx prisma validate` + `npx prisma generate`. Verify the migration matches Prisma's DDL with:
   `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (grep your table/index). The `pre-commit` hook is a harmless no-op in Prisma 7 (it references the removed `--to-schema-datamodel` flag).
3. **Live production mutations** (orphan sweep, dedupe, reconciliation prune) are pre-approved by the user, but **always dry-run first and report counts** before applying.
4. **Do not redo** the already-shipped work (section 3).

---

## 3. Already shipped this session (do NOT redo / do not revert)

Two commits are on `origin main`:

- `2158029b` — `feat(analytics): exclude bot traffic from visitor metrics`
  - Added `ip_hash`, `user_agent`, `is_suspected_bot` to `analytics_events` (migration `20260831000000_add_analytics_bot_signals`).
  - Bot classifier `classifySuspectedBotTraffic()` in `scripts/maintain-admin-dashboard-cache.mjs` (one-shot-IP rule: ≤5 events, ≤60 min span, anonymous, low-activity).
  - `is_suspected_bot = 0` filters in rollups/series/audience queries.
  - Ingest persists ip hash + UA (`apps/web/lib/cf-headers.ts` → `extractClientIp`, `hashClientIp`).
- `77db5b54` — `fix(build): self-host Metal Mania font`
  - `apps/web/app/fonts/metal-mania-latin-400-normal.woff2` + `OFL.txt`; `app/layout.tsx` now uses `next/font/local`.

The deploy cycle got as far as building the image successfully (`yehthatrocks-web:77db5b54`); an upload hiccup was cleared. If the user is still deploying, new commits land on top normally.

---

## 4. Verified findings (live DB, 2026-08-31) — motivation

Catalog scale: `videos` = **54,810** rows.

- **`site_videos` duplicate rows**: 80,189 rows but only **54,810 distinct** `video_id`; **8,170 video_ids are duplicated** (some videos have both `available` *and* `check-failed` rows). `SiteVideo` has **no unique constraint** on `video_id` (only indexes). 0 orphans (`video_id`→`videos.id`).
- **`check-failed` backlog**: 19,651 rows = **15,327 distinct videos** (28% of catalog). These are **still playable** — `getVideoPlaybackDecision` treats `check-failed` as fail-open passthrough; only `NULL`/`unavailable` status blocks playback.
- **Dominant trigger**: check-failed titles read `[runtime-report-ignored:thumbnail-load-error…]` → thumbnail load failures are the noisy source.
- **Orphaned associations** (rows referencing videos no longer in `videos`, by string `videoId`):
  - `watch_history` **1,660**, `related` (left) **1,507**, `related` (right) **1,563**, `analytics_events` **286**, `hidden_videos` **19**, `favourites` **6**, `messages` **0**.
  - `genre_cards`, `artist_stats`, `magazine_articles` — counts blocked by a collation mismatch (re-run with explicit collation; see A7).
- **Root cause of orphans**: every delete path calls `pruneVideoAndAssociationsByVideoId` (genre-review `route.ts:422`, admin delete `videos/route.ts:234`, unavailable `route.ts:405/489`), but that function does **not** delete from several association tables.
- **Replacement auto-discovery works**: `YOUTUBE_DATA_API_KEY` set; `external_api_usage_events` (7d) shows `search.list` 2, `search.list.query` 60, `videos.list` 188 — all `success=1`.
- **Verification bottleneck**: `verifyYouTubeAvailability` scrapes oEmbed + embed + watch page and gets **bot-challenged by YouTube** (code has explicit `bot-check` / `interactive-login-check` classifications). Meanwhile the authenticated **`videos.list` API is reliable** (188 calls/week, success). This is the lever for A4.
- **Collation mismatch**: `Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT)` on cross-table JOINs — tables have mixed collations (Prisma default `utf8mb4_unicode_ci` vs MySQL 8 default `utf8mb4_0900_ai_ci`).
- `rejected_videos` = 30,927 tombstones (intentionally point at deleted videos — **do not touch**).

---

## 5. Actions (execute in order)

### A1 — Deduplicate `site_videos` + add UNIQUE constraint on `video_id`

- **Code**: `prisma/schema.prisma` `SiteVideo` model (~line 310); new migration.
- **Steps**:
  1. Dry-run: list `video_id` with `COUNT(*)>1` and their status mix (8,170 expected).
  2. Canonical precedence per `video_id` (non-null): `available` > `check-failed` > `unavailable` > `NULL`. Delete all but one canonical row per `video_id`.
  3. Add `UNIQUE INDEX` on `video_id` (nullable column is fine — MySQL allows multiple NULLs). Prisma: `@@unique([videoId])` (map to `site_videos_video_id_key`) — but confirm `videoId` is `Int?` and intended nullable; if the app ever relies on duplicates being allowed, fix writers instead. Also fix writers that `createMany`/`create` site_videos to upsert (see the unavailable route `createMany({ skipDuplicates: true })` — it silently fails to dedupe today).
  4. New migration: `ALTER TABLE site_videos ADD UNIQUE INDEX ...` after dedupe (dedupe must run on live before the unique index applies, or do it in the migration).
- **Verify**: `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` shows the unique index; `tsc --noEmit`; live `SELECT COUNT(*) = COUNT(DISTINCT video_id)` after.

### A2 — One-off orphan sweep (association tables)

- **Do NOT touch** `rejected_videos` (tombstones by design).
- **Targets + current counts**: watch_history 1,660; related left 1,507; related right 1,563; analytics_events 286; hidden_videos 19; favourites 6; plus genre_cards/artist_stats/magazine_articles after the collation fix (A7).
- **Pattern** (dry-run first):
  ```sql
  SELECT COUNT(*) FROM <t> x LEFT JOIN videos v ON v.videoId = x.<col>
  WHERE x.<col> IS NOT NULL AND v.videoId IS NULL;
  -- then DELETE x FROM <t> x LEFT JOIN videos v ON v.videoId = x.<col>
  -- WHERE x.<col> IS NOT NULL AND v.videoId IS NULL;
  ```
- Reference columns: `favourites.videoId`, `watch_history.video_id`, `related.videoId` / `related.related`, `hidden_videos.video_id`, `messages.video_id`, `analytics_events.video_id`, `genre_cards.thumbnail_video_id`, `artist_stats.thumbnail_video_id`, `magazine_articles.video_id`.
- **Verify**: re-run each orphan count → 0.

### A3 — Fix `pruneVideoAndAssociationsByVideoId` to delete from all association tables

- **File**: `apps/web/lib/catalog-data-video-ingestion.ts` (function near the video-replacement section; read it fully). Compare its DELETE set against `replaceVideoIdInDatabase` (~line 3010), which already touches: `related`, `genre_cards`, `artist_stats`, `favourites`, `watch_history`, `hidden_videos`, `messages`, `analytics_events`, `magazine_articles`. The prune function must delete from the same set (plus any playlist-item/forum refs that exist).
- Add a unit test (Vitest, mirror `catalog-data-video-ingestion-quality.test.ts` style) asserting the prune function deletes from every association table, so a future edit can't silently drop one.
- **Verify**: `npx vitest run lib/catalog-data-video-ingestion-quality.test.ts` (and new test); `tsc --noEmit`.

### A4 — Rework availability verification to `videos.list` + reconcile `check-failed`

- **Files**: `apps/web/lib/catalog-data-video-ingestion.ts` (`verifyYouTubeAvailability` ~line 895–970; `getVideoPlaybackDecision` ~2760–2880); `apps/web/app/api/videos/unavailable/route.ts`.
- **Approach**:
  1. Add a primary check using YouTube Data API `videos.list?part=status,contentDetails&id=<id>` → `items[].status.uploadStatus` (`processed`/`deleted`/`failed`) and `status.embeddable`. This is authenticated and bot-check-resistant (already proven by 188 successful calls/week).
  2. Keep oEmbed as a secondary/fallback for embeddability nuances, but stop treating scrape bot-checks as the deciding factor.
  3. Write a one-off reconciliation script (e.g. `scripts/reconcile-check-failed-videos.mjs`) that iterates the 15,327 distinct `check-failed` videos, verifies via `videos.list`, and either (a) flips back to `available` (delete the check-failed row / set available) or (b) prunes genuinely-dead ones via `pruneVideoAndAssociationsByVideoId`. Rate-limit/backoff; dry-run (report flip vs prune counts) before applying.
- **Verify**: dry-run counts sane; spot-check a sample of "available" flips actually load; `tsc`.

### A5 — Demote the `thumbnail-load-error` signal

- **File**: `apps/web/components/youtube-thumbnail-image.tsx` (`reportUnavailable(..., "thumbnail-load-error")` ~lines 42, 146, 169).
- **Approach**: thumbnail load failure is transient. Either retry once before reporting, or report a lighter-weight reason that does not trigger the full unavailable-verification path (or ignore single transient failures entirely). Goal: stop flooding `check-failed`.
- **Verify**: `tsc --noEmit`; `node scripts/verify-thumbnail-preflight-invariants.js` still passes.

### A6 — Add `scripts/verify-availability-invariants.js`

- Follow the existing `verify-*.js` pattern (read `scripts/verify-admin-invariants.js` for the shape). Assert:
  1. `pruneVideoAndAssociationsByVideoId` deletes from every association table (same set as `replaceVideoIdInDatabase`).
  2. `SiteVideo` has a unique constraint on `video_id`.
  3. Status enum values (`available`/`unavailable`/`check-failed`) are used consistently.
  4. `verifyYouTubeAvailability` uses the Data API (`videos.list`) as primary.
- Register it in root `package.json` (`verify:availability` → `node scripts/verify-availability-invariants.js`) and add to `verify:ui-regressions`/`verify:invariants` chains.
- **Verify**: `node scripts/verify-availability-invariants.js` passes.

### A7 — Normalize table collations

- One migration that ALTERs all `utf8mb4_0900_ai_ci` tables/columns to `utf8mb4_unicode_ci` (Prisma default, matches the majority + `analytics_events`).
- First list offending tables via information_schema:
  ```sql
  SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION <> 'utf8mb4_unicode_ci';
  ```
- **Verify**: the orphan JOIN queries for genre_cards/artist_stats/magazine_articles run without collation errors; `npx prisma migrate diff` clean.

---

## 6. Global verification checklist (run before declaring each item done)

- `npx prisma validate` && `npx prisma generate` (repo root)
- `npx tsc --noEmit` (from `apps/web`)
- `npx vitest run <relevant-tests>` (from `apps/web`)
- `node scripts/verify-availability-invariants.js` (after A6) and the existing verify scripts touched by changes
- `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (confirm migrations match schema)
- **Dry-run before any live DELETE/UPDATE**; report counts, then apply.

---

## 7. Commit strategy (separate commits, push `origin main`)

1. **A1 + A2 + A7** → `fix(catalog): dedupe site_videos, sweep orphaned associations, normalize collations`
2. **A3** → `fix(catalog): prune all association tables when removing a video`
3. **A4 + A5** → `feat(catalog): verify availability via YouTube Data API and reconcile check-failed videos`
4. **A6** → `chore(verify): add availability-system invariants`

Stage only the files each commit touches; commit; `git push origin main`. Do not run build/ship scripts.

---

## 8. Notes / gotchas

- `site_videos.video_id` is the **integer** `videos.id`; association tables use the **string** `videos.videoId`. Don't mix them up in orphan queries.
- `videos.videoId` is the 11-char YouTube id (VarChar); `videos.id` is the int PK.
- The unavailable route's `createMany({ skipDuplicates: true })` only dedupes against a unique index — which is why A1's unique index matters.
- `getVideoPlaybackDecision` fail-open for `check-failed` is a deliberate design choice; A4's reconciliation is what converts the backlog into either `available` or pruned, rather than changing fail-open semantics blindly.
