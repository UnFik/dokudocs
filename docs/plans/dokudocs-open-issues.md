# Draf issue: gap terbuka G0–G6

Tanggal: 2026-10-01. Sumber: `dokudocs-refactor-gap-closure.md` (ringkasan status, bagian G6, dan catatan progres), `audit-markdown-collaboration-2026-10-01.md`, dan temuan sesi G6.

Status draf: belum dibuat di GitHub (repo `UnFik/dokudocs` belum punya issue). Label usulan: `gate:G0` … `gate:G6`, `priority:P0|P1|P2`, ditambah label bawaan (`bug`, `enhancement`, `documentation`). Judul memakai awalan gate.

Keterangan kolom **Verifikasi**: *terkonfirmasi* = saya cek atau buktikan di sesi ini; *dari dokumen* = diambil dari ringkasan status dan belum saya jalankan ulang, jadi periksa dulu sebelum dikerjakan.

## Ringkasan

| # | Gate | Judul | Prioritas | Label | Verifikasi |
|---|---|---|---|---|---|
| 1 | G6 | Pulihkan gestur struktural editor dan E2E command struktural | P0 | bug | terkonfirmasi |
| 2 | G6 | Ukur beban kolaborasi di lingkungan mirip produksi dan kunci SLO | P0 | enhancement | terkonfirmasi |
| 3 | G6 | Revisi otomatis bisa tertinggal 10 detik tanpa flush penutup | P1 | bug | terkonfirmasi |
| 4 | G6 | Satukan dua ringkasan status di dokumen gap-closure | P2 | documentation | terkonfirmasi |
| 5 | G6 | Tutup `PresenceStore` saat shutdown | P2 | bug | terkonfirmasi |
| 6 | G6 | Normalkan `sibling_order` saat init body | P2 | enhancement | terkonfirmasi |
| 7 | G6 | Tetapkan batas ukuran dokumen dan memori cache | P1 | enhancement | terkonfirmasi |
| 8 | G6 | Selidiki anomali bentuk `if err :=` pada toolchain Go 1.27.1 | P2 | bug | terkonfirmasi |
| 9 | G6 | Perbaiki 12 file Vitest `muya/*` dan `local-user-editor` yang gagal | P2 | bug | terkonfirmasi |
| 10 | G6 | Kursor dan seleksi remote | P2 | enhancement | di luar scope rencana |
| 11 | G1 | Latihan failover Redis dan PostgreSQL, tetapkan RPO/RTO | P0 | enhancement | dari dokumen |
| 12 | G1 | Sizing koneksi dan topologi HA | P0 | enhancement | dari dokumen |
| 13 | G1 | Bukti E2E revoke, kedaluwarsa token, dan logout dengan pending edit | P1 | enhancement | dari dokumen |
| 14 | G2 | Pindahkan consumer Markdown tersisa ke AST dan hapus fallback `documents.content` | P1 | enhancement | dari dokumen |
| 15 | G2 | Backfill penuh dan corpus round-trip AST↔Yjs | P1 | enhancement | dari dokumen |
| 16 | G3 | Alur eksplisit menerima, menolak, dan membersihkan konflik offline | P1 | enhancement | dari dokumen |
| 17 | G3 | Uji offline: storage eviction, restart browser, restart layanan | P1 | enhancement | dari dokumen |
| 18 | G3 | Review UI untuk command struktural yang tidak bisa di-re-issue | P1 | enhancement | terkonfirmasi |
| 19 | G3 | Rebase sebagian: terapkan bagian bersih, review hanya bagian bentrok | P2 | enhancement | terkonfirmasi |
| 20 | G4 | Usulan format dan struktur dari UI, overlay track changes, review konflik | P1 | enhancement | dari dokumen |
| 21 | G4 | Suggestion saat offline | P2 | enhancement | dari dokumen |
| 22 | G4 | Receipt durable untuk acceptance struktural | P1 | enhancement | dari dokumen |
| 23 | G5 | Evaluasi provider nyata dan kalibrasi ambang cosine 0,35 | P1 | enhancement | dari dokumen |
| 24 | G5 | Ukur pemulihan indeks ≤1 menit dan lengkapi matriks ACL/lifecycle | P1 | enhancement | dari dokumen |
| 25 | G5 | E2E browser→API untuk chatbot RAG | P2 | enhancement | dari dokumen |
| 26 | G0 | Inventaris dan rekonsiliasi data per environment sebelum cutover | P0 | enhancement | dari dokumen |

## G6

