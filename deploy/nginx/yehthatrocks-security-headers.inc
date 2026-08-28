# Security headers — audit remediation 2026-08-23.
# Safe, non-breaking headers enforced at the edge; CSP is REPORT-ONLY so it
# cannot break the YouTube player or Next.js hydration. Flip to enforce later
# by renaming Content-Security-Policy-Report-Only -> Content-Security-Policy.
# X-Frame-Options is intentionally absent here: the app sets it per-route
# (DENY everywhere except /embed, which must remain frameable).

add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com https://img.youtube.com https://media.licdn.com https://*.gravatar.com https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'" always;
