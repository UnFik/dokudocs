# Rencana integrasi auth frontend dan backend

Status: draft untuk konfirmasi akhir. Q1–Q20 sudah diputuskan; Q21 tentang isolasi data lokal masih terbuka. Dokumen ini belum menjadi izin implementasi.

Riwayat: [auth-integration-interview.md](auth-integration-interview.md). Istilah domain: [CONTEXT.md](../../CONTEXT.md).

## Hasil yang dituju

Pengguna dapat register dan login dengan email/password atau Google, membuka halaman internal dengan identitas yang benar, bertahan login setelah reload sampai JWT kedaluwarsa, serta logout lokal. Web dan API memakai satu origin dari sisi browser. Integrasi data workspace/project/document ke backend belum termasuk.

## Keputusan yang disetujui

- Google satu-satunya provider OAuth. Tombol GitHub/Facebook diganti tombol dengan ikon Google pada halaman login dan registrasi.
- Env Google boleh kosong. Tombol tetap terlihat dan dapat diklik. Backend tetap bisa startup; klik ketika belum dikonfigurasi menghasilkan 503 `{ title: "Google login belum dikonfigurasi" }` tanpa meninggalkan halaman.
- Backend menangani redirect Google dan callback. JWT aplikasi tidak boleh masuk query string atau fragment URL.
- Callback mengirim kode sekali pakai berumur pendek yang terikat ke browser pemulai login. Frontend menukar kode untuk JWT melalui response body.
- Identitas Google dicocokkan menggunakan provider dan subject. Jika belum terhubung tetapi email sudah terdaftar, tolak auto-link dan arahkan pengguna memakai metode login sebelumnya. Linking setelah login ditunda.
- Google dengan email baru yang terverifikasi membuat User, default settings, role member, dan OAuthAccount dalam satu transaksi. Tidak membuat password lokal atau workspace otomatis. Nama berasal dari Google.
- JWT Bearer tetap menjadi autentikasi API aplikasi. Cookie HttpOnly sementara hanya untuk transaksi OAuth, bukan session auth aplikasi.
- Token aplikasi disimpan dalam cookie JS-readable sampai expiry JWT, default 24 jam. Gunakan Secure pada HTTPS dan SameSite=Lax. Tidak ada refresh token.
- `/auth/me` memulihkan CurrentUser sebelum halaman internal dibuka. 401 mengakhiri auth; network error dan 5xx memberi retry, bukan logout.
- Logout menghapus auth lokal dan cache identitas. Token yang sudah disalin tetap valid sampai expiry karena tidak ada revocation server.
- Envelope tetap `{ data: ... }` untuk sukses dan `{ title }` untuk error.
- Baca profil lewat `/api/v1/users/me/profile` untuk identitas UI. Tidak mengintegrasikan edit profil, settings, atau upload avatar. Fallback email/inisial, bukan identitas dummy.
- Register lokal: email valid, nama wajib 2–100 karakter, password minimal 15 karakter dan maksimal 72 byte UTF-8, tanpa aturan komposisi. Password tidak dipangkas. Login tidak menerapkan minimum password registrasi baru.
- Proteksi `/docs/$docId` seperti halaman internal lainnya. Hentikan akses dan simulasi sukses forgot-password/OTP. Public document sharing ditunda.
- Browser menggunakan web `/` dan API `/api`. Vite proxy untuk development, reverse proxy untuk production; proses frontend/backend tetap terpisah.

Q12 menggantikan Q11 tentang JWT di fragment. Q13 menggantikan Q10 tentang auto-link berdasarkan email. Persetujuan sebelumnya tidak berlaku untuk dua desain yang diganti tersebut.

## Kondisi kode saat diperiksa

