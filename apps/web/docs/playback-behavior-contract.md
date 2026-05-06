# Playback Behavior Contract

This document defines the normative rules for next-track resolution, queue
semantics, and autoplay. It is derived directly from the implementation in
`domains/player/resolve-next-track-target.ts`, `domains/queue/temporary-queue.ts`,
`domains/playlist/playlist-step-target.ts`, and `components/player-experience.tsx`.
Any change to these behaviors must be reflected here.

---

## 1. Next-Track Priority Ladder

When advancing to the next track (video ended or user pressed Next), the system
walks the following states in order and stops at the first **resolved** outcome.
A **blocked** outcome halts the walk entirely — nothing plays.

| Priority | State | Condition | Outcome |
|---|---|---|---|
| 1 | **Playlist** | `activePlaylistId` is set | Resolved → next playlist track (wraps at end). Blocked if playlist is selected but not yet loaded. |
| 2 | **Temporary queue** | Queue is non-empty | Resolved → track immediately after the current video in the queue, or the first queue track if the current video is not in the queue. |
| 3 | **Route queue** | Desktop docked + autoplay ON + route has a queue | Resolved → next track in the route-contextual queue (New, Top 100, Favourites, Category, Artist), wrapping cyclically. |
| 4 | **Random fallback** | Autoplay ON (any route) | Resolved → a random track from the Watch Next pool, avoiding recently-seen tracks. |

If every state returns **unresolved** and the ladder exhausts, `resolveNextTrackTarget`
returns `null` and the player shows the **ended-choice overlay** instead.

**Canonical source:** `domains/player/resolve-next-track-target.ts → resolveNextTrackTarget()`

---

## 2. Playlist Semantics

- A playlist is "active" only when: `activePlaylistId` is set **and** the
  playlist queue has been loaded and attributed to that playlist id
  (`playlistQueueOwnerId === activePlaylistId && playlistQueueIds.length > 0`).
- While a playlist is selected but not yet loaded the ladder is **blocked** — no
  lower-priority source can steal playback. This prevents the random fallback
  from playing while the user's playlist is loading.
- Playlist steps wrap cyclically at both ends (next on last → first; prev on
  first → last).
- Previous-track is available only within a playlist context. It is not available
  via the temporary queue or route queue.
- Activating autoplay while a playlist is active does **not** terminate the
  playlist — playlist priority (1) outranks route-queue priority (3).

---

## 3. Temporary Queue Semantics

The temporary queue is an in-memory, session-only ordered list of tracks.

### Adding
- `{ type: "add", track }` — appends to the tail; silently no-ops if the track
  is already in the queue (deduplication).

### Removing
Entries are removed by one of three reasons, each produced in a specific
context:

| Reason | Produced by | Meaning |
|---|---|---|
| `"ended"` | `VIDEO_ENDED_EVENT` listener | The video reached its natural end |
| `"manual-next"` | `TEMP_QUEUE_DEQUEUE_EVENT` listener | The user pressed Next while the current video was in the queue |
| `"transition-sync"` | `useTemporaryQueueController` effect | The current video changed and the previous video id must be purged to keep the queue head correct |

The reason is informational — it does not affect which entry is removed. The
payload `videoId` always identifies the specific entry to drop.

### Resolution
`resolveTemporaryQueueTarget(queue, currentVideoId)`:
- Returns the **next entry after `currentVideoId`** if the current video is in
  the queue.
- Returns the **first entry** if the current video is not in the queue.
- Returns `null` if the queue is empty.

### Lifecycle
- The queue is cleared via `{ type: "clear" }`.
- There is no persistence — the queue resets on page reload.

---

## 4. Autoplay On / Off Rules

### Storage and initialization
1. On mount, autoplay state is read from `localStorage` key `yeh-player-autoplay`.
2. For authenticated users, a background fetch to `GET /api/player-preferences`
   overwrites the local value. Server preference is authoritative for
   authenticated sessions.
3. Changes are written to both `localStorage` **and** `POST /api/player-preferences`
   (best-effort; UI state is updated immediately regardless of network outcome).

### What autoplay controls

| Autoplay | Playlist | Route docked | Behaviour |
|---|---|---|---|
| OFF | — | home (`/`) | Playback stops at end of video → ended-choice overlay |
| OFF | — | overlay route open | Playback stops at end of video → player closes |
| ON | active | any | Playlist sequencing (priority 1 overrides route queue) |
| ON | none | `/new` or `/top100` open | Route-local progression only within the visible page list |
| ON | none | not docked elsewhere | Random fallback from Watch Next pool (priority 4) |
| ON | none | docked on supported route | Route-contextual queue (priority 3) then random fallback (priority 4) |

Supported routes for route-queue autoplay: `/new`, `/top100`, `/favourites`,
`/categories/[slug]`, `/artist/[slug]`.

### Enabling autoplay from a route overlay
When the user enables autoplay while already on `/new` or `/top100`, the player
stays on that page and advances only within the route list.

When the user enables autoplay while already on another supported route overlay,
the system may still build a playlist for that route context and navigate to its
first video so autoplay can sequence from the correct starting point.

### Auto-advance suspension
Auto-advance is suspended during overlay route transitions
(`autoplayRouteTransitionRef = true`) even though `autoplayEnabled` remains
`true`. This prevents a spurious random-fallback advance from racing the
route-contextual queue load. The flag is cleared once the route settles.

---

## 5. Invariants (must not break)

These conditions are asserted by `npm run verify:invariants` and the Vitest
domain-test suite. Any refactor must preserve them.

1. **Priority order is fixed.** Playlist → temporary-queue → route-queue →
   random-fallback. No step may be evaluated before the one above it.
2. **Blocked halts the walk.** A `blocked` outcome from any step must prevent
   all lower-priority steps from evaluating.
3. **Queue deduplication.** Adding a track that is already in the queue must
   be a no-op (same reference returned).
4. **Route-queue gated on autoplay ON.** The route-queue step must not resolve
   when autoplay is off.
5. **`/new` and `/top100` stay route-local.** When those pages are open,
   autoplay must not fall back to a random Watch Next pick.
6. **Random fallback gated on autoplay ON.** It must not resolve when autoplay
   is off, regardless of queue/playlist state.
7. **`manual-next` reason on user Next.** When the user presses Next and the
   current video was in the temporary queue, a `TEMP_QUEUE_DEQUEUE_EVENT` with
   `reason: "manual-next"` must be dispatched before navigating.
8. **Playlist-step wraps.** Next on the last track wraps to index 0; prev on
   index 0 wraps to the last track. No out-of-bounds access.
