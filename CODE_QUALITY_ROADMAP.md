# Code Quality Improvement Roadmap — yehthatrocks.com

**Created**: 2026-07-30
**Status**: Active — Phase 0 (immediate correctness fixes) ready; structural work depends on risk tolerance
**Sources**: CODE_SMELLS.md (April 6, 2026 audit), sub-agent Prisma schema + CSS audit, sub-agent dead-file scan, schema.prisma (489 lines, 32 models, 0 enums)

## Detected Issues

| # | Issue | Severity | Source |
|---|-------|----------|--------|
| 1 | `loading.tsx`/`page.tsx` duplication (4 route pairs) | HIGH | CODE_SMELLS §1 |
| 2 | `favouritesBlindBar` — no shared component (18+ occurrences) | HIGH | CODE_SMELLS §2 |
| 3 | Missing `AbortController` on client fetches | HIGH | CODE_SMELLS §6a |
| 4 | No `error.tsx` boundaries — unhandled errors crash full overlay | HIGH | CODE_SMELLS §6b |
| 5 | Artist `genre1`–`genre6` columns instead of normalized relation | MEDIUM | Sub-agent schema audit |
| 6 | `Favourite` model uses raw nullable IDs without proper relations | MEDIUM | Sub-agent schema audit |
| 7 | `RelatedCache` bidirectional redundant indexes | MEDIUM | Sub-agent schema audit |
| 8 | `SiteVideo` redundant bidirectional indexes | MEDIUM | Sub-agent schema audit |
| 9 | `sortPlaylistsByRecency` sorts by numeric ID, not timestamp | MEDIUM | CODE_SMELLS §3 |
| 10 | Window event bus (`ARTISTS_LETTER_CHANGE_EVENT`) bypasses React | MEDIUM | CODE_SMELLS §4 |
| 11 | Script boilerplate duplication (~400 lines across ~12 scripts) | MEDIUM | CODE_SMELLS §5 |
| 12 | Race condition: rapid letter switching drops clicks silently | MEDIUM | CODE_SMELLS §6c |
| 13 | Transient DB error detection via string matching | MEDIUM | CODE_SMELLS §6d |
| 14 | N+1 fetch in Add-to-Playlist (sequential per-playlist detail fetch) | MEDIUM | CODE_SMELLS §6e |
| 15 | `player-chrome.css` (3,752 lines) and `browse.css` (2,853 lines) | MEDIUM | Sub-agent CSS audit |
| 16 | 51 migration directories — squashing candidate | LOW-MEDIUM | Sub-agent schema audit |
| 17 | `reference/main.css` (261 lines) — dead code, zero imports | LOW | Sub-agent CSS audit |
| 18 | `PlaylistName.userId` is optional — should always belong to a user | LOW | Sub-agent schema audit |
| 19 | API route boilerplate (29 route handlers repeating auth+CSRF+Zod) | LOW-MEDIUM | CODE_SMELLS §6f |
| 20 | Unsafe `as unknown as` cast in `player-experience-core.tsx` | LOW | CODE_SMELLS §6g |
| 21 | Dead root-level scripts (diag.js, diagnose-discovery.sh, verify-discovery.sh, pending-check.sh, extract-favs.py) | LOW | Sub-agent dead-file scan |
| 22 | `backups/` directory — no code references, may contain irreplaceable data | LOW | Sub-agent dead-file scan |
| 23 | Multiple HOTSPOT_*/DEPLOYMENT_* MD files cluttering root | LOW | Sub-agent dead-file scan |

## Phases

### Phase 0 — Immediate Correctness (prevents real production bugs)

These are surgical, low-risk, and should be done first. Each stands alone.

| # | Action | Effort | Risk | Depends on |
|---|--------|--------|------|------------|
| 0a | Add `error.tsx` at `(shell)/` level minimum — catch unhandled errors, show recovery UI | Low | Low — additive only | — |
| 0b | Add `AbortController` to all client fetches in effects/handlers | Low | Low — standard pattern | — |
| 0c | Use Prisma error codes (P2024, etc.) instead of `.includes("timed out fetching...")` string matching | Low | Low — more precise | — |
| 0d | Sort playlists by `createdAt` timestamp, not numeric ID | Low | Low — add field to API | — |
| 0e | Fix unsafe `as unknown as` cast in `player-experience-core.tsx:30` — use `| undefined` union | Low | Low — type-only change | — |

### Phase 1 — Structural (reduces duplication, improves maintainability)

