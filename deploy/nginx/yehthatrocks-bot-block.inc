# Block AI crawlers and hostile scanner botnets from ALL routes
# (pages, API, static) — they consume CPU without bringing users.
# Included at server level, covering every route (pages + API + static).
#
# Per-IP rate limiting doesn't work against bots with large IP pools.
#
# 2026-08-28: added libredtail / l9explore / l9tcpid / crusader-worker /
# r00ts3c — internet-wide vulnerability-scanner botnet UAs observed probing
# .git/config, .env, phpunit eval-stdin and cloud-credential endpoints.
if ($http_user_agent ~* "(GPTBot|Applebot|Amazonbot|MJ12bot|Bytespider|ClaudeBot|CCBot|PerplexityBot|FacebookBot|meta-externalagent|anthropic|Lightpanda|DataForSeoBot|PetalBot|GoogleOther|SemrushBot|SERankingBacklinksBot|libredtail|l9explore|l9tcpid|crusader-worker|r00ts3c)") {
    return 403;
}

# Block the spoofed-browser scraper fleet. The fleet rotates obsolete browser
# version tokens and has repeatedly moved its spoof range to dodge this block
# (Chrome 100-121 -> 99/123/124 -> 131/133/136). Chrome/Firefox < 140 are
# 1.5+ years old (Chrome 140 = Feb 2025) — the residential-proxy catalog
# walker uses exactly this range, while real users are on Chrome 145+.
#
# Legitimate social/search crawlers that still embed old version tokens
# (Facebook's crawler fetches with Chrome/74 and /139 from its 2a03:2880::/32
# range) are explicitly exempt — blocking them would break link previews for
# organic shares.
set $spoofed_browser_bot 0;
if ($http_user_agent ~* "(Chrome|Firefox)/([0-9]{1,2}\.|1(0[0-9]|1[0-9]|2[0-9]|3[0-9])\.)") {
    set $spoofed_browser_bot 1;
}
if ($http_user_agent ~* "(meta-webindexer|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|Pinterest|TelegramBot|vkShare|redditbot|Googlebot|Google-InspectionTool|Bingbot|BingPreview|DuckDuckBot|YandexBot|Baiduspider|Applebot|Sogou|SeznamBot|MojeekBot)") {
    set $spoofed_browser_bot 0;
}
if ($remote_addr ~ "^(2a03:2880|2620:0:1cfe|69\.171\.|31\.13\.|66\.220\.|157\.240\.|179\.60\.|185\.60\.)") {
    set $spoofed_browser_bot 0;
}
if ($spoofed_browser_bot = 1) {
    return 403;
}
