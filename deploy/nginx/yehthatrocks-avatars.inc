# User-uploaded avatars stored on the host volume (persists across deploys).
# Served directly by nginx — no proxy to Next.js needed.
location /avatars/ {
    alias /srv/yehthatrocks-data/avatars/;
    expires 1h;
    add_header Cache-Control "public, max-age=3600";
    add_header X-Content-Type-Options "nosniff";
}
