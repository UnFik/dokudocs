# PRD NATA Project: Peningkatan Issue, Search, dan Konsolidasi Repository

## 1\. Latar Belakang

NATA Project berkembang cepat dan beberapa hambatan operasional mulai terasa:

1. Repository terpecah menjadi 10 repo terpisah, menyulitkan maintain dan onboarding developer baru.  
2. Kategorisasi issue belum granular. Hanya satu level kategori, padahal kebutuhan pelaporan membutuhkan klasifikasi lebih detail.  
3. Pencarian sprint sering tidak menemukan sprint (bug terverifikasi di code), dan roadmap sama sekali belum bisa dicari.  
4. Perubahan pada issue tidak tercatat dalam timeline, sehingga user sulit memahami riwayat sebuah issue.  
5. Export issue belum menyertakan data historis perubahan.

PRD ini menggabungkan kelima inisiatif tersebut dalam satu dokumen agar dapat direncanakan, dijadwalkan, dan dieksekusi secara koheren.

## 2\. Tujuan & Acceptance Criteria

| Tujuan | Acceptance Criteria |
| ----- | ----- |
| Mempermudah maintainability kode | 1 repository, semua service tetap bisa dibuild/test dari satu clone |
| Klasifikasi issue lebih detail | Sub-category dapat dipakai opsional tanpa merusak data lama |
| Pencarian yang bisa diandalkan | Sprint ditemukan by nama/label/kode; roadmap ditemukan by nama; dua search independen |
| Transparansi riwayat issue | Setiap edit field tampil di timeline dengan aktor \+ waktu \+ diff |
| Pelaporan/audit via export | Kolom "Riwayat Perubahan" tersedia di Excel/CSV |

## 3\. Non-Goals (Out of Scope)

* Menggabungkan database, deployment, atau runtime service. Monorepo hanya konsolidasi repository.  
* Menjadikan sub-category wajib — category-only tetap valid selamanya.  
* Backfill riwayat edit yang terjadi sebelum fitur \#4 rilis (data lama tidak pernah disimpan; secara teknis mustahil).  
* Full-text search (trigram/tsvector) — skala data per project masih kecil, ILIKE memadai.  
* Perbaikan technical debt umum (trust boundary, outbox, CI) — dicatat sebagai lampiran backlog terpisah, bukan bagian scope PRD ini.

## 4\. Changes

### F1. Konsolidasi Menjadi 3 Repository (Backend, Frontend, EDI/AI)

**Prioritas:** paralel (tidak blocking fitur lain) · **Effort:** 1–2 sprint

**Deskripsi.** Menggabungkan 10 repository menjadi **3 repository berdasarkan domain** — Backend, Frontend, dan EDI/AI. Di dalam tiap repo, service tetap terpisah: masing-masing punya module, database, image Docker, dan proses deploy sendiri. Yang menyatukan mereka hanya **docker compose** sebagai orkestrasi konsolidasi untuk menjalankan seluruh service dalam repo tersebut secara lokal, tanpa mengubah arsitektur runtime.

**Pembagian 3 repo:**

| Repo | Isi | Alasan domain |
| ----- | ----- | ----- |
| **Backend** | `proto`, `gateway`, `auth-service`, `master-service`, `transaction-service`, `report-service`, `notification-service`, `infra` | Satu kelompok Go \+ kontrak gRPC \+ shared infra; frontend & AI adalah konsumennya |
| **Frontend** | `web-frontend` | Stack berbeda (React/TS/Bun); siklus rilis mandiri |
| **EDI/AI** | `engine` (Rust), `edi-master`, `edi-orchestrator`, compose EDI | Sub-platform AI yang sudah punya compose \+ database sendiri |

**Struktur target per repo (contoh Backend):**

| nata-project-backend/ ├── proto/                     \# source of truth kontrak gRPC \+ buf.gen ├── services/ │   ├── auth/  master/  transaction/  report/  notification/ │   └── gateway/ ├── infra/                     \# NATS, Redis, RustFS, observability ├── compose.yml                \# konsolidasi: jalankan semua service backend \+ infra └── .github/workflows/ |
| :---- |

Repo Frontend berisi aplikasi \+ Dockerfile \+ compose (proxy ke gateway). Repo EDI/AI mempertahankan `compose.yml` yang sudah ada (qdrant, engine grpc/consume, edi-master \+ postgres, edi-orchestrator \+ postgres, seeder).

**Persyaratan:**

