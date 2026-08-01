# Cloud provider IP ranges blocked from accessing the site.
# yehthatrocks.com is intended for home/residential users only.
# These ranges are exclusively data-centre IPs — no residential users live here.
#
# Include this in the main server block:
#   include /etc/nginx/yehthatrocks-cloud-deny.inc;
#
# Keep ranges sorted by provider. Add new ranges as threat patterns emerge.

# ── Tencent Cloud ──────────────────────────────────────────────
# Confirmed bot attack source: 2026-07-22, 2026-08-01
deny 43.172.0.0/15;

# ── Alibaba Cloud ──────────────────────────────────────────────
# Major scraping source; same threat profile as Tencent
deny 47.74.0.0/15;
deny 47.76.0.0/14;
deny 47.80.0.0/12;
deny 47.88.0.0/15;
deny 47.90.0.0/15;
deny 47.91.0.0/16;
deny 8.208.0.0/12;
deny 39.96.0.0/12;
deny 101.132.0.0/16;

# ── DigitalOcean ───────────────────────────────────────────────
# Frequently used for scraping, bots, and VPN exit nodes
deny 138.68.0.0/16;
deny 139.59.0.0/16;
deny 159.65.0.0/16;
deny 159.89.0.0/16;
deny 159.203.0.0/16;
deny 165.227.0.0/16;
deny 167.71.0.0/16;
deny 167.99.0.0/16;
deny 178.62.0.0/16;
deny 188.166.0.0/16;
deny 206.189.0.0/16;
deny 207.154.0.0/16;

# ── Hetzner ────────────────────────────────────────────────────
# Cheap EU hosting; extremely common bot source
deny 5.9.0.0/16;
deny 78.46.0.0/16;
deny 88.198.0.0/16;
deny 136.243.0.0/16;
deny 144.76.0.0/16;
deny 148.251.0.0/16;
deny 159.69.0.0/16;
deny 176.9.0.0/16;

# ── OVH ────────────────────────────────────────────────────────
# Budget EU hosting; frequent bot and scraper source
deny 51.38.0.0/16;
deny 51.68.0.0/16;
deny 51.75.0.0/16;
deny 51.77.0.0/16;
deny 51.89.0.0/16;
deny 51.91.0.0/16;

# ── Vultr ──────────────────────────────────────────────────────
# Common for throwaway VPS instances used in scraping
deny 45.32.0.0/16;
deny 45.63.0.0/16;
deny 45.76.0.0/16;
deny 45.77.0.0/16;
deny 66.42.0.0/16;
deny 104.238.0.0/16;
deny 108.61.0.0/16;
deny 149.28.0.0/16;
deny 155.138.0.0/16;
deny 207.246.0.0/16;

# ── Linode ─────────────────────────────────────────────────────
deny 45.33.0.0/16;
deny 45.56.0.0/16;
deny 45.79.0.0/16;
deny 50.116.0.0/16;
deny 66.175.208.0/20;
deny 72.14.176.0/20;
deny 96.126.96.0/19;
deny 172.104.0.0/16;
deny 173.255.192.0/18;
deny 192.155.80.0/20;
deny 198.58.96.0/19;
