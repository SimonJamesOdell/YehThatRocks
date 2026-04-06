# Code Smells Audit — YehThatRocks

> April 6, 2026

---

## 1. `loading.tsx` / `page.tsx` Duplication — **High**

> Ref: [Next.js `loading.js` convention](https://nextjs.org/docs/app/api-reference/file-conventions/loading) — intended for content-agnostic skeletons, not page-specific layout clones.

- 4 route pairs duplicate the full header (`favouritesBlindBar`, breadcrumbs, icon, `<CloseLink />`) in both `loading.tsx` and `page.tsx`
- Any header change must be applied in two files; miss one and loading/loaded states diverge
- `loading.tsx` is meant to be a generic fallback — duplicating page structure defeats the pattern

**Affected:** [top100](apps/web/app/(shell)/top100/), [artists](apps/web/app/(shell)/artists/), [artist/[slug]](apps/web/app/(shell)/artist/[slug]/), [categories/[slug]](apps/web/app/(shell)/categories/[slug]/)

**Fix:** Page owns its header and renders skeleton content inline via `<Suspense>`. Delete `loading.tsx` files.

---

## 2. `favouritesBlindBar` — No Shared Component — **High**

- Used in **18+ files** as the overlay header bar — not just favourites
- Misleading name; no component — each file hand-writes `<div className="favouritesBlindBar">` + title + close button
- Variants (breadcrumbs, icons) are ad-hoc per file

**Some occurrences:** [favourites/page.tsx](apps/web/app/(shell)/favourites/page.tsx), [search/page.tsx](apps/web/app/(shell)/search/page.tsx), [login/page.tsx](apps/web/app/(shell)/login/page.tsx), [playlists/[id]/page.tsx](apps/web/app/(shell)/playlists/[id]/page.tsx), [ai/page.tsx](apps/web/app/(shell)/ai/page.tsx), [app-shell.tsx](apps/web/components/app-shell.tsx), [playlists-grid.tsx](apps/web/components/playlists-grid.tsx), [playlist-editor.tsx](apps/web/components/playlist-editor.tsx), + all loading/page pairs from #1

**Fix:** Extract `<OverlayHeader title icon breadcrumbs />`. Rename CSS class to `overlayHeaderBar`.

---

## 3. `sortPlaylistsByRecency` — ID-Based Sort — **Medium**

> [add-to-playlist-button.tsx](apps/web/components/add-to-playlist-button.tsx#L31)

- Sorts by numeric ID descending — assumes auto-increment PKs
- Breaks on UUIDs, bulk imports, or backup restores where ID order ≠ chronological order
- `localeCompare` fallback has no temporal meaning
- `PlaylistSummary` type has no `createdAt` field

**Fix:** Add `createdAt` to API response and type. Sort by timestamp.

---

## 4. `ARTISTS_LETTER_CHANGE_EVENT` — Window Event Bus — **Medium**

> Refs: [React `useEffect` — cleanup & stale closures](https://react.dev/reference/react/useEffect#fetching-data-with-effects), [React `useContext` — passing data deeply](https://react.dev/reference/react/useContext#passing-data-deeply-into-the-tree)

[artists-letter-events.ts](apps/web/lib/artists-letter-events.ts) → consumed in [artists-letter-results.tsx](apps/web/components/artists-letter-results.tsx#L82) and [artists-letter-nav.tsx](apps/web/components/artists-letter-nav.tsx)

Pitfalls:

- **Stale closures** — handler captures `currentLetter` / `pageSize` at effect-registration time; adding deps is easy to forget
- **Strict mode double-fire** — `addEventListener` runs twice before cleanup in dev; code handles it, but fragile at scale
- **No fetch abort** — rapid letter switches start concurrent requests; `switchingLetterRef` guard drops new clicks but doesn't cancel in-flight requests
- **Stringly-typed** — event name `"ytr:artists-letter-change"` is a magic string; typos fail silently
- **Bypasses React data flow** — invisible to DevTools, harder to trace

**Fix:** Replace with React context (`ArtistsLetterProvider`) or URL query param (`?letter=M`). Gives type safety, proper lifecycle, deep-linking.

---

## 5. Script Duplication — **Medium**

~12 scripts in `scripts/` copy-paste the same boilerplate (**~400 lines total**):

| Pattern | Files |
|---------|-------|
| `loadDatabaseEnv()` | audit-catalog-integrity, verify-categories-invariants |
| `parseArg()`, `asNumber()`, `hasFlag()` | audit-video-embedability, audit-catalog-integrity, verify-categories-invariants |
| `assertContains()`, `assertMatches()`, `assertInvariant()` | all 7 verify-*-invariants scripts |
| `read()` file helper | all verify scripts |
| `main()` + failure collection + exit | all verify scripts |

- Bug fixes must be applied N times
- Assertion helpers have already diverged (string vs object failure format)

**Fix:** Extract `scripts/lib/test-harness.js`. Each script imports shared utilities and only defines assertions.

---

## 6. Additional Issues

### 6a. Missing `AbortController` on Client Fetches — **High**

> Ref: [React docs — fetching data with Effects](https://react.dev/reference/react/useEffect#fetching-data-with-effects) — "use a cleanup function to ignore stale responses"

- [artists-letter-results.tsx](apps/web/components/artists-letter-results.tsx#L100) — letter-switch fetch
- [add-to-playlist-button.tsx](apps/web/components/add-to-playlist-button.tsx#L76) — sequential playlist fetches
- [artist-video-link.tsx](apps/web/components/artist-video-link.tsx#L39) — warm-selection
- [favourites-grid.tsx](apps/web/components/favourites-grid.tsx) — refresh
- Only [player-experience.tsx](apps/web/components/player-experience.tsx) uses `AbortController`

### 6b. No `error.tsx` Boundaries — **Medium**

> Ref: [Next.js `error.js`](https://nextjs.org/docs/app/api-reference/file-conventions/error) — wraps route segment in React Error Boundary

- Zero `error.tsx` files in the entire app
- One unhandled error crashes the full overlay — white screen, no recovery

### 6c. Race Condition: Rapid Letter Switching — **Medium**

- `switchingLetterRef` guard silently drops clicks during fetch — no queue, no debounce
- Without `AbortController`, the stale fetch still completes and may set wrong state

### 6d. Transient DB Error Detection via String Matching — **Medium**

- [login/route.ts](apps/web/app/api/auth/login/route.ts) matches error messages with `.includes("timed out fetching...")`
- Prisma doesn't guarantee stable message wording across versions
- **Fix:** Use Prisma error codes (`P2024`, etc.)

### 6e. N+1 Fetch in Add-to-Playlist — **Medium**

- [add-to-playlist-button.tsx](apps/web/components/add-to-playlist-button.tsx#L135) fetches all playlists, then detail-fetches each one sequentially to check for duplicates
- **Fix:** Server-side `?checkVideoId=X` param on `GET /api/playlists`

### 6f. API Route Boilerplate — **Low-Medium**

- ~29 route handlers repeat 15-line auth + CSRF + body-parse + Zod pattern
- Security fix requires touching 29 files
- **Fix:** `withApiHandler(schema, handler)` wrapper

### 6g. Unsafe `as unknown as` Cast — **Low**

- [player-experience.tsx](apps/web/components/player-experience.tsx#L30): `return undefined as unknown as ReturnType<Performance["measure"]>`
- Runtime crash if return value is used downstream
- **Fix:** Return `| undefined` union type

---

## Action Plan

### Phase 1 — Structural (High impact, reduces duplication)

| # | Action | Effort |
|---|--------|--------|
| 1 | Extract `<OverlayHeader>` component, replace 18+ occurrences | Medium |
| 2 | Merge `loading.tsx` into `page.tsx` using `<Suspense>`, delete loading files | Medium |
| 3 | Extract `scripts/lib/test-harness.js`, refactor all verify scripts | Low |

### Phase 2 — Correctness (Prevents real bugs)

| # | Action | Effort |
|---|--------|--------|
| 4 | Add `AbortController` to all client fetches in effects/handlers | Low |
| 5 | Add `error.tsx` at `(shell)/` level minimum | Low |
| 6 | Sort playlists by `createdAt` timestamp, not ID | Low |
| 7 | Use Prisma error codes instead of string matching | Low |

### Phase 3 — Architecture (Longer-term)

| # | Action | Effort |
|---|--------|--------|
| 8 | Replace window event bus with React context or URL state | Medium |
| 9 | Server-side duplicate check for playlist add (eliminate N+1) | Medium |
| 10 | `withApiHandler()` middleware for API route boilerplate | Medium |
