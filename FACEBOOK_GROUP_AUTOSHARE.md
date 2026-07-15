# Facebook Group Auto-Share & Browser Posting

YehThatRocks has two Facebook group posting systems:

| System | Transport | Best for | Scripts |
|---|---|---|---|
| **API-based** | Facebook Graph API | Link shares, video spotlights | `facebook-group-autoshare.js`, `facebook-group-new-video-share.js` |
| **Browser-based** | Playwright + Chromium (signed-in profile) | Magazine articles, rich posts, engagement prompts | `facebook-browser-post.js` (unified, 6 modes) |

---

## Browser-Based Posting (unified)

The browser system uses a persistent Chromium profile signed into Facebook on the Linux machine. A single script — `facebook-browser-post.js` — supports 6 post modes designed to drive organic group engagement through comments, reactions, and dwell time.

### Why browser-based?

The Facebook Graph API restricts what you can post (links, plain text). The browser can post anything a human can — including link previews with rich cards, multi-link posts, and text-only discussion starters — all from a real signed-in account. This makes the posts feel native, which the algorithm rewards.

### Post modes

| # | Mode | Post type | DB needed? | Engagement driver |
|---|---|---|---|---|
| 1 | `magazine` | Magazine article link | No (API fetch) | Click-through, article comments |
| 2 | `spotlight` | Single video + discussion question | Yes | Comments ("What do you think?") |
| 3 | `versus` | Two videos head-to-head | Yes | Comment votes ("Which is better?") |
| 4 | `discussion` | Text-only prompt | No | Pure comments, no link needed |
| 5 | `roundup` | Top N tracks with links | Yes | Clicks + comments |
| 6 | `trivia` | "Guess the artist/track" from clues | No | Comments, dwell time |

### Commands

All modes support `--dry-run`, `--login`, `--headed`, `--keep-open`, `--pause-before-submit`, and `--force-latest`.

```bash
# Magazine (legacy — existing cron jobs unchanged)
npm run facebook:browser-post:magazine
npm run facebook:browser-post:magazine:dry-run

# Spotlight
npm run facebook:browser-post:spotlight
npm run facebook:browser-post:spotlight:dry-run

# Versus
npm run facebook:browser-post:versus
npm run facebook:browser-post:versus:dry-run

# Discussion
npm run facebook:browser-post:discussion
npm run facebook:browser-post:discussion:dry-run

# Roundup
npm run facebook:browser-post:roundup
npm run facebook:browser-post:roundup:dry-run

# Trivia
npm run facebook:browser-post:trivia
npm run facebook:browser-post:trivia:dry-run

# Login (headed browser — run once per machine to sign in)
npm run facebook:browser-post:login
```

Or directly:
```bash
node scripts/facebook-browser-post.js --mode spotlight --dry-run
```

### Environment variables

#### Shared (all modes)

| Variable | Default | Description |
|---|---|---|
| `FB_BROWSER_POST_GROUP_URL` | *(falls back to `MAGAZINE_BROWSER_POST_GROUP_URL`)* | Facebook group URL |
| `FB_BROWSER_POST_APP_URL` | *(falls back to `APP_URL`)* | Site base URL for building links |
| `FB_BROWSER_POST_PROFILE_DIR` | `~/.local/share/yehthatrocks/facebook-browser-profile` | Persistent browser profile |
| `FB_BROWSER_POST_STATE_DIR` | `~/.local/state/yehthatrocks` | Per-mode state files stored here |
| `FB_BROWSER_POST_LOCK_PATH` | `~/.local/state/yehthatrocks/facebook-browser.lock` | Run lock |
| `FB_BROWSER_POST_DRY_RUN` | `0` | Set to `1` for dry-run by default |
| `FB_BROWSER_POST_HEADLESS` | `1` | Set to `0` for headed browser |
| `FB_BROWSER_POST_KEEP_OPEN` | `0` | Keep browser open after posting |
| `FB_BROWSER_POST_PAUSE_BEFORE_SUBMIT` | `0` | Pause on page 2 before clicking Post |
| `FB_BROWSER_POST_FORCE_LATEST` | `0` | Re-post even if already posted |
| `FB_BROWSER_POST_BROWSER_CHANNEL` | *(system default)* | Chromium channel override |

#### Magazine mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_MAGAZINE_MESSAGE_PREFIX` | *(none — just the URL)* |
| `FB_BROWSER_POST_MAGAZINE_ARTICLE_API_URL` | `/api/magazine/latest?limit=1` |

