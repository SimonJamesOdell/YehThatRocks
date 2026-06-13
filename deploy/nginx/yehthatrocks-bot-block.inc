# Block AI crawlers from page routes — they consume CPU without bringing users.
# Applied inside location / block: if ($http_user_agent ~* "...") { return 403; }
#
# This uses the same proven pattern as the existing analytics/unavailable blocks.
# Per-IP rate limiting doesn't work against bots with large IP pools (22 unique IPs
# in 30 requests observed).

if ($http_user_agent ~* "(GPTBot|Applebot|Amazonbot|MJ12bot|Bytespider|ClaudeBot|CCBot|PerplexityBot|FacebookBot|meta-externalagent|anthropic)") {
    return 403;
}
