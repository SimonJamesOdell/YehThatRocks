# Bot / datacenter IP blocks — generated 2026-07-23
# Tencent Cloud (AS132203) — 94% of bot traffic
deny 43.172.0.0/15;
# Alibaba Cloud (AS45102) — additional bot traffic
deny 47.79.0.0/16;
# Tencent Cloud Singapore
deny 43.156.0.0/16;
# NOTE: 94.12.8.229 is the admin's residential IP — explicitly allowed
# All other deny rules below target datacenter/cloud ranges only
