# Block hostile reconnaissance / exploit probes at the edge (444 = drop the
# connection, no response) so they never reach the app.
#
# Observed 2026-08-28: .git/config harvesting, .env exfiltration attempts,
# PHPUnit eval-stdin RCE, Spring actuator, Terraform state, GCP/AWS
# credential files, Consul/Nomad/Vault + WordPress fingerprinting.
#
# None of these paths exist in the YehThatRocks app (Next.js). No real
# visitor or legitimate crawler requests them. Keep patterns anchored and
# specific so future app routes are never shadowed.

# Top-level hostile paths / cloud-credential files
location ~* ^/(\.git|\.env|\.aws|\.config|\.ssh|wp-(json|content|login|admin)|wordpress|actuator|terraform\.tfstate|serviceAccountKey\.json|docker-compose\.ya?ml|config\.(json|php)|v1/(kv|models|catalog|agent)|v2/keys|rest/v1)(/|$|\.) {
    return 444;
}

# PHP framework directories probed for RCE (phpunit eval-stdin, etc.)
location ~* ^/(vendor|phpunit|yii|zend|laravel|lib)(/|$) {
    return 444;
}

# PHP files: this app serves no PHP. eval-stdin.php is the PHPUnit RCE
# vector; block any .php request.
location ~* (eval-stdin\.php|\.php($|\?)) {
    return 444;
}

# PHP code-injection attempts in query strings (allow_url_include etc.)
if ($args ~* "(allow_url_include|auto_prepend_file)") {
    return 444;
}

# AI-agent discovery probes (.well-known/mcp.json, ai-catalog.json,
# agent-card.json, acp.json, etc.) — these are the 2026 wave of autonomous
# agent scanners looking for tool endpoints. None of these exist here, so
# answer with the teapot instead of waking the app.
#
# Anchored to exact names so the Let's Encrypt ACME challenge
# (/.well-known/acme-challenge/...) is never shadowed.
location ~* ^/\.well-known/(ucp|skills|poppy\.json|openid-configuration|oauth-protected-resource|oauth-authorization-server|mcp\.json|mcp/|http-message-signatures-directory|api-catalog|ai-catalog\.json|agent-skills|agent-card\.json|acp\.json)(/|$) {
    return 418 "I'm a teapot";
}

# OpenAPI / versioned-API enumeration.
location = /openapi.json {
    return 418 "I'm a teapot";
}
location ~* ^/api/v1(/|$) {
    return 418 "I'm a teapot";
}

# Chinese OA/CMS upload-path probes (Seeyon/ecology-style scanners) observed
# hitting /Html/upload/file/...doc and /Files/UploadFiles/...jpg. Drop them.
location ~* ^/(Html/upload|Files/UploadFiles)(/|$) {
    return 444;
}
