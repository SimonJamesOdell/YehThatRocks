# YehThatRocks — Traffic Growth Roadmap

A living, iterable plan for driving organic traffic through automation and
low-cost distribution. Every phase is designed to compound — once built,
it keeps working.

**Principles:**
- Zero marginal cost per visitor.
- Build once, run forever (or on a cron job).
- Prefer programmatic over manual.
- Every piece of content should be distributed to every surface.

---

## Phase 1 — SEO Foundation (build now, permanent uplift)

Goal: make every existing page maximally visible to search engines.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 1.1 | **Schema.org JSON-LD on video pages** — `VideoObject` + `MusicRecording` structured data for every `/watch/[id]` and `/artist/[slug]` page. Google rich results (thumbnail, duration, upload date) get 30–50% higher CTR. | 3h | ⭐⭐⭐⭐⭐ | — |
| 1.2 | **Schema.org on magazine articles** — `Article` + `NewsArticle` JSON-LD. Eligible for Google News carousel and "Top stories" rich results. | 1h | ⭐⭐⭐⭐ | — |
| 1.3 | **Schema.org on artist wiki pages** — `ProfilePage` + `MusicGroup`/`Person` structured data. Knowledge panel eligibility. | 1h | ⭐⭐⭐ | 1.1 |
| 1.4 | **BreadcrumbList schema** on all nested pages (Home > Artist > Track). Google shows breadcrumbs in SERPs — higher CTR, better crawl structure. | 1h | ⭐⭐⭐ | — |
| 1.5 | **Site name + search action schema** in root layout — enables sitelinks search box in Google. | 0.5h | ⭐⭐ | — |
| 1.6 | **Submit to Bing Webmaster Tools** — free, often ignored, feeds into Bing + DuckDuckGo + Yahoo + ChatGPT search. Import sitemaps. | 0.5h | ⭐⭐ | — | ⬜ Manual — user must create Bing account |
| 1.7 | **RSS feed for new videos** — `/feed/new-videos.xml`. Submit to RSS aggregators, feed readers, and podcast directories. Enables IFTTT/Zapier integrations by users. | 1h | ⭐⭐ | — | ✅ Built (`apps/web/app/feed/new-videos.xml/route.ts`) |
| 1.8 | **RSS feed for magazine articles** — `/feed/magazine.xml`. Submit to Google News Publisher Center. | 0.5h | ⭐⭐ | — | ✅ Built (`apps/web/app/feed/magazine.xml/route.ts`) |
| 1.9 | **Auto-generate OpenGraph images** — use `vercel/og` or Puppeteer to render share images per video/artist/article instead of the static guitar_back.png fallback. Dramatically better social previews = more clicks. | 3h | ⭐⭐⭐⭐ | — | ✅ Built (`apps/web/app/og/route.tsx` + `buildOgImageUrl` in schema-org.ts) |

---

## Phase 2 — Social Distribution (wider funnel)