| Area | Lokasi | Kondisi |
| --- | --- | --- |
| Auth API | `backend/internal/infrastructure/api/routes/auth_routes.go` | Login, register, me sudah ada; belum ada OAuth |
| JWT | `backend/internal/application/jwt/token.go` | HS256, subject User ID, expiry dan claims identitas |
| User creation | `backend/internal/application/auth/usecase/register_usecase.go` dan `backend/internal/infrastructure/repository/user/create_query.go` | Insert user/settings/role belum dibungkus transaksi oleh registrasi |
| OAuth identity | `backend/database/migrations/20260909000006_create_oauth_accounts_table.up.sql` | Tabel dan unique constraints sudah ada; password user boleh NULL |
| DB transaction | `backend/internal/infrastructure/database/database.go` | `WithTransaction` dan transaction-bound Queryer sudah tersedia |
| Frontend auth | `frontend/src/features/auth/api/auth-api.ts`, `hooks/use-auth.ts` | Login/register sudah memanggil backend |
| Token/guard | `frontend/src/stores/auth-store.ts`, `frontend/src/lib/auth-guard.ts` | Cookie default 7 hari, user tidak dipulihkan, guard hanya cek keberadaan token |
| Error handling | `frontend/src/lib/api-client.ts`, `frontend/src/main.tsx` | Penanganan 401 tersebar; perlu satu perilaku konsisten |
| Profile UI | `frontend/src/components/profile-dropdown.tsx`, `components/layout/app-sidebar.tsx`, `features/account/index.tsx` | Sebagian identitas dummy atau memakai accountNo sebagai nama |
| Editor | `frontend/src/routes/docs/$docId.tsx` | Di luar authenticated route group dan belum punya guard |
| Local data | `frontend/src/stores/dokudocs-store.ts` | localStorage bersama memuat dokumen, draft, revisi dan workspace |
| Proxy | `frontend/vite.config.ts`, `frontend/nginx.conf` | Belum memproxy API |
| Tests | `e2e/api/specs/auth/`, `e2e/ui/specs/auth.spec.ts` | API suite tersedia; UI auth masih memakai mock |

## Kontrak HTTP yang diusulkan

Semua path API di bawah berawalan `/api/v1`. Envelope dan bentuk AuthResponse yang ada dipakai ulang. AuthUser `id` wajib; jangan mempertahankan dua definisi frontend yang berbeda.

| Method/path | Input | Output |
| --- | --- | --- |
| `POST /auth/register` | `{ email, fullName, password }` | 201 `{ data: { accessToken, user } }` |
| `POST /auth/login` | `{ email, password }` | 200 AuthResponse |
| `GET /auth/me` | Bearer JWT | 200 `{ data: user }` |
| `GET /users/me/profile` | Bearer JWT | 200 `{ data: profile }` dengan bentuk existing |
| `POST /auth/google/start` | `{ redirect?: string }` | 200 `{ data: { authorizationUrl } }` dan cookie binding sementara; 503 jika belum tersedia |
| `GET /auth/google/callback` | Google `code`, `state`, atau error | Redirect tetap ke callback frontend dengan kode aplikasi atau error aman |
| `POST /auth/google/exchange` | `{ code }` dan cookie binding | 200 `{ data: { accessToken, user, redirect } }`; 400 untuk kode tidak valid/expired/terpakai/binding salah |

`POST start` adalah usulan penyesuaian dari contoh `GET start` pada interview. Frontend memanggilnya sebagai JSON fetch sebelum navigasi agar error konfigurasi tampil inline dan pembuatan transaksi bisa memeriksa Origin. Callback Google tetap GET.

Validasi menghasilkan 400, kredensial salah 401, konflik email 409, provider belum dikonfigurasi 503. Jangan bocorkan raw database error, client secret, token provider, atau detail response Google.

## Alur Google dan pengamanan

Rincian berikut adalah default teknis yang diajukan bersama draft, bukan keputusan produk baru yang sudah dikonfirmasi terpisah.