Legacy `MAGAZINE_BROWSER_POST_*` variables are still read as fallbacks.

#### Spotlight mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_SPOTLIGHT_MESSAGE_PREFIX` | `🎸 Track Spotlight 🎸` |
| `FB_BROWSER_POST_SPOTLIGHT_POOL_SIZE` | `600` |
| `FB_BROWSER_POST_SPOTLIGHT_DEDUPE_DAYS` | `60` |

#### Versus mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_VERSUS_MESSAGE_PREFIX` | `⚔️ Track Battle! ⚔️` |
| `FB_BROWSER_POST_VERSUS_POOL_SIZE` | `600` |
| `FB_BROWSER_POST_VERSUS_DEDUPE_DAYS` | `90` |

#### Discussion mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_DISCUSSION_MESSAGE_PREFIX` | `💬 Discussion Time` |
| `FB_BROWSER_POST_DISCUSSION_DEDUPE_DAYS` | `14` |

Prompts are stored in `scripts/data/discussion-prompts.json` (25 prompts). Edit this file to add, remove, or tweak questions.

#### Roundup mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_ROUNDUP_MESSAGE_PREFIX` | `📊 This Week's Top Tracks` |
| `FB_BROWSER_POST_ROUNDUP_COUNT` | `5` |

Only one roundup is posted per day (deduped by date).

#### Trivia mode

| Variable | Default |
|---|---|
| `FB_BROWSER_POST_TRIVIA_MESSAGE_PREFIX` | `🎸 Trivia Time! 🎸` |
| `FB_BROWSER_POST_TRIVIA_DEDUPE_DAYS` | `30` |

Clues are stored in `scripts/data/trivia-clues.json` (20 clues). Edit this file to add more.

### Recommended cron schedule (Linux)

```cron
# Magazine — every 6 hours (existing)
0 */6 * * * cd /srv/yehthatrocks && npm run facebook:browser-post:magazine >> /var/log/ytr-fb-magazine.log 2>&1

# Spotlight — every 4 hours (staggered from magazine)
30 1,5,9,13,17,21 * * * cd /srv/yehthatrocks && npm run facebook:browser-post:spotlight >> /var/log/ytr-fb-spotlight.log 2>&1

# Versus — twice daily
0 10,20 * * * cd /srv/yehthatrocks && npm run facebook:browser-post:versus >> /var/log/ytr-fb-versus.log 2>&1

# Discussion — once daily (morning)
0 9 * * * cd /srv/yehthatrocks && npm run facebook:browser-post:discussion >> /var/log/ytr-fb-discussion.log 2>&1

# Roundup — once daily (evening)
0 20 * * * cd /srv/yehthatrocks && npm run facebook:browser-post:roundup >> /var/log/ytr-fb-roundup.log 2>&1

# Trivia — every other day
0 14 */2 * * cd /srv/yehthatrocks && npm run facebook:browser-post:trivia >> /var/log/ytr-fb-trivia.log 2>&1
```

This produces ~8 posts/day across varied formats — enough variety for algorithmic reach without flooding the group. Each mode has its own state file, so they deduplicate independently.

### First-time setup (Linux)

1. **Set environment variables** in `.env` or the shell profile:
   ```bash
   export FB_BROWSER_POST_GROUP_URL="https://www.facebook.com/groups/YOUR_GROUP_ID"
   export FB_BROWSER_POST_APP_URL="https://yehthatrocks.com"
   export DATABASE_URL="mysql://..."
   ```

2. **Run the login flow once** to create a signed-in browser profile:
   ```bash
   npm run facebook:browser-post:login
   ```
   This opens a headed Chromium window on the Linux box. Log into Facebook, verify the group page loads, then press Enter in the terminal. The session is persisted in the profile directory.

3. **Test each mode in dry-run:**
   ```bash
   npm run facebook:browser-post:spotlight:dry-run
   npm run facebook:browser-post:discussion:dry-run
   npm run facebook:browser-post:trivia:dry-run
   ```
   Dry-runs print the message that would be posted without opening a browser or touching Facebook.

4. **Test a live post:**
   ```bash
   npm run facebook:browser-post:discussion
   ```

5. **Install the cron jobs.**

### Content bank management

The discussion prompts and trivia clues are plain JSON files you can edit directly:

- `scripts/data/discussion-prompts.json` — 25 prompts, each with `id`, `text`, and `tags`
- `scripts/data/trivia-clues.json` — 20 clues, each with `id`, `clue`, `answer`, `hint`, and `tags`

The scripts automatically avoid reusing items within their dedupe window. When all items are exhausted they cycle back to the oldest. To add variety, just append new entries to these files — no code changes needed.

### Backward compatibility

The existing `magazine-facebook-browser-post.js` is now a thin wrapper that delegates to `facebook-browser-post.js --mode magazine`. All existing cron jobs, npm scripts, and `MAGAZINE_BROWSER_POST_*` env vars continue to work unchanged.

---

## API-Based Auto-Share

The API-based scripts use the Facebook Graph API to post links with messages. They are lighter-weight than the browser system but limited to link posts.

### Scripts

- `facebook-group-autoshare.js` — Curated video link shares (weighted tier randomization)
- `facebook-group-new-video-share.js` — Newly approved video shares

### Commands

```bash
# Curated shares
npm run facebook:group-share
npm run facebook:group-share:dry-run

# New video shares
npm run facebook:new-video-share
npm run facebook:new-video-share:dry-run
```

### Compliance-first guardrails

Both API scripts enforce operational limits:

- Minimum interval between posts (`FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES`)
- Daily post cap (`FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY`)
- Recent-post dedupe window in days (`FB_GROUP_AUTOSHARE_DEDUPE_DAYS`)
- State tracking file for posted video history (`FB_GROUP_AUTOSHARE_STATE_PATH`)

### Required setup

1. Ensure Meta permissions and app review are complete for your posting flow.
2. Provide a valid group posting token and group id.
3. Set environment variables (see `.env.example`).

### Environment variables

#### facebook-group-autoshare.js

- `FB_GROUP_AUTOSHARE_DRY_RUN` (default `1`)
- `FB_GROUP_ID`
- `FB_GROUP_ACCESS_TOKEN`
- `FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES` (default `180`)
- `FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY` (default `4`)
- `FB_GROUP_AUTOSHARE_POOL_SIZE` (default `600`)
- `FB_GROUP_AUTOSHARE_DEDUPE_DAYS` (default `30`)
- `FB_GROUP_AUTOSHARE_STATE_PATH` (default `logs/facebook-group-autoshare-state.json`)

#### facebook-group-new-video-share.js

- `FB_GROUP_NEW_VIDEO_DRY_RUN` (default `1`)
- `FB_GROUP_ID`
- `FB_GROUP_ACCESS_TOKEN`
- `FB_GROUP_NEW_VIDEO_MIN_INTERVAL_MINUTES` (default `60`)
- `FB_GROUP_NEW_VIDEO_MAX_POSTS_PER_DAY` (default `6`)
- `FB_GROUP_NEW_VIDEO_POOL_SIZE` (default `200`)
- `FB_GROUP_NEW_VIDEO_DEDUPE_DAYS` (default `14`)
- `FB_GROUP_NEW_VIDEO_STATE_PATH` (default `logs/facebook-group-new-video-share-state.json`)

### Magazine article auto-share variables (API-based)

- `FB_GROUP_MAGAZINE_AUTOSHARE_ENABLED` (default `0`)
- `FB_GROUP_MAGAZINE_AUTOSHARE_DRY_RUN` (default `1`)
- `FB_GROUP_MAGAZINE_AUTOSHARE_STATE_PATH` (default `logs/facebook-group-magazine-autoshare-state.json`)

When enabled, each newly generated article attempts to publish exactly once per slug (state-file dedupe). Generation does not fail if Facebook posting fails; errors are emitted in script output.

### Automation examples

#### Linux cron (every 30 minutes)

```cron
*/30 * * * * cd /srv/yehthatrocks && /usr/bin/npm run facebook:group-share >> /var/log/ytr-facebook-share.log 2>&1
```

The script will skip automatically if posting too frequently or daily cap is reached.

#### Windows Task Scheduler

- Program: `npm`
- Arguments: `run facebook:group-share`
- Start in: repo root
- Trigger cadence: every 30 to 60 minutes

### Candidate quality strategy

The API scripts do not pick from all videos blindly. They:

- Use playable videos only
- Pull from a high-quality popularity-sorted pool
- Use weighted tier randomization to keep quality high while widening variety
- Avoid recently shared tracks