Goal: your content appears where rock/metal fans already hang out.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 2.1 | **Multi-subreddit cross-posting** — extend `scripts/reddit-subreddit-autoshare.js` to rotate across genre-mapped subreddits (r/Metal, r/progmetal, r/rock, r/Metalcore, r/numetal, r/doommetal, r/Deathmetal, r/listentothis, r/stonerrock, r/powermetal). Auto-map video genre → best subreddit. Max 1–2 posts/day total across all subs. | 2h | ⭐⭐⭐⭐ | — |
| 2.2 | **Reddit engagement bot** — 2–3 times/week, find relevant discussions in target subreddits and post a genuine comment that happens to link to a relevant page. Not spam — human-seeded templates + LLM customisation. | 3h | ⭐⭐⭐ | 2.1 |
| 2.3 | **Pinterest auto-pin** — Node + Puppeteer on Linux. For each new video: create a Pin with thumbnail, "Artist — Track [Genre]", and link to your page. Auto-create genre boards. Run daily for new content, weekly backfill for catalogue. | 3h | ⭐⭐⭐⭐ | — |
| 2.4 | **Twitter/X auto-posting** — tweet new videos and magazine articles. "Artist — Track [Genre] 🔥 yehthatrocks.com/v/..." Use Twitter API v2. Cron every 2–4 hours. | 1h | ⭐⭐⭐ | — |
| 2.5 | **Facebook page (not just group)** — auto-post to a YehThatRocks Facebook *page*. Pages have different reach mechanics than groups. Share videos, articles, top 100 updates. | 1h | ⭐⭐ | — |
| 2.6 | **Instagram auto-posting** — this is harder (no official write API). Option A: use the Facebook Graph API to post to a linked Instagram business account. Option B: Puppeteer-driven auto-posting of image + link-in-bio updates. Square thumbnails + artist/title overlay. | 4h | ⭐⭐⭐ | — |
| 2.7 | **TikTok auto-clips** — use FFmpeg to generate 15–30s video clips (thumbnail + audio snippet + text overlay). Upload via TikTok's web upload or their creator API. "New rock discovery 🔥 [Artist] — [Track]" | 5h | ⭐⭐⭐⭐ | — |
| 2.8 | **YouTube Shorts** — same FFmpeg-generated short clips, uploaded to a YehThatRocks YouTube channel. Link in description + pinned comment. Even 200-view Shorts send measurable traffic. | 3h | ⭐⭐⭐⭐ | — |

---

## Phase 3 — Programmatic SEO (long-tail keyword capture)

Goal: auto-generate thousands of unique, useful landing pages from your existing
database content. Zero new content creation — just new views of existing data.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 3.1 | **Genre × Year pages** — `/best-of/[genre]/[year]`. "Best Progressive Metal Songs of 2024". List top videos for that genre+year, sorted by play count or recency. Add to sitemap. | 3h | ⭐⭐⭐⭐⭐ | — |
| 3.2 | **Decade pages** — `/decade/[slug]`. "Best 90s Rock Music Videos", "2000s Metal Classics". Aggregate across genres within a decade range. | 2h | ⭐⭐⭐⭐ | 3.1 |
| 3.3 | **Genre deep-dive pages** — `/genre/[slug]`. Not just a filter — a proper landing page with description, top artists, recent additions, and related genres. | 3h | ⭐⭐⭐⭐ | — |
| 3.4 | **"Bands like X" pages** — `/artist/[slug]/similar`. Use genre overlap + MusicBrainz relationship data to generate "If you like Opeth, try…" pages. High-intent search queries. | 3h | ⭐⭐⭐⭐ | — |
| 3.5 | **Mood/activity pages** — `/mood/[slug]`. "Workout metal", "Study rock", "Driving songs". Tag videos by tempo/energy (can be LLM-classified in bulk), build curated lists. | 4h | ⭐⭐⭐ | — |
| 3.6 | **Country/region pages** — `/country/[slug]`. "Best Swedish Metal Bands", "Australian Rock Artists". Use artist origin data from MusicBrainz. | 2h | ⭐⭐⭐ | — |
| 3.7 | **"vs" comparison pages** — `/compare/[slug-a]-vs-[slug-b]`. Auto-generate side-by-side comparisons of two artists: genre overlap, play counts, top tracks, wiki excerpts. Captures "[band a] vs [band b]" queries. | 3h | ⭐⭐⭐ | 3.4 |
| 3.8 | **Album pages** — if you have album data from MusicBrainz, `/album/[slug]`. Album review aggregator pages with track listings and links to individual videos. | 3h | ⭐⭐⭐ | — |

---

## Phase 4 — YouTube Ecosystem (ride their algorithm)

Goal: use YouTube's own distribution to funnel viewers to your site.

**Status:** ✅ 4.2 + 4.4 built (2026-07-10). 4.1 is manual. 4.3 blocked (no public API). 4.5 deferred.

