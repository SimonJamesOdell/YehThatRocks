# JS proof-of-work challenge for the catalog walker — a JS-less scraper that
# fetches /artist/*?letter=X&resume=1&v=<id> alphabetically with no cookies.
#
# Requests matching that signature WITHOUT the ytr_botok cookie are sent to a
# small proof-of-work page instead of the app. Real browsers solve it in well
# under a second and are never bothered again (the cookie lasts a week).
# Scrapers that never execute JavaScript never get the cookie and never get
# the page — regardless of which browser version they spoof.
#
# Skipped unconditionally:
#   - Known crawlers (they never carry the resume-walk signature).
#   - Signed-in users (ytr_access / ytr_refresh cookies) — they already passed
#     login, so they are not JS-less scrapers.
#
# Only the alphabetical-walk signature (letter=X) is challenged. Plain
# /artist/*?resume=1 navigations (search suggestions, autoplay redirects,
# video links) are real users and are never challenged.
set $walker_challenge "";
if ($http_user_agent ~* "(meta-webindexer|facebookexternalhit|Googlebot|Bingbot|DuckDuckBot)") {
    set $walker_challenge "SKIP";
}
if ($http_cookie ~ "(ytr_access=|ytr_refresh=)") {
    set $walker_challenge "SKIP";
}
if ($http_cookie !~ "ytr_botok=") {
    set $walker_challenge "${walker_challenge}A";
}
if ($request_uri ~ "^/artist/") {
    set $walker_challenge "${walker_challenge}B";
}
if ($args ~ "letter=") {
    set $walker_challenge "${walker_challenge}C";
}
if ($args ~ "resume=1") {
    set $walker_challenge "${walker_challenge}D";
}
if ($walker_challenge = "ABCD") {
    return 302 /__botchallenge;
}

location = /__botchallenge {
    root /srv/yehthatrocks/deploy/nginx;
    try_files /bot-challenge.html =404;
    add_header Cache-Control "no-store, no-cache, must-revalidate";
    add_header X-Robots-Tag "noindex, nofollow";
}