1. Tombol Google memanggil start melalui same-origin JSON request. Disable selama pending. Jangan mengirim password atau JWT aplikasi ke Google.
2. Backend memvalidasi Origin dan tujuan redirect internal. Buat state, nonce, PKCE S256, dan rahasia binding browser dengan random kriptografis. Simpan transaksi sementara di PostgreSQL yang sudah tersedia, bukan menambah Redis atau framework multi-provider.
3. Cookie binding bersifat host-only, HttpOnly, SameSite=Lax, Path mencakup start/callback/exchange, Secure di HTTPS. Usulan masa transaksi 10 menit. Start baru mengganti transaksi aktif browser; callback lama ditolak dengan opsi mulai ulang.
4. Google callback harus memiliki state dan binding yang cocok serta belum expired/terpakai. Klaim transaksi secara atomik sebelum pertukaran kode provider; jangan tahan transaksi DB selama request jaringan Google.
5. Backend menukar authorization code memakai PKCE verifier. Pakai library OAuth/OIDC terpelihara yang dipilih setelah memeriksa dokumentasi resmi, jangan menulis sendiri validasi signature/JWKS. Verifikasi signature, issuer, audience, expiry, nonce, subject, dan email terverifikasi. Scope hanya `openid email profile`; tidak meminta offline access atau menyimpan access/refresh token Google.
6. Cari `(google, sub)` dahulu. Identitas yang sudah terhubung masuk ke User yang sama, bukan dipindah berdasarkan email terbaru. Untuk identitas baru, konflik email tidak boleh menghasilkan linking otomatis.
7. Untuk User baru, insert User dengan password NULL, default settings, role member dan OAuthAccount secara atomik. Validasi panjang/keberadaan nama Google; response provider tidak valid gagal bersih tanpa membuat user parsial. Tidak menambahkan onboarding tersembunyi.
8. Buat kode aplikasi acak, simpan hash beserta User ID, binding dan expiry. Usulan lifetime 60 detik. Redirect ke origin yang dikonfigurasi, `/auth/callback?code=...`; tujuan akhir tetap disimpan server, bukan dipercayai ulang dari callback URL.
9. Frontend mengambil kode ke memori, membersihkan URL, lalu exchange satu kali lewat lifecycle route, bukan render effect. Disable preload/retry otomatis untuk operasi konsumsi kode. Exchange menghapus/mengonsumsi kode secara atomik; hanya satu request paralel dapat berhasil. Response hilang setelah sukses berarti pengguna perlu memulai login lagi, bukan membuka replay window.
10. Setelah exchange, hapus cookie binding dan data sementara, simpan auth frontend, pulihkan identitas dan redirect internal. Kegagalan/penolakan Google menampilkan pesan aman dengan tombol kembali login atau coba lagi. Jangan overwrite auth yang sudah ada ketika callback gagal.

Buat satu migration pair untuk state sementara dan exchange bila belum ada penyimpanan yang sesuai; beri constraint untuk state transaksi yang valid dan index expiry. Secret binding/state/exchange disimpan hashed jika tidak perlu dibaca kembali. PKCE verifier perlu dibaca saat callback, aksesnya dibatasi dan dibersihkan setelah selesai. Purge record expired secara terbatas saat start dan bersihkan transaksi selesai; tidak butuh worker baru untuk v1.

Gunakan `Cache-Control: no-store` untuk response auth/start/exchange/callback. Callback frontend minimal, tanpa analytics atau pemuatan resource eksternal sebelum URL dibersihkan, dengan `Referrer-Policy: no-referrer`. Logger backend saat ini hanya mencatat path, pertahankan itu; access log proxy juga jangan menyimpan query callback. POST start/exchange hanya menerima origin aplikasi dan JSON. Tambahkan proteksi abuse/rate limit terbatas pada endpoint auth publik; jangan mencatat email mentah, password, JWT, atau kode dalam log pengujian maupun produksi.

Redirect hanya boleh berupa path internal aplikasi yang dikenali. Tolak absolute URL, protocol-relative URL, backslash dan encoding yang dapat berubah menjadi external redirect. Halaman login/callback tidak boleh menjadi tujuan loop. Gunakan fallback `/` untuk nilai tidak valid.

## Pemulihan auth dan UI

