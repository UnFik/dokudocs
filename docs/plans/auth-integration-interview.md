# Grill Me Results

Generated: 2026-09-10T03:42:42.069Z

## Plan

(state was created by grill_record_turn; no plan recorded)

## Shared Understanding

Planning only; no implementation authorized. Q12–Q15 accepted. Security refinements supersede earlier Q10 auto-link and Q11 URL-fragment JWT recommendations. Remaining scope, validation, deployment topology, and Google onboarding decisions must be confirmed before final implementation plan.

## Questions and Answers

### 1. Q8 - Google OAuth flow: Backend handle full redirect flow, atau frontend ambil Google credential lalu kirim ke backend?

**Recommended answer:** Backend full redirect flow melalui /api/v1/auth/google/start dan /api/v1/auth/google/callback, lalu redirect ke frontend.

**User answer:** Semua ikuti rekomendasi kecuali Q9: backend full redirect flow disetujui.

**Status:** resolved

**Notes:** Details of safe token delivery require refinement; OAuth transaction state and redirect validation must be included.

### 2. Q9 - Kalau env Google kosong: Apa perilakunya?

**Recommended answer:** Backend menolak OAuth yang belum dikonfigurasi; frontend menyembunyikan tombol Google.

**User answer:** Tidak mengikuti rekomendasi menyembunyikan tombol: tombol Google tetap ditampilkan meskipun env kosong.

**Status:** resolved

**Notes:** Blank env must not prevent server startup. Backend still rejects unconfigured OAuth; recommend a clear UI error when button is clicked. Exact HTTP status to settle in plan.

### 3. Q10 - User matching: Kalau Google email sama dengan existing email/password User, link ke User itu atau tolak?

**Recommended answer:** Link ke existing User by verified email; tolak jika email Google tidak verified.

**User answer:** Ikuti rekomendasi Q10: link berdasarkan verified email.

**Status:** resolved

**Notes:** Must inspect local email verification before accepting auto-link as safe; propose explicit proof of existing account if local emails are unverified.

### 4. Q11 - Frontend callback token: Setelah Google callback, token lewat mana?

**Recommended answer:** Redirect ke /auth/callback#accessToken=... lalu simpan token dan hapus fragment; jangan query string.

**User answer:** Ikuti rekomendasi Q11: access token via fragment.

**Status:** resolved

**Notes:** Prior recommendation needs security correction: fragment remains script/browser-history exposed. Recommend short-lived one-time code exchange instead; seek user approval before replacing this decision.

### 5. Q12 — Pengiriman token setelah Google login: ganti JWT di fragment dengan kode sekali pakai berumur pendek, terikat ke browser pemulai login, ditukar menjadi JWT lewat response body?

**Recommended answer:** Ya, gunakan kode sekali pakai terikat browser; JWT tidak dimasukkan URL dan URL callback dibersihkan.

**User answer:** Q12–Q15 setuju.

**Status:** resolved

**Notes:** Supersedes Q11. Need specify browser binding, expiry, atomic consumption, state/PKCE, no-store responses and redirect allowlist in plan.

### 6. Q13 — Email Google sama dengan akun lokal: jangan auto-link jika identitas Google belum terhubung; minta login dengan metode sebelumnya, fitur linking setelah login ditunda?

**Recommended answer:** Setuju; hindari auto-link karena email registrasi lokal belum diverifikasi. Email Google baru boleh membuat User.

**User answer:** Q12–Q15 setuju.

**Status:** resolved

**Notes:** Supersedes Q10. Match established OAuthAccount by provider subject first, not email. Require verified Google email for new user.

### 7. Q14 — Tombol Google saat env kosong: tetap terlihat/dapat diklik, backend mengembalikan 503 { title: "Google login belum dikonfigurasi" }, frontend menampilkan pesan tanpa meninggalkan halaman login?

**Recommended answer:** Setuju; server tetap berjalan dengan env Google kosong.

**User answer:** Q12–Q15 setuju.

**Status:** resolved

**Notes:** Use start endpoint via fetch that returns authorization URL only when configured; prevents navigating to raw JSON error page.

### 8. Q15 — Persistensi login dan kedaluwarsa: cookie JS-readable bertahan sampai expiry JWT (default 24h), Secure pada HTTPS dan SameSite=Lax, login ulang tanpa refresh token?

**Recommended answer:** Setuju. /me 401 membersihkan auth; jaringan/5xx menampilkan retry tanpa logout.

**User answer:** Q12–Q15 setuju.

**Status:** resolved

**Notes:** Persistent Bearer credential remains exposed to same-origin XSS. Logout local only cannot revoke tokens. No silent expiry extension.

## Agreed Decisions

- Auth v1 includes email/password registration/login plus Google OAuth only; replace GitHub/Facebook buttons with Google button/icon.
- Google env may be empty and server still starts; button stays visible/clickable. Unconfigured start returns HTTP 503 with { title: "Google login belum dikonfigurasi" }; show error without leaving sign-in.
- Use JWT Bearer access tokens; future MCP authorization is out of current scope, not a reason to mandate the same browser credential storage.
- Restore CurrentUser using /api/v1/auth/me before protected access; 401 clears auth, network/5xx failures offer retry rather than logout.
- Local logout only, no backend logout or refresh tokens in v1; copied JWTs remain valid until expiry.
- Persist Bearer token in JS-readable cookie until JWT expiry (default 24 hours), Secure over HTTPS and SameSite=Lax; no automatic extension.
- Keep backend error envelope { title }.
- Glossary terms: User, CurrentUser, AccessToken, OAuthAccount.
- Backend-managed Google authorization redirect and callback flow.
- Q12 supersedes Q11: return a short-lived one-time exchange code bound to initiating browser; exchange for JWT via response body, clean callback URL; no JWT in URL.
- Q13 supersedes Q10: match established Google provider identity first; if unlinked Google identity has email already registered locally, do not auto-link; ask user to sign in via existing method. Authenticated linking is deferred. New verified Google email may create User.

## Open Risks

- Token in JS-readable cookie is exposed to same-origin XSS; explicitly accepted v1 trade-off.
- Cross-origin dev frontend:5173/backend:8080 has no credentials support or proxy; production origin arrangement unset. Need settle transaction binding topology.
- Frontend /docs/$docId is unguarded and local mock sharing uses same URL; backend has separate public share-token endpoint but no frontend public viewer.
- Forgot-password and OTP currently simulate success without backend support.
- Backend auth/me reads JWT claims, not fresh User data; profile name/avatar require /users/me/profile or contract changes.
- Frontend/backend registration rules diverge; backend bcrypt maximum is 72 bytes and overflow currently maps to 500.
- Need final Google new-user defaults, validation policy, scope boundaries and acceptance criteria.

## Next Decision Needed

Confirm non-auth UI boundary/protection, Google onboarding behavior, validation rules and origin topology; then draft final plan for user confirmation.
