# YehThatRocks — Release Roadmap

> Working plan for shipping the remaining audit follow-ups in small,
> independently deployable batches. Iterate freely — each release below is
> scoped to deploy on its own, so we can ship as we go until the list is empty.

Last updated: 2026-10-13

---

## Status snapshot

**Deployable now (on `origin/main`):**

| Commit | Change |
|---|---|
| `d78c865` | `fix(api)`: sanitize errors on remaining DB routes via `handleRouteError` (watch-history, chat, playlist items, forum mutation routes; + 503 mapping for transient DB errors) |
| `3884b05` | `fix(mobile)`: root `viewport` export (safe-area insets + theme color) |

**Source documents:**

- `AUDIT_REMEDIATION_ROADMAP.md` — section 3 "Remaining follow-ups" is the origin of the open items below.
- `CATALOG_AVAILABILITY_ROADMAP.md` — complete (A1–A7 shipped); no open work.

---

## Release plan

### Release 1 — already committed (no new work)

Run the deploy cycle only. Low risk → `npm run prepare:ship:light`.
Covers the two commits above.

### Release 2 — Error resilience & observability (code-only, low risk)

- **#8 — `global-error.tsx` + unhandled-rejection/uncaught-exception handlers** in the standalone server entry. Self-contained; pairs with the error-sanitization work already shipped in `d78c865`.
- **#6 — structured logging / error reporting (Sentry or similar)** — *decision needed first*: vendor + budget. Hook into the `handleRouteError` choke point in `apps/web/lib/api-error.ts` (it already `console.error`s with a context label).

Grouping rationale: both extend the error-handling path. #8 is the cheap win; #6 is the heavier optional that can drop out or move to a later release.

### Release 3 — Forum moderation (feature)

- **#2** — add a "report" action for threads/posts and admin delete/hide endpoints. Mirror the existing `admin.forum.moderate` permission pattern already used by chat DELETE. Add client-side max-length counters so users see the 200/10000 caps before submitting.
- Note: CSRF checks, rate limits, and length caps already exist from the audit pass — this is additive moderation UX plus admin endpoints.

### Release 4 — UTM attribution (schema change)

- **#3** — wire UTM attribution to signups. The capture layer is already live (`localStorage` key `ytr:utm-attribution`, `apps/web/components/utm-capture.tsx`). Remaining: register/anonymous client sends the stored UTM JSON → persist on the user row (new schema column) or `auth_audit_logs.detail` → add a "signups by utm_source" query to the analytics dashboard.
- **Needs a migration** — follow the migration-safety rules below.

### Release 5 — Mobile completeness, profile validation, cosmetic

- **#4 remainder** — touch targets below 44px in `apps/web/app/styles/mobile.css`; add the missing `/m` playlist pages (desktop has them).
- **#5** — ScreenName/bio/avatarUrl validation on signup/profile update (profanity filter + safe image-URL allowlist).
- **#7** — replace raw `<img>` YouTube thumbnails with `next/image` (config already whitelists `i.ytimg.com`).

### Deferred (not scheduled)

- **#2d** — `onDelete` policy for user deletion (`messages.user_id`, forum rows, playlists/favourites/watch-history/hidden-videos). Blocked until account deletion is added.

---

## Reference — open items (from AUDIT_REMEDIATION_ROADMAP.md §3)

| # | Priority | Item | Status |
|---|---|---|---|
| 1 | High | Wrap remaining DB routes with `handleRouteError` | Done (`d78c865`) |
| 2 | High | Forum moderation tooling | Open → Release 3 |
| 3 | High | UTM → signup attribution | Open → Release 4 |
| 4 | Medium | Mobile polish (viewport / touch targets / `/m` playlists) | viewport done (`3884b05`); remainder → Release 5 |
| 5 | Medium | ScreenName/bio/avatarUrl validation | Open → Release 5 |
| 6 | Medium | Structured logging (Sentry) | Open → Release 2 (optional) |
| 7 | Low | `next/image` YouTube thumbs | Open → Release 5 |
| 8 | Low | `global-error.tsx` + uncaught handlers | Open → Release 2 |

---

## Deployment & verification notes (rules for every release)

- **Deployment is manual and local-only.** The agent never runs `npm run build`, `npm run ship:*`, or anything under `deploy/`. You run `deploy/ship.sh` (Linux) / `deploy/ship-local.ps1` (Windows).
- **Ship gate:** low-risk → `npm run prepare:ship:light`; feature/schema releases → `npm run prepare:ship:full`.
- **Invariants are the quality gate:** `npm run verify:invariants` (wraps the build) plus `verify:light`. Every behavioral change ships with an invariant assertion (or a Vitest test) so it can't silently regress.
- **Migrations (Release 4):** hand-write the SQL, update `prisma/schema.prisma`, run `npx prisma validate` + `npx prisma generate`, then confirm with `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. Never run `prisma migrate deploy` (production-only).