| # | Task | Effort | Impact | Depends on | Status |
|---|------|--------|--------|------------|--------|
| 4.1 | **YouTube channel setup** — create, brand, and verify a YehThatRocks YouTube channel. Enable custom URL, fill out About section with site link. | 1h | ⭐⭐ | — | ⬜ Manual |
| 4.2 | **Auto-upload Shorts** — FFmpeg pipeline: thumbnail → 15–30s video with audio waveform visualization + text overlay. Upload 2–3/day via YouTube Data API. Each links to your site. | 6h | ⭐⭐⭐⭐⭐ | 4.1 | ✅ Built (`scripts/youtube-shorts-upload.js`) |
| 4.3 | **Community tab posts** — auto-post to YouTube Community tab when new videos land or magazine articles publish. Polls ("Which is the better Metallica album?") drive engagement → algorithm boost. | 2h | ⭐⭐⭐ | 4.1 | 🚫 Blocked — YouTube Community tab has no public Data API endpoint |
| 4.4 | **Playlist auto-curation** — create and maintain YouTube playlists by genre, year, mood. Public playlists rank in YouTube search and drive channel subscribers. | 2h | ⭐⭐⭐ | 4.1 | ✅ Built (`scripts/youtube-playlist-curator.js`) |
| 4.5 | **YouTube comment engagement** — find popular rock/metal videos, post genuine comments from the channel account. Not spam — the channel account becomes a recognizable presence. | 2h (then automated) | ⭐⭐ | 4.1 | ⏳ Deferred — lower priority, manual review recommended |

---

## Phase 5 — Content Repurposing (one piece, many formats)

Goal: every magazine article and video entry becomes multiple pieces of content
across different surfaces.

**Status:** ✅ 5.1 + 5.5 + 5.6 built (2026-07-11). 5.2/5.4 deferred. 5.3 blocked by 1.8. 5.7 blocked by 1.9.

| # | Task | Effort | Impact | Depends on | Status |
|---|------|--------|--------|------------|--------|
| 5.1 | **Medium cross-posting** — auto-publish magazine articles to Medium (canonical link back to your site). Medium's domain authority sends ranking signals. Use their API or Puppeteer. | 2h | ⭐⭐⭐ | — | ✅ Built (`scripts/medium-crosspost.js`) |
| 5.2 | **Quora answers** — auto-detect questions like "best metal bands 2024" or "songs like Tool" and post answers that naturally reference your pages. LLM-generated, human-reviewed, low volume. | 3h | ⭐⭐⭐ | — | ⏳ Deferred — LLM + Puppeteer, fragile, manual review recommended |
| 5.3 | **Email newsletter** — weekly "Best New Rock & Metal" digest. Auto-compiled from magazine articles + top new videos. Free tier on Brevo/Mailchimp. Signup form on site. | 4h | ⭐⭐⭐⭐ | 1.8 | 🚫 Blocked by 1.8 (magazine RSS feed not built) |
| 5.4 | **Web push notifications** — browser push for returning visitors. "New [Artist] video just landed" → click → site visit. Service Worker + Web Push API. | 4h | ⭐⭐⭐ | — | ⏳ Deferred — Service Worker + VAPID infra needed |
| 5.5 | **Telegram channel** — auto-post new videos and articles to a YehThatRocks Telegram channel. Telegram channels rank in Telegram search and have no algorithm suppression. | 1h | ⭐⭐ | — | ✅ Built (`scripts/telegram-autoshare.js`) |
| 5.6 | **Discord webhook bot** — a bot that posts to rock/metal Discord servers that opt in. Many servers welcome content bots for discovery channels. | 2h | ⭐⭐ | — | ✅ Built (`scripts/discord-webhook-share.js`) |
| 5.7 | **WhatsApp share-optimized pages** — ensure OpenGraph tags render well in WhatsApp previews. Consider a "Share on WhatsApp" button for mobile users. | 1h | ⭐⭐ | 1.9 | 🚫 Blocked by 1.9 (OG images not built) |

---

## Phase 6 — Backlinks & Authority (long game)

