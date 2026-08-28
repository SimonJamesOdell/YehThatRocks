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
# (Chrome 100-121 -> 99/123/124 -> 131/133/136). Chrome/Firefox < 137 are
# 1.5+ years old; the walker uses exactly this range (131/133/136).
#
# NOTE: the cutoff stops at 136 deliberately — a real user was observed on
# Chrome/139 (arriving via a Facebook share), so 137+ must stay allowed.
set $spoofed_browser_bot 0;
if ($http_user_agent ~* "(Chrome|Firefox)/([0-9]{1,2}\.|1(0[0-9]|1[0-9]|2[0-9]|3[0-6])\.)") {
    set $spoofed_browser_bot 1;
}
# Legitimate social/search crawlers that embed old version tokens (Facebook's
# crawler uses Chrome/74) are exempt so their previews keep working.
if ($http_user_agent ~* "(meta-webindexer|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|Pinterest|TelegramBot|vkShare|redditbot|Googlebot|Google-InspectionTool|Bingbot|BingPreview|DuckDuckBot|YandexBot|Baiduspider|Applebot|Sogou|SeznamBot|MojeekBot)") {
    set $spoofed_browser_bot 0;
}
if ($remote_addr ~ "^(2a03:2880|2620:0:1cfe|69\.171\.|31\.13\.|66\.220\.|157\.240\.|179\.60\.|185\.60\.)") {
    set $spoofed_browser_bot 0;
}
if ($spoofed_browser_bot = 1) {
    return 403;
}