| # | Action | Effort | Risk | Depends on |
|---|--------|--------|------|------------|
| 1a | Extract `<OverlayHeader title icon breadcrumbs />` component, replace 18+ occurrences; rename CSS class to `overlayHeaderBar` | Medium | Medium — touches many files | — |
| 1b | Merge `loading.tsx` into `page.tsx` using `<Suspense>`, delete 4 loading files | Medium | Medium — changes routing behavior | 1a (header consistency) |
| 1c | Extract `scripts/lib/test-harness.js`, refactor all verify scripts to import shared utilities | Low | Low — internal only | — |
| 1d | Extract `withApiHandler(schema, handler)` middleware for 29 API route handlers | Medium | Medium — touches every route | — |

### Phase 2 — Architecture (longer-term, higher design risk)

| # | Action | Effort | Risk | Depends on |
|---|--------|--------|------|------------|
| 2a | Replace window event bus with React context (`ArtistsLetterProvider`) or URL query param (`?letter=M`) | Medium | Medium — changes data flow | — |
| 2b | Server-side duplicate check for playlist add — `GET /api/playlists?checkVideoId=X` eliminates N+1 | Medium | Low — additive API change | — |
| 2c | Normalize Artist `genre1`–`genre6` columns into a proper `artist_genres` join table | High | High — schema migration + data migration + code changes | Schema freeze preferred |
| 2d | Add proper relations to `Favourite` (non-nullable `userId`, `videoId`) and `RelatedCache` | Medium | Medium — schema migration | 2c sequencing |

### Phase 3 — Cleanup (low-risk, removes dead weight)

| # | Action | Effort | Risk | Depends on |
|---|--------|--------|------|------------|
| 3a | Delete `reference/main.css` (261 lines, zero imports across 2,166 files) | Low | Low — verify once more before deletion | — |
| 3b | Remove dead root scripts: `diag.js`, `diagnose-discovery.sh`, `verify-discovery.sh`, `pending-check.sh`, `extract-favs.py` | Low | Low — git-preserved if needed | — |
| 3c | Archive HOTSPOT_* and DEPLOYMENT_* MD files to `docs/archive/` | Low | Low — move, don't delete | — |
| 3d | Audit `backups/` directory for irreplaceable data; archive or document | Low | Low — inspect first | — |
| 3e | Squash 51 migration directories into a baseline — only after a production schema freeze | Medium | Medium — irreversible | Coordinated with deploy |

### Phase 4 — CSS Modernization (technical debt on styling)

| # | Action | Effort | Risk | Depends on |
|---|--------|--------|------|------------|
| 4a | Audit `player-chrome.css` (3,752 lines) — identify dead rules, extract logical sections | High | Medium — CSS changes are hard to verify | — |
| 4b | Audit `browse.css` (2,853 lines) — same approach | High | Medium | — |
| 4c | Consider CSS Modules or Tailwind for new components going forward | N/A | N/A — policy decision | User preference |

## Dependency Chain

```
Phase 0 (all independent — do immediately)
Phase 1a ──→ 1b
Phase 1c, 1d (independent)
Phase 2a, 2b (independent)
Phase 2c ──→ 2d
Phase 3 (all independent — cleanup anytime)
Phase 4a, 4b (independent — heavy, do when CSS churn is low)
All ──→ run `npm run verify:invariants`
```

## Constraints
- No changes to `deploy/` scripts, CI/CD, or build pipeline
- `npm run verify:invariants` must pass after all changes
- Prisma migration safety rules apply: never manually edit migration SQL without updating `schema.prisma`
- Phase 2c/2d are schema migrations — coordinate with production deploy
- CSS changes (Phase 4) carry high visual regression risk; verify with Playwright or manual review

## Key Architecture Notes
- 32 Prisma models, 0 enums, 489 lines in `schema.prisma`, 51 migrations
- CSS is vanilla with `@import` cascade from `globals.css` → 16 files in `apps/web/app/styles/`
- No CSS-in-JS, no Tailwind, no CSS Modules in use
- `reference/main.css` is confirmed dead — zero imports in entire project
- Design tokens live in a single file: `apps/web/app/styles/tokens.css` (57 lines)
- Invariant verification is the quality gate — no unit test framework (Vitest/Jest) configured yet
- The existing `PERFORMANCE_ROADMAP.md` Phase 3a/3b (cache rewrite) may overlap with schema quality work — coordinate

## How to Resume
Say: "continue the code quality roadmap" — the agent should read this file and pick up from the next pending phase. Phase 0 items are recommended first as they prevent real production bugs with minimal risk.
