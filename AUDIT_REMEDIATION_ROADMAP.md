# YehThatRocks — Audit Remediation Roadmap

Audit date: 2026-08-23. This document records what was fixed, what remains,
how each change is protected against regression, and the exact steps that only
the owner can perform (deployment boundary).

---

## 1. What was fixed in this pass (all verified)

| # | Finding | Fix | Regression guard |
|---|---|---|---|
| 1 | Mobile users were never routed to `/m` (regression from commit `cb56dd99`, which deleted the redirect, its tests, and its invariant together) | Restored mobile/tablet UA detection, `/m` path mapping, static-asset + crawler exclusions, desktop-only escape hatch, and security headers in `apps/web/proxy.ts` | `scripts/verify-proxy-mobile-routing-invariants.js` + `apps/web/proxy.test.ts` (25 tests). The invariant **requires the test file to exist** so neither can be silently deleted again. Wired into `verify:light` and `verify:ui-regressions`. |
| 2 | Raw database errors leaked to visitors in 6 API routes | Added `apps/web/lib/api-error.ts` (`safeErrorMessage` gated on `NODE_ENV`) and applied it to `videos/newest`, `videos/newest/facets`, `categories`, `facebook-browser/candidates`, `admin/magazine/generate`, `cron/magazine-daily` | `scripts/verify-error-sanitization-invariants.js` (asserts the sanitizer exists and the routes no longer inline `error.message`). Wired into both verify chains. |
| 3 | Forum votes/posts/threads had no CSRF check, no rate limiting, no max length | Added `verifySameOrigin` + per-IP and per-user rate limits + max-length caps (title 200, content 10000) to `forum/threads`, `forum/threads/[threadId]/vote`, `forum/threads/[threadId]/posts` | `scripts/verify-forum-abuse-invariants.js`. Wired into both verify chains. |
| 4 | Favourites could race into duplicate rows; no rate limit | Schema `@@unique([userid, videoId])`, migration `20260823000000_add_favourites_unique_constraint` (dedupe then unique index), atomic `createMany(skipDuplicates)` upsert in `updateFavourite`, rate limit on `favourites` POST | `scripts/verify-favourites-integrity-invariants.js` (checks schema, migration, upsert, rate limit). Wired into both verify chains. |
| 5 | Chat fetch had no index (full table scan) | Composite index `(room, video_id, created_at, id)` via migration `20260823010000_add_messages_chat_index` + schema | Schema/migration covered by the migration itself; the invariant-suite convention means any schema drift breaks `prisma migrate` checks. |
| 6 | No inbound UTM/attribution capture | `apps/web/lib/utm.ts` (pure parser/serializer), `apps/web/components/utm-capture.tsx` (persists first-touch UTM to localStorage), rendered in the root layout | `apps/web/lib/utm.test.ts` (10 tests) + `scripts/verify-utm-capture-invariants.js`. Wired into both verify chains. |
| 7 | No security headers anywhere | Restored in `proxy.ts`: `X-Frame-Options: DENY` (exempting `/embed`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production | Covered by `verify-proxy-mobile-routing-invariants.js` and `proxy.test.ts`. |

New verification commands: `npm run verify:proxy`, `verify:error-sanitization`,
`verify:forum-abuse`, `verify:favourites-integrity`, `verify:utm` — all appended
to `npm run verify:light` and the full `npm run verify:ui-regressions` chain.

---

## 2. Actions ONLY you can do (deployment boundary)

These touch files under `deploy/`, Docker config, or production operations that
are out of scope for the agent. Copy-paste ready.

### 2a. Migrations — auto-applied on deploy (no manual step)

`docker/entrypoint.sh` runs `npx prisma migrate deploy` on every container
start, before the app boots. So the two new migrations apply automatically on
your next deploy — nothing to run by hand. (The migration files ship inside the
image because the Dockerfile copies the whole `prisma/` directory.)

The favourites migration `20260823000000_add_favourites_unique_constraint`
first deletes duplicate `favourites` rows (keeps the lowest id per user/video
pair), then adds `uq_favourite_user_video`. The chat migration
`20260823010000_add_messages_chat_index` just adds an index. Both are safe on
live data.

**One thing to watch on the first deploy after this change:** the entrypoint
runs with `set -e`, so if a migration fails, the container exits and the site
does not come up. The dedupe-then-unique-index ordering is what makes this safe
(duplicates are removed before the constraint is added), but confirm the first
deploy's logs show both migrations applying cleanly.

**Verify after deploy:**

```sql
SHOW INDEX FROM favourites WHERE Key_name = 'uq_favourite_user_video';
SHOW INDEX FROM messages WHERE Key_name = 'idx_messages_room_videoid_created';
```

### 2b. Nginx security headers — ✅ APPLIED on the server (2026-08-23)

Done via SSH (`root@206.189.122.114`, `ubuntu-s-1vcpu-1gb-lon1-01`) with your
permission:

1. Created `/etc/nginx/yehthatrocks-security-headers.inc` and added one
   `include` line to the 443 server block of `/etc/nginx/sites-enabled/yehthatrocks`.
2. `nginx -t` passed, `systemctl reload nginx` succeeded.
3. Verified end-to-end (origin + through Cloudflare) — HTTP 200 with:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy-Report-Only: <permissive policy covering self, YouTube, thumbnails, avatars>
```

Notes:
- **CSP is REPORT-ONLY on purpose** (it cannot break anything). It logs
  violations to the browser console without blocking. After a few days of
  normal use, open the browser console on the site; if you see no CSP
  violation warnings for the player/chat/thumbnails, flip it to enforce by
  renaming `Content-Security-Policy-Report-Only` → `Content-Security-Policy`
  in `/etc/nginx/yehthatrocks-security-headers.inc` and reloading nginx.
- **X-Frame-Options was deliberately NOT set at nginx** — the app sets it
  per-route (DENY everywhere except `/embed`, which must stay frameable).
- A rollback copy of the site config lives at `/root/yehthatrocks.bak.20260823`.
- **Gotcha discovered on the server:** `include /etc/nginx/sites-enabled/*;`
  loads EVERY file in that directory — a backup file left inside
  `sites-enabled/` is parsed as a second vhost and breaks `nginx -t`.
  Keep backups outside `sites-enabled/` (e.g. `/root/`).

### 2c. Backups — confirm the schedule is real

`deploy/ytr-backup.sh` exists, but scheduled execution could not be verified
from this side. Confirm the cron/systemd timer actually runs it and that a
restore has been tested at least once against the live restore script
(`run_live_restore_diag.ps1`). A backup you have never restored is a hope,
not a backup.

### 2d. onDelete policy for user deletion (do this when you add account deletion)

Today `ForumPost.user` is a required FK with no `onDelete`, and several other
relations have no delete policy. Nothing breaks today because account deletion
does not exist yet. When you add it, decide per table:

- `messages.user_id` → `onDelete: SetNull` (keep chat history, show as former-user)
- `forum_posts.user_id`, `forum_threads.user_id`, `forum_votes.user_id` → `onDelete: Cascade` (or SetNull + tombstone if you want history)
- `playlistnames.user_id`, `favourites.userid`, `watch_history.user_id`, `hidden_videos.user_id` → `onDelete: Cascade`

Update `prisma/schema.prisma` with the chosen `onDelete` behavior, then generate
a migration with `npx prisma migrate dev` locally and deploy it in your normal flow.

---

## 3. Remaining follow-ups (ordered by value)

### High
1. **Wrap remaining DB-touching route handlers with `handleRouteError`.**
   The helper now exists (`apps/web/lib/api-error.ts`) and six routes use it.
   Remaining candidates: `watch-history`, `playlists/[id]/items`, `chat` POST,
   `forum` (lib functions already catch internally — route-level wrapping is
   defense-in-depth). Pattern:
   ```ts
   try { /* handler body */ }
   catch (error) { return handleRouteError(error, "context-label"); }
   ```
2. **Forum moderation tooling.** Add a "report" action for threads/posts and
   admin delete/hide endpoints (chat already has `admin.forum.moderate` delete —
   mirror that pattern). Include max-length client-side counters so users see
   the new caps before submitting.
3. **Wire UTM attribution to signups.** The capture layer is live
   (`localStorage` key `ytr:utm-attribution`). To attribute signups: have the
   register/anonymous client send the stored UTM JSON, store it on the user row
   (schema column) or in `auth_audit_logs.detail`, and add a "signups by
   utm_source" query to the analytics dashboard.

### Medium
4. **Mobile polish.** `apps/web/app/layout.tsx` still lacks the `viewport`
   export (`viewportFit: "cover"`, `themeColor`) — safe-area padding in
   `mobile.css` is dead code until then. Touch targets below 44px in several
   places (`mobile.css`); add the missing `/m` playlist pages (desktop has
   them, mobile does not).
5. **ScreenName/bio/avatarUrl validation** on signup/profile update
   (profanity + safe image URL allowlist).
6. **Structured logging/error reporting** (Sentry or similar) — currently
   server errors only hit `console.error`. The `handleRouteError` choke point
   is where you would hook it.

### Low
7. Replace raw `<img>` YouTube thumbs with `next/image` (config already
   whitelists `i.ytimg.com`).
8. `global-error.tsx` + `unhandledrejection`/`uncaughtException` handlers in
   the standalone server entry.

---

## 4. Regression protection — how the /m bug is now impossible to reintroduce

The original regression was three coordinated deletions in one commit: the
proxy code, `proxy.test.ts`, and the proxy invariant. The new invariant script
deliberately asserts **the test file exists and still asserts the redirect and
security-header behaviors**, so deleting any one piece fails
`npm run verify:light` and `npm run verify:ui-regressions` — both of which run
in `prepare:ship:light` / `prepare:ship:full` before any ship.

Rule going forward: **behavioral changes ship with a vitest test and an
invariant assertion; neither may be removed without replacing the coverage.**

---

## 5. Verification run in this pass

- `npx vitest run proxy.test.ts` — 25/25 passed
- `npx vitest run lib/utm.test.ts` — 10/10 passed
- New invariants (`verify:proxy`, `verify:error-sanitization`, `verify:forum-abuse`, `verify:favourites-integrity`, `verify:utm`) — all passed
- `npm run verify:light` — passed (all 12 gates: forum, core-experience, player-core, overlay-routing, queue-behavior, wiki, mobile + the 5 new ones)
- `npx tsc --noEmit` in `apps/web` — exit 0 (no type errors)

`npm run build` and `npm run ship:*` were intentionally NOT run (deployment
boundary) — you invoke those locally.