Goal: other sites linking to you. Hardest to automate, highest leverage.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 6.1 | **Artist outreach** — for artists with wiki pages, auto-detect contact info. Send a templated email: "We have a page about your band — want to add anything? Feel free to share it." Artists share their own pages. Free backlinks. | 3h | ⭐⭐⭐⭐ | — | ✅ Built (`scripts/artist-outreach.js`) |
| 6.2 | **Broken link recovery** — crawl rock/metal blogs and forums for broken links to now-defunct music sites. If your page covers the same artist/topic, email the site owner suggesting your link as a replacement. Semi-automated: crawler finds targets, you review and send. | 4h | ⭐⭐⭐⭐ | — | ✅ Built (`scripts/broken-link-recovery.js`) |
| 6.3 | **Competitor backlink replication** — use free Ahrefs/Semrush tiers to find who links to similar small music sites. Target those sites for mentions, guest posts, or link requests. | 3h (research) + ongoing | ⭐⭐⭐⭐ | — | ⬜ Manual — research task |
| 6.4 | **Music blog directory listings** — submit to every free music blog directory, webring, and discovery network. One-time manual task, permanent links. | 2h | ⭐⭐ | — | ⬜ Manual — user must submit |
| 6.5 | **Wikipedia citations** — find Wikipedia articles about artists/genres. If your site has unique data (wiki content, accurate discographies), add citations where appropriate. Must be genuinely useful, not spam. | 3h (manual) | ⭐⭐⭐⭐ | — | ⬜ Manual — user must edit Wikipedia |
| 6.6 | **"Best of" list inclusion** — pitch your genre/year pages to listicle sites ("Top 10 Sites for Metal Discovery"). LLM-assisted personalised emails. | 2h + ongoing | ⭐⭐⭐ | 3.1–3.3 | ⬜ Manual — user outreach |

---

## Phase 7 — Technical SEO & Performance

Goal: make the site faster and more crawlable.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 7.1 | **Core Web Vitals audit** — check LCP, INP, CLS on key pages. Fix slow renders. Google penalises slow sites, especially on mobile. | 3h | ⭐⭐⭐⭐ | — |
| 7.2 | **robots.txt audit** — ensure no important pages are blocked. Verify sitemap references are correct. | 0.5h | ⭐⭐ | — | ✅ Verified — `apps/web/app/robots.ts` well-configured with sitemap ref |
| 7.3 | **Canonical URL audit** — ensure every page has a correct canonical tag. Prevent duplicate content penalties (www vs non-www, trailing slashes, pagination). | 1h | ⭐⭐⭐ | — | ✅ Verified — all pages use `generateMetadata` with `alternates.canonical` |
| 7.4 | **404 recovery** — catch soft 404s (pages that return 200 but have no content). Redirect dead artist pages to genre pages. Monitor server logs for crawl errors. | 2h | ⭐⭐ | — | ✅ Built — `apps/web/app/(shell)/not-found.tsx` + `notFound()` guards |
| 7.5 | **Image optimisation** — auto-compress thumbnails, serve WebP, add explicit width/height to prevent CLS. | 2h | ⭐⭐⭐ | — | ⬜ Manual — YouTube thumbnails are external; investigation needed |
| 7.6 | **Lazy load below-fold content** — reduce initial page weight. Videos and thumbnails below the fold shouldn't block first paint. | 2h | ⭐⭐⭐ | — | ✅ Applied — `loading="lazy"` on thumbnail components, forum, mobile shell |
| 7.7 | **Edge caching headers** — set proper `Cache-Control`, `ETag`, and CDN headers for static assets and API responses. Faster repeat visits. | 1h | ⭐⭐ | — | ✅ Built — `next.config.js` headers for `/images/*`, `/favicons/*`, `/sounds/*` |

---

## Phase 8 — Analytics & Feedback Loops

Goal: know what's working and double down.

