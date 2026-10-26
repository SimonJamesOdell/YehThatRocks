# Block self-identified AI crawlers and hostile scanner botnets from ALL routes
# (pages, API, static) — they consume CPU without bringing users.
# Included at server level, covering every route (pages + API + static).
#
# Per-IP rate limiting doesn't work against bots with large IP pools.
#
# We deliberately do NOT block by browser version. Version strings are spoofed
# freely, and out-of-date browsers are still used by real people. The catalog
# walker is instead stopped by the version-independent JS proof-of-work
# challenge (see yehthatrocks-challenge.inc).
#
# 2026-08-28: added libredtail / l9explore / l9tcpid / crusader-worker /
# r00ts3c — internet-wide vulnerability-scanner botnet UAs observed probing
# .git/config, .env, phpunit eval-stdin and cloud-credential endpoints.
#
# 2026-10-26: switched the rejection status from 403 to 418 ("I'm a teapot").
# Functionally identical (both refuse the request), but it lets self-identified
# crawlers know the server has a sense of humour. The teapot is a message, not
# a rate limit — these UAs are refused outright on every route.
if ($http_user_agent ~* "(GPTBot|Applebot|Amazonbot|MJ12bot|Bytespider|ClaudeBot|CCBot|PerplexityBot|FacebookBot|meta-externalagent|anthropic|Lightpanda|DataForSeoBot|PetalBot|GoogleOther|SemrushBot|SERankingBacklinksBot|libredtail|l9explore|l9tcpid|crusader-worker|r00ts3c)") {
    return 418 "I'm a teapot";
}
