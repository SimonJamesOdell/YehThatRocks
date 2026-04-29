# Admin Panel Security Checklist

**Status:** ✅ All admin endpoints are properly locked. Only `simonjamesodell@live.co.uk` can access.

---

## Pre-Production Verification

Before deploying to production, **MUST verify**:

### 1. ✅ Admin Access Control (CRITICAL)
- [ ] `ADMIN_EMAIL` or `ADMIN_USER_ID` is set in production `.env`
- [ ] Build produces warning if neither is set: inspect server logs
- [ ] Only intended admin email/user ID can access `/admin`
- [ ] Test: Try accessing `/admin` with non-admin account → should see "Admin access required"

**Recommended:** Use `ADMIN_USER_ID` instead of email (more secure, less guessable)

### 2. ✅ Admin API Protection (VERIFIED)
All admin endpoints require `requireAdminApiAuth()`:
- `GET/PATCH /api/admin/categories`
- `GET/PATCH/DELETE /api/admin/videos`
- `GET/PATCH /api/admin/artists`
- `GET /api/admin/dashboard`
- `GET/POST /api/admin/videos/ambiguous`
- `POST /api/admin/videos/import`
- `POST /api/artists/thumbnail` (admin-only)

**Test:** Use curl/Postman with non-admin auth token:
```bash
curl -X GET http://localhost:3000/api/admin/videos \
  -H "Cookie: ytr_access=<non-admin-token>"
# Should return 403 Forbidden
```

### 3. ✅ Admin-Enhanced Non-Admin Endpoints (VERIFIED)
Admins can bypass consensus on these endpoints:
- `POST /api/videos/flags` — Admin flags apply immediately
- `POST /api/search-flags` — Admin flags apply immediately
- `POST /api/videos/unavailable` — Admin can hide videos globally

**Note:** These are NOT admin-only; they're login-only, but admins get special privileges.

### 4. ⚠️ Recommended: Add Admin Action Audit Log
Currently, the system logs auth events but NOT admin-specific actions.

**TODO:** Create `admin_actions_audit_log` table to track:
- Admin ID
- Action (e.g., "video_deleted", "artist_updated", "ambiguous_resolved")
- Resource ID
- Changes made
- Timestamp

### 5. ⚠️ Recommended: Add Multi-Factor Auth for Admin
Consider requiring 2FA for admin accounts to protect against account compromise.

---

## Deployment Steps

1. **Set environment variable in production:**
   ```bash
   # Option A: Email-based
   export ADMIN_EMAIL=simonjamesodell@live.co.uk

   # Option B: User ID-based (recommended)
   export ADMIN_USER_ID=1
   ```

2. **Restart the app** — security warning disappears from logs

3. **Verify admin access:**
   - [ ] Login as admin user
   - [ ] Access `/admin` → should load dashboard
   - [ ] Login as non-admin user
   - [ ] Access `/admin` → should see "Admin access required"

4. **Test API protection:**
   - [ ] Call `/api/admin/videos` with non-admin token → expect 403
   - [ ] Call `/api/admin/videos` with admin token → expect 200

5. **Review audit logs:**
   - [ ] Check `auth_audit_logs` table for any suspicious activity
   - [ ] Ensure no brute-force attacks detected

---

## Security Architecture Summary

| Layer | Protection |
|-------|-----------|
| **Page / Route** | Server-side `requireAdminUser()` — must be logged in AND admin |
| **API Endpoint** | Server-side `requireAdminApiAuth()` — validates JWT + checks email/ID in database |
| **Mutations** | CSRF token check + Zod validation |
| **Logging** | All auth failures recorded to `auth_audit_logs` |

**Key Security Properties:**
✅ Email comparison is case-insensitive and trimmed  
✅ JWT verified against database (second check prevents token replays)  
✅ All mutations require CSRF token (prevents cross-site attacks)  
✅ Rate limiting: auth failures are rate-limited; admin endpoints are not DOS-proof

---

## Known Limitations

1. **No multi-factor auth** — Compromise of admin password = full admin access
2. **No admin action audit trail** — Can't investigate what the admin did
3. **No rate limiting on admin endpoints** — Admin could DoS system
4. **Email-based admin identity** — If GitHub repo is public, attacker knows target email

**Recommended fixes:** See section 4 & 5 above.

---

## Files Modified

- [lib/admin-auth.ts](apps/web/lib/admin-auth.ts) — Added production warning
- [.env.example](.env.example) — Added ADMIN_EMAIL and ADMIN_USER_ID
- [SECURITY_AUDIT_ADMIN.md](SECURITY_AUDIT_ADMIN.md) — Full audit report

---

**Last Updated:** April 14, 2026
