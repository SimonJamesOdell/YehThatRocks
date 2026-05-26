# Genre Reclassification Runbook

## What This Does

- Runs a resumable full-catalog genre classification worker.
- Updates `videos.genre` directly when confidence is `>= 0.9`.
- Hard-deletes videos confidently classified as non-rock/metal (confidence `>= 0.9`).
- Pushes unresolved videos into `admin_genre_review_queue` for manual review in Admin -> Genre Review.
- Persists progress in `admin_genre_reclassify_state` so restarts resume from checkpoint.

## Commands

Run worker (inside web container):

```bash
npm run classify:genres:catalog
```

Optional Groq-assisted mode:

```bash
npm run classify:genres:catalog:groq
```

Watch progress in another terminal:

```bash
npm run classify:genres:watch
```

## Production (Docker Compose)

Background classifier service is disabled.

Run reclassification manually (one-off) only when explicitly needed:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm web node scripts/reclassify-catalog-genres.js
```

## Environment Variables

- `GENRE_RECLASSIFY_THRESHOLD` (default `0.9`)
- `GENRE_RECLASSIFY_BATCH_SIZE` (default `150`)
- `GENRE_RECLASSIFY_STATUS_EVERY` (default `25`)
- `GENRE_RECLASSIFY_IDLE_SLEEP_MS` (default `15000`)
- `GENRE_RECLASSIFY_MB_DELAY_MS` (default `1200`)
- `GENRE_RECLASSIFY_USE_GROQ=1` to enable Groq source

## Admin UI

- Open Admin tab: `Genre Review`
- Works like catalog cleanup:
  - Preview current queued video
  - Save Genre + Keep
  - Remove Video

## Resume Behavior

- Safe to stop/restart.
- Worker resumes from `admin_genre_reclassify_state.last_video_id`.