| # | Task | Effort | Impact | Depends on |
|---|------|--------|--------|------------|
| 8.1 | **UTM tagging on all auto-posts** — every Facebook post, Reddit share, Tweet, Pin gets `utm_source`, `utm_medium`, `utm_campaign` params. You need to know which channels convert. | 1h | ⭐⭐⭐ | — | ✅ Built — UTM params on all 10+ autoshare scripts |
| 8.2 | **Traffic dashboard script** — a Node script that queries Google Search Console API + server logs and prints a weekly summary: top pages, top queries, CTR trends, which channels are growing. | 3h | ⭐⭐⭐ | 8.1 | ✅ Built (`scripts/analytics-dashboard.js --dashboard`) |
| 8.3 | **A/B test share copy** — rotate multiple message templates for social posts. Track which phrasing gets more clicks. "New on YehThatRocks" vs "Just discovered this" vs "[Artist] just dropped". | 2h | ⭐⭐ | 8.1 | ✅ Built (`scripts/analytics-dashboard.js --ab-test`) |
| 8.4 | **Search Console query mining** — pull queries where you rank #4–20 (page 1–2 but not top 3). Those are easy wins — slight content improvements can push them to top 3. | 2h | ⭐⭐⭐⭐ | — | ✅ Built (`scripts/analytics-dashboard.js --ranking-gaps`) |

---

## Execution Order (recommended path)

```
Week 1:  Phase 1 (all of it) — SEO foundation. Schema + sitemaps + OG images.
         Phase 1 is the multiplier for everything else.

Week 2:  Phase 2, items 2.1–2.5 — social distribution. Reddit + Pinterest + Twitter + FB page.
         These start sending traffic immediately.

Week 3:  Phase 3, items 3.1–3.4 — programmatic SEO. Genre×Year, Decade, Similar Artists.
         These take weeks to index but compound forever.

Week 4:  Phase 4 — YouTube ecosystem. The pipeline takes a few days to build,
         then it's a traffic engine on autopilot.

Week 5+: Phase 5 → Phase 6 → Phase 7 → Phase 8 in parallel.
         Pick the highest-impact remaining items each sprint.
```

---

## Quick Reference — Effort / Impact Matrix

| Impact →<br>Effort ↓ | ⭐⭐⭐⭐⭐<br>Game-changer | ⭐⭐⭐⭐<br>Major | ⭐⭐⭐<br>Solid | ⭐⭐<br>Marginal |
|---|---|---|---|---|
| **1–2h** | — | 2.1 Reddit multi-sub | 1.3 Artist schema<br>1.4 Breadcrumbs<br>2.4 Twitter<br>3.2 Decade pages<br>3.6 Country pages<br>5.5 Telegram | 1.5 Sitelinks<br>1.6 Bing<br>1.7 Video RSS<br>1.8 Magazine RSS<br>2.5 FB page<br>5.7 WhatsApp<br>7.2 robots.txt |
| **3–4h** | 1.1 Video schema<br>3.1 Genre×Year<br>4.2 YouTube Shorts | 1.9 OG images<br>2.3 Pinterest<br>3.3 Genre pages<br>3.4 Similar artists<br>5.3 Newsletter<br>6.1 Artist outreach<br>6.2 Broken links<br>6.3 Backlink replication | 2.2 Reddit engagement<br>2.8 YouTube Shorts<br>3.7 Comparison pages<br>3.8 Album pages<br>5.1 Medium<br>5.2 Quora<br>6.5 Wikipedia<br>7.1 Core Web Vitals | 2.6 Instagram<br>5.4 Web push<br>7.3 Canonical audit |
| **5+h** | — | 2.7 TikTok | 3.5 Mood pages<br>5.6 Discord bot | — |

---

## Notes

- **Schema.org (1.1–1.5) is the single highest-leverage block.** Do it first.
- **Everything after Phase 1 can be parallelized** — sub-agents can build multiple scripts simultaneously.
- **The YouTube Shorts pipeline (4.2) is the highest-effort, highest-reward item.** Once built, it generates traffic daily with zero marginal cost.
- **UTM tagging (8.1) should be added to every auto-post script from day one**, even if the dashboard comes later. You can't optimise what you don't measure.
- **This roadmap is a living document.** After each phase, review what's working and reprioritise. If Pinterest sends 10× more traffic than Reddit, shift resources there.