### 1. [G6] Pulihkan gestur struktural editor dan E2E command struktural
- **Gejala:** `Alt+ArrowUp/Down` (move) dan Backspace pada blok (delete) tidak mengirim request `body/move` atau `body/delete`, bahkan saat online. Diverifikasi dengan probe Playwright di dev server dan build produksi.
- **Dugaan area:** `frontend/src/features/docs/lib/prosemirror/createDocumentBodyEditor.ts` (diubah 2026-10-01 14:25, guard `wouldRemoveInlineRun`, tanpa tes atau ADR).
- **Dampak:** `markdown-collaboration.spec.ts` baris 316 merah; tiga tes struktural di `markdown-offline-rebase.spec.ts` merah; ADR 0016 (re-issue command) hanya terbukti di tingkat provider.
- **Selesai bila:** gestur mengantrekan command lagi, guard punya tes dan keputusan tertulis, dan keempat E2E hijau lewat `make test-e2e-with-backend`.

### 2. [G6] Ukur beban kolaborasi di lingkungan mirip produksi dan kunci SLO
- **Konteks:** gate latensi lulus hanya di PostgreSQL lokal pada tingkat repository (p95 66–115 ms, 10 editor, 2.001 node, ±17,8 commit/s).
- **Pekerjaan:** tes beban lewat WebSocket ujung ke ujung (termasuk fan-out ke 10 peer), dengan Redis, dan dengan latensi jaringan ke PostgreSQL.
- **Selesai bila:** angka p50/p95/p99 untuk ACK dan penerimaan peer tercatat, SLO ditetapkan di dokumen, dan `COMMIT_LOAD=1` punya padanan WebSocket di CI.

### 3. [G6] Revisi otomatis bisa tertinggal 10 detik tanpa flush penutup
- **Gejala:** commit kolaboratif menulis ulang revisi bergulir paling banyak sekali per 10 detik (ADR 0017). Jika user berhenti mengetik di dalam jendela itu, edit terakhir tidak masuk revisi sampai ada commit berikutnya, jadi riwayat dan restore bisa kehilangan hingga 10 detik terakhir.
- **Usulan:** flush revisi saat peer terakhir keluar ruangan dan saat poller ruangan mendeteksi dokumen idle.
- **Selesai bila:** tes integrasi membuktikan revisi sama dengan body terbaru setelah ruangan kosong.

### 4. [G6] Satukan dua ringkasan status di dokumen gap-closure
- Ringkasan di bagian atas ditulis pihak lain dan belum menyebut G6; "Status G6" di bagian G6 sudah terbarui. Satukan tanpa menimpa isi pihak lain.

### 5. [G6] Tutup `PresenceStore` saat shutdown
- `redisfanout.PresenceStore.Close` tidak dipanggil saat shutdown; koneksi Redis hanya ditutup oleh proses yang keluar. Hubungkan ke `shutdownCollaboration`.

### 6. [G6] Normalkan `sibling_order` saat init body
- Init body menyimpan `sibling_order` berbasis 1 sedangkan proyeksi Yjs berbasis 0, sehingga commit pertama setelah init menulis ulang semua baris sekali. Normalkan saat init atau saat backfill.

### 7. [G6] Tetapkan batas ukuran dokumen dan memori cache
- Dokumen 10.001 node: p50 commit 111 ms, p95 ±220 ms (di atas gate). Cache commit memegang state, dokumen Yjs ter-decode, dan body untuk 32 dokumen per instance, belum diukur memorinya.
- **Selesai bila:** ukuran maksimum yang didukung ditetapkan (dengan perilaku saat terlampaui), dan memori cache diukur untuk ukuran itu.

### 8. [G6] Selidiki anomali bentuk `if err :=` pada toolchain Go 1.27.1
- Di `servePeer`, `if err := ws.JSON.Send(...); err != nil { return }` membuat tes `TestReadyFrameWriteToAClientThatNeverReadsIsAbandoned` gagal deterministik, sedangkan `sendErr := ...; if sendErr != nil` lulus. Penyebab belum dipahami (bug kompiler atau bug laten). Reproduksi minimal dan laporkan bila bug toolchain.

### 9. [G6] Perbaiki 12 file Vitest `muya/*` dan `local-user-editor` yang gagal
- Gagal sejak sebelum G6 (28–30 tes). Tidak terkait kolaborasi, tetapi membuat sinyal CI berisik.

### 10. [G6] Kursor dan seleksi remote
- Di luar scope rencana asli ("dapat dinilai setelah sync stabil"). Presence avatar sudah ada; kursor belum. Butuh protokol awareness dan keputusan privasi.

## G1

### 11. [G1] Latihan failover Redis dan PostgreSQL, tetapkan RPO/RTO
- **Status 2026-10-02 (sebagian):** outage Redis dan PostgreSQL disimulasikan di repo dan lulus; angka dan celah di [catatan HA](../research/dokudocs-g1-ha-resilience.md). Failover terkelola, replikasi sinkron, dan restart orkestrator nyata belum diverifikasi.
- Terbuka menurut ringkasan: outage/failover Redis, failover PostgreSQL, restart orchestrator.
- **Selesai bila:** skenario dijalankan terhadap layanan terkelola atau padanannya, hasil dan RPO/RTO tertulis, dan klien terbukti pulih tanpa kehilangan edit yang sudah di-ACK.