- Reuse Zustand untuk kredensial dan TanStack Query untuk `/me` serta profil. Route guard menunggu validasi awal; permintaan paralel memakai satu fetch yang sama. Jangan fetch ulang pada setiap render.
- Guest guard tidak boleh menganggap string token berarti login valid. Token invalid/expired tidak boleh menjebak user di redirect loop.
- Cek expiry lokal untuk UX, tetapi keputusan autentikasi tetap dari backend. Login dengan password lama tetap berfungsi meskipun panjangnya di bawah minimum registrasi baru.
- Set token dan User secara atomik. Semua 401 request terautentikasi menggunakan alur reset yang sama. 401 login ditampilkan sebagai error form, bukan redirect loop. Response request lama tidak boleh menghapus atau mengisi kembali sesi pengguna yang baru login.
- Saat expiry/logout, hentikan akses internal dan invalidasi router; cancel/remove query identitas milik sesi lama. Jangan menulis token ke query keys, URL atau log. Tidak ada refresh otomatis.
- Pending `/me` menampilkan loading; network/5xx menampilkan retry tanpa merender halaman internal sebagai sudah valid. Kegagalan profil biasa memakai email/inisial; 401 profil tetap ditangani sebagai kegagalan auth.
- Baca profil untuk sidebar, dropdown dan tampilan akun yang disentuh. Jangan membiarkan tombol simpan profil/avatar mengklaim persistensi server; tandai belum tersedia atau nonaktifkan kontrol tersebut.
- Pakai satu komponen tombol Google dengan ikon resmi yang sesuai dan label aksesibel. Tidak menambah SDK auth browser atau library ikon hanya untuk satu tombol.
- Guard halaman internal termasuk editor standalone. `/sign-in-2` diarahkan ke login utama atau memakai perilaku auth yang sama. Direct URL forgot-password/OTP tidak boleh menjalankan simulasi sukses.
- Jangan mengiklankan link editor sebagai public sharing. Kontrol public-share mock dinonaktifkan/ditandai belum tersedia, tanpa mengubah kontrak public-document backend yang sudah ada.
- Request auth/profil memakai API client yang sudah ada dengan parsing schema Zod pada boundary. Batasi Bearer ke API origin sendiri; jangan menyisipkan token ke URL eksternal lewat helper umum. Tidak perlu rewrite seluruh Axios/fetch client yang tidak terkait.
- Tidak menambahkan direct `useEffect`; fetching lewat Query dan callback lewat router/event handlers.

## Keputusan terbuka Q21: data lokal saat berganti akun

Data dokumen bukan seluruhnya disposable mock. `dokudocs-workspace-storage` menyimpan edit pengguna; comments dan preferensi editor juga punya storage sendiri. Logout yang sekadar clear auth membuat akun lain pada browser yang sama dapat melihat data tersebut. Menghapus seluruh localStorage akan menghilangkan draft.

Usulan untuk dikonfirmasi:

- Pisahkan storage dokumen, komentar dan state terkait berdasarkan `User.id`, tanpa mengintegrasikan CRUD backend.
- Flush editor/autosave ke namespace pemilik lama sebelum berpindah. Cancel/ikat pekerjaan async agar hasil thumbnail atau cleanup lama tidak masuk ke akun baru. Tab lain harus mendeteksi pergantian token dan menghentikan sesi lama sebelum menulis.
- Pertahankan storage legacy tanpa pemilik apa adanya sebagai backup lokal. Jangan otomatis menampilkan atau mengatribusikannya ke akun pertama yang login. Pemulihan/import eksplisit dapat dikerjakan terpisah.
- Logout membersihkan auth dan server cache, tidak menghapus draft user. Login kembali dengan akun yang sama memulihkan data lokalnya.

Ini menambah isolasi data lokal ke scope Q16. Masih memerlukan persetujuan. Alternatif minimal adalah mempertahankan sandbox lokal bersama dengan peringatan jelas, tetapi itu bukan pemisahan data antar-akun dan tidak cocok untuk pemakaian multi-user dengan dokumen sensitif.

Namespace localStorage mencegah tercampurnya data dalam UI, bukan batas keamanan terhadap orang yang menguasai browser/DevTools. Isolasi server-side baru tersedia ketika integrasi dokumen backend dikerjakan.

## Env dan deployment

Usulan konfigurasi backend baru di `.env.example`, tanpa mengubah secret lokal:

```dotenv
PUBLIC_APP_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Callback Google diturunkan dari `PUBLIC_APP_URL` menjadi `/api/v1/auth/google/callback`. Hindari konfigurasi callback terpisah yang dapat berbeda dari public origin. Nilai origin harus URL origin yang valid tanpa userinfo/query/fragment; HTTPS wajib di produksi, HTTP hanya untuk development loopback.

Jika credential kosong atau baru terisi sebagian, provider tidak tersedia tetapi server tetap berjalan. Jangan log nilainya. Google Console baru diatur saat credential tersedia, menggunakan callback origin browser, bukan origin API internal.

Frontend memakai base URL relatif dan endpoint `/api/v1/...`. Vite dev/preview dan Nginx meneruskan `/api/` ke backend tanpa menghapus prefix. Target proxy merupakan konfigurasi internal untuk host vs Docker; jangan kirim secret melalui variabel `VITE_*`. CORS bukan pengganti validasi Origin transaksi OAuth.

Pastikan E2E menggunakan hostname konsisten. Suite saat ini memakai UI `127.0.0.1:4173` dan API `localhost:8080`; tes cookie OAuth harus melalui proxy UI yang sama, bukan pola cross-site tersebut. Produksi membutuhkan HTTPS dan routing reverse proxy yang benar, bukan sekadar dev CORS.

## Urutan implementasi dan titik verifikasi

Kerjakan per alur yang bisa diuji, bukan membuat seluruh layer lalu mengetes belakangan. Nama file baru boleh menyesuaikan konvensi folder saat implementasi.

| Tahap | Perubahan utama | Bukti selesai |
| --- | --- | --- |
| 1. Origin dan kontrak | `frontend/vite.config.ts`, `frontend/nginx.conf`, API client, env examples, config backend | API dapat diakses lewat origin web; startup tetap sukses tanpa credential Google |
| 2. Auth lokal | Usecase/presenter login-register, transaksi user defaults, validasi, token verification, store/guard frontend | Register/login/reload/expiry/401 berjalan dengan response asli backend |
| 3. Google backend | Auth routes/handlers/usecase, adapter Google, repository identity/transaksi sementara, migration | Start/callback/exchange aman, konflik email ditolak, transaksi rollback dan single-use terbukti |
| 4. UI auth/profil | Tombol Google, callback route, schema API, profile read, pending/error, protected editor, unsupported controls | Login Google/email memakai auth state yang sama; tidak ada identitas palsu atau simulasi recovery |
| 5. Isolasi lokal | Hanya setelah Q21 disetujui: storage namespaces, account-switch lifecycle | Draft tidak hilang dan tidak tampil untuk akun lain |
| 6. Integrasi akhir | Test suites existing, proxy/browser test, Swagger, panduan env dan smoke test | Acceptance matrix lulus; keterbatasan v1 tertulis |

Reuse database transaction helper, user repository dan JWT manager. Perubahan kontrak auth harus memeriksa semua pemanggil constructor di route auth/user/workspace/project/document dan mock test. Jangan membangun registry provider, factory tambahan atau revocation/session manager yang belum diperlukan.

Saat user creation disentuh, jangan menyalin kelemahan existing: bedakan lookup not-found dari DB failure, map unique race secara aman, pastikan role member tersedia, tangani accountNo collision tanpa overwrite, dan jangan menganggap tiga insert terpisah sudah atomic. Pertahankan akun yang sudah ada. JWT parser harus menolak claims wajib yang hilang atau malformed tanpa panic.

## Acceptance test yang diajukan

Boundary pengujian untuk persetujuan akhir: HTTP auth API dengan PostgreSQL nyata, perilaku browser dengan backend nyata melalui proxy, dan boundary Google yang diganti server provider lokal untuk tes deterministik. Reuse Go testing, Vitest browser dan Playwright yang sudah terpasang, tanpa framework baru. Stub Google hanya di pengujian; jangan membuat mode fake Google production.

| Skenario | Hasil yang wajib |
| --- | --- |
| Register valid lalu reload | User asli terpulihkan; profil benar; User/settings/role konsisten |
| Email invalid/duplikat, nama batas, password <15 karakter atau >72 byte | Error terkontrol; tidak ada record parsial; tidak ada 500 untuk validasi |
| Password Unicode dan spasi | Perhitungan karakter/byte konsisten FE/BE; password tidak dipangkas |
| Login akun lama dengan password pendek | Tetap dapat login; password salah mendapat 401 |
| Token kosong/expired/rusak/claims hilang | Halaman internal tidak terbuka; tidak panic dan tidak redirect loop |
| `/me` jaringan gagal atau 5xx | Token tetap tersimpan, retry tersedia, halaman internal belum dianggap valid |
| `/me` valid tetapi profil gagal 5xx | Email/inisial tampil; bukan dummy dan bukan logout |
| Logout/401/account switch dengan request lama berjalan | Identitas/cache lama tidak muncul kembali atau menghapus sesi baru |
| Google credential kosong/sebagian | Startup sukses; tombol tetap ada; error inline 503 tanpa navigasi |
| Google user baru dan user terhubung | User baru/defaults dibuat sekali; login ulang memakai User ID sama |
| Google email sama dengan akun lokal | Tidak auto-link dan tidak membuat user/credential baru |
| Google subject sama, email berubah | Tidak berpindah User atau menggabungkan akun berdasarkan email |
| Google denial, state/nonce/issuer/audience/signature/expiry tidak valid | Gagal aman; tidak menerbitkan JWT; pengguna bisa memulai ulang |
| Code tanpa binding atau binding browser lain | Exchange ditolak; tidak mengonsumsi kode sah atas nama browser lain |
| Replay dan dua exchange paralel | Maksimal satu sukses; expiry dan konsumsi ditegakkan DB |
| Callback/return URL eksternal atau malformed | Tidak ada open redirect atau kebocoran JWT |
| Database failure/race saat pembuatan akun | Rollback lengkap; retry login tidak menggandakan akun |
| Direct URL editor/recovery/OTP | Editor meminta login; recovery/OTP tidak mengklaim sukses |
| Logout lalu login user sama/berbeda | Setelah Q21: draft user sama tetap ada, draft user lain tidak terlihat, legacy backup utuh |
| Browser OAuth via proxy | Cookie HttpOnly/Path/SameSite bekerja; JWT hanya muncul di body exchange; callback URL dibersihkan |

Tes browser otomatis tidak memerlukan akun Google sungguhan. Setelah env diisi, lakukan smoke test Google nyata untuk consent/callback, login kedua dan kasus benturan email. Selama credential kosong, nyatakan Google belum diverifikasi end-to-end terhadap provider nyata, bukan mengklaim selesai produksi.

Perintah verifikasi saat implementasi, bukan hasil yang sudah dijalankan:

```bash
make test-backend
(cd frontend && bun run test && bun run build && bun run lint)
# Backend, database test dan build frontend harus siap untuk suites berikut.
make test-e2e-api
make test-e2e-ui
```

Perbarui fixtures auth yang memakai password <15 karakter untuk registrasi baru, tetapi sisakan kasus login akun lama. Jangan menggunakan database pengguna sebagai target tes destruktif.

## Batas rilis v1

- JWT dalam cookie JS-readable tetap rentan terhadap XSS. HttpOnly untuk transaksi OAuth tidak menghilangkan risiko token aplikasi.
- Logout tidak mencabut JWT; refresh/revocation, device management, password recovery, email verification lokal, dan linking akun belum ada.
- `/auth/me` membaca claims token, bukan profil/role terbaru dari database. Perubahan role atau penghapusan akun tidak otomatis membatalkan seluruh token existing; admin lifecycle di luar scope ini.
- Dokumen/workspace/project masih lokal. Tidak mengklaim otorisasi atau sinkronisasi server untuk data tersebut.
- MCP belum diimplementasikan. Auth browser tidak menetapkan desain otorisasi remote MCP; standar OAuth/resource authorization untuk MCP perlu dirancang terpisah, bukan diasumsikan cukup dengan PAT.

## Konfirmasi berikutnya

1. Putuskan Q21 tentang isolasi dan preservasi draft lokal.
2. Konfirmasi draft, default teknis, dan boundary acceptance test di atas. Setelah itu simpan status rencana final. Implementasi hanya dimulai setelah pengguna memintanya.