1. History git tiap repo lama dipertahankan (migrasi via `git subtree` atau `git filter-repo`).  
2. Setiap service mempertahankan module sendiri (Go module per service, Cargo untuk engine); module TIDAK digabung.  
3. Tag rilis per service dipertahankan dengan konvensi `service/vX.Y.Z`.  
4. Path output codegen proto (`buf.gen.*.yaml`) diperbarui ke struktur folder baru dalam repo Backend.  
5. Docker compose konsolidasi: satu perintah menjalankan seluruh service dalam repo (infra \+ service), dengan env mengarah ke `host.docker.internal` atau jaringan compose — perilaku runtime tidak berubah.  
6. CI berjalan per-path: hanya service yang berubah yang dibuild/ditest.  
7. Repo saling konsumen tetap berkomunikasi lewat endpoint yang sudah ada (frontend → gateway REST; EDI → gateway \+ NATS) — tidak ada import lintas repo.

**Acceptance Criteria:**

* 3 repo: Backend, Frontend, EDI/AI — masing-masing bisa di-clone dan dijalankan sendiri-sendiri via compose.  
* Codegen proto berjalan 1 perintah dari repo Backend; hasil generate tepat ke service yang tepat.  
* Semua test Go/Rust/frontend lulus di path baru.  
* CI memicu build hanya untuk path yang berubah (per service dalam repo).  
* Repo lama diarsipkan (read-only) dan remote developer diperbarui.  
* Developer baru cukup memahami 3 repo (bukan 10\) untuk mulai berkontribusi.

### F3. Pencarian Sprint dan Roadmap yang Terpisah

**Prioritas:** 1

**Deskripsi.** Memperbaiki bug pencarian sprint dan menambahkan pencarian roadmap yang berdiri sendiri. Keduanya memiliki state pencarian terpisah.

**Bug akar (terverifikasi):** query `ListSprints` hanya mencocokkan `sprint_code` dan `story` — nama sprint yang tampil ke user (`main_feature`) dan `sprint_label` tidak ikut dicocokkan, sehingga pencarian by nama tidak pernah kena.

**Persyaratan:**

1. Search sprint mencocokkan: `main_feature`, `sprint_label`, `sprint_code` (story opsional tetap disertakan). Case-insensitive.  
2. Search roadmap baru: parameter `search` pada `GET /projects/{id}/roadmap`, mencocokkan nama roadmap (`main_features`) dan berlaku juga untuk project operasional ("Scope Pekerjaan").  
3. State terpisah: URL param `?sprint-search` dan `?roadmap-search`, saling menimpa tidak satu sama lain; keduanya shareable via URL.  
4. Wildcard `%`/`_` pada input di-escape.  
5. Search string kosong \= perilaku lama (tampilkan semua).  
6. Search \+ pagination cursor tetap benar di kedua list.

**Acceptance Criteria:**

* Mengetik nama sprint pada halaman Sprint menemukan sprint tersebut (sekarang tidak).  
* Mengetik nama roadmap pada tab Roadmap memfilter baris roadmap; kosongkan \= semua tampil kembali.  
* Kedua pencarian independen dan tersimpan di URL masing-masing.  
* Filter existing (status, sprint\_state, main\_feature) tetap bekerja dikombinasikan dengan search.

### F4. Riwayat Edit Issue pada Timeline

**Prioritas:** 2

**Deskripsi.** Setiap pengubahan detail issue (judul, deskripsi, priority, severity, category, owner) tercatat otomatis di timeline issue — berupa siapa yang mengubah, kapan, dan apa yang berubah dari nilai lama ke baru — sehingga user memahami riwayat issue secara jelas.

**Persyaratan:**

1. Setiap edit yang mengubah ≥1 field menghasilkan satu entri timeline: aktor, waktu (WIB), dan daftar perubahan per-field (nilai lama → baru).  
2. Edit tanpa perubahan efektif (no-op) tidak menghasilkan entri.  
3. Deskripsi panjang ditampilkan sebagai "(diubah)" tanpa menaruh body 50 ribu karakter ke timeline.  
4. Event ditulis dalam transaksi database yang sama dengan update-nya (rollback \= ikut batal).

### F5. Export Issue dengan Riwayat Perubahan

**Prioritas:** 3 (satu PR bersama F4)

**Persyaratan:**

1. Kolom opt-in baru **"Riwayat Perubahan"** (key `history`), unchecked secara default, ikut dalam "Pilih semua", tersedia untuk format XLSX dan CSV.  
2. Satu sel per issue; setiap entri berformat `[YYYY-MM-DD HH:mm] Nama Aktor: jenis_perubahan (dari → to)`; entri digabung dengan baris baru (Excel wrap otomatis; CSV tetap valid sesuai RFC 4180).  
3. Guard formula CSV: sel yang berawalan `= + - @` dinetralkan agar aman dibuka di Excel.

**Dependensi:** kolom otomatis mengikuti isi timeline, sebelum F4 rilis kolom hanya berisi event yang sudah terekam (status/eskalasi/arsip/owner); setelah F4 rilis isinya menjadi lengkap. Keduanya bisa dikembangkan paralel.