### 12. [G1] Sizing koneksi dan topologi HA
- **Status 2026-10-02 (sebagian):** model sizing, pool DB dapat dikonfigurasi, dan usulan topologi ada di [catatan HA](../research/dokudocs-g1-ha-resilience.md). Target masih usulan sampai load test WebSocket (G6 butir 2).
- Angka editor per dokumen, koneksi per instance, latency, availability, dan topologi HA belum ditetapkan ("ditetapkan dari sizing dan load/failover sebelum rilis").

### 13. [G1] Bukti E2E revoke, kedaluwarsa token, dan logout dengan pending edit
- **Status 2026-10-02 (sebagian):** revoke dan token kedaluwarsa terbukti di tingkat provider; logout menyisakan pending di IndexedDB dan menyimpang dari ADR 0007 (lihat [catatan HA](../research/dokudocs-g1-ha-resilience.md)). E2E browser logout belum ada.
- Catatan lama menyebut alur ini belum terbukti; periksa dulu mana yang sudah tertutup oleh tes terbaru, lalu tutup sisanya (revoke saat edit berjalan, token kedaluwarsa saat offline, logout dengan pending).

## G2

### 14. [G2] Pindahkan consumer Markdown tersisa ke AST dan hapus fallback `documents.content`
- Gate G2 menuntut tidak ada hasil list/search/public yang membaca `documents.content` untuk Markdown ber-AST. Daftar consumer tersisa perlu diinventarisasi (komentar, riwayat, ekspor, dll.), lalu cutover.

### 15. [G2] Backfill penuh dan corpus round-trip AST↔Yjs
- Backfill seluruh dokumen (dev, demo, produksi), dengan laporan jumlah dan error sumber stale; fixture custom HTML inline diverifikasi di browser; corpus mencakup syntax tak didukung dan opaque setelah edit.

## G3

### 16. [G3] Alur eksplisit menerima, menolak, dan membersihkan konflik offline
- Sekarang konflik berakhir di ekspor. Gate G3 menuntut pengguna dapat membandingkan body lama dan baru dan menyalin bagian terpilih dengan hak edit terkini, lalu menerima, menolak, atau membersihkan konflik.

### 17. [G3] Uji offline: storage eviction, restart browser, restart layanan
- Terbuka menurut ringkasan: eviction IndexedDB, restart browser offline pada kondisi server berubah, restart/failover layanan.

### 18. [G3] Review UI untuk command struktural yang tidak bisa di-re-issue
- Setelah ADR 0016, `DeleteNode` yang blok-nya bertambah isi, atau `MoveNode` yang parent tujuannya hilang, tetap berakhir di status recovery tanpa UI review khusus. Tambahkan tampilan yang menjelaskan alasan dan pilihan (hapus tetap, batalkan).
- Juga: bukti browser→API→PostgreSQL untuk re-issue `DeleteNode` (tergantung #1).

### 19. [G3] Rebase sebagian: terapkan bagian bersih, review hanya bagian bentrok
- ADR 0015 bersifat semua-atau-tidak: satu konflik membuat seluruh pending masuk review. Terapkan node yang bersih dan tahan hanya yang bentrok.

## G4

### 20. [G4] Usulan format dan struktur dari UI, overlay track changes, review konflik
- Terbuka menurut catatan: proposal format, lintas run/blok, perubahan struktur dari UI, overlay inline track changes, dan review konflik.

### 21. [G4] Suggestion saat offline
- Gate G4 tidak mengizinkan proposer menulis body langsung; suggestion offline belum didukung.

### 22. [G4] Receipt durable untuk acceptance struktural
- Acceptance `move`/`delete` sudah atomik, tetapi belum memakai receipt durable seperti `MoveNode`/`DeleteNode`.

## G5

### 23. [G5] Evaluasi provider nyata dan kalibrasi ambang cosine 0,35
- Ambang 0,35 dan kualitas provider belum dikalibrasi; deteksi konflik antar-sumber belum dievaluasi dengan model nyata.

### 24. [G5] Ukur pemulihan indeks ≤1 menit dan lengkapi matriks ACL/lifecycle
- Target pemulihan ±1 menit belum diukur pada beban nyata. Urutan revoke, hard-delete, dan workspace-delete terhadap indeks dan chat history belum lengkap diuji.

### 25. [G5] E2E browser→API untuk chatbot RAG
- Belum ada E2E live untuk alur `/assistant` sampai jawaban dengan citation.

## G0

### 26. [G0] Inventaris dan rekonsiliasi data per environment sebelum cutover
- G0 selesai untuk scope dev/test. Inventaris consumer dan rekonsiliasi data (termasuk grant owner untuk dokumen yang belum punya, 34 dokumen di dev) per environment produksi tetap prasyarat cutover terpisah.
