# Audit: Kolaborasi Markdown (Yjs + AST) — Production Readiness

Tanggal: 2026-10-01
Metode: pembacaan kode + probe E2E multi-klien di `http://localhost:5173` (akun seed `admin@example.com`), backend `:8080`.

## Verdict

**Belum production ready.** Dari 4 ekspektasi, 1 terpenuhi penuh, 1 sebagian, 2 tidak.

| Ekspektasi | Status | Bukti |
|---|---|---|
| Seamless untuk 1 atau banyak user (edit konkurrent) | ✅ Lolos | Dua klien mengetik bersamaan di dua paragraf. Keduanya konvergen ke `first BBB / second AAA`, tanpa teks hilang. |
| Icon user yang sedang membuka file | ❌ Tidak ada | Server WS hanya punya pesan `auth/update/ack/ping/pong/ready/resync`. Tidak ada presence/awareness di backend maupun frontend (0 elemen avatar di header). |
| Konflik ditangani otomatis tanpa review/export | ❌ Gagal | Lihat P0. |
| Offline edit ter-merge otomatis | ⚠️ Sebagian | Berfungsi hanya bila epoch tidak berubah dan tidak ada operasi struktural. Selain itu berakhir di export manual. |

## P0 — Epoch bump memaksa review/export manual

### Reproduksi (terverifikasi live)

1. Klien B offline (koneksi WS diputus), lalu mengetik `OFFLINE ` di paragraf 1.
2. Klien A menghapus paragraf 2 (tidak terkait edit B) via `POST /api/v1/documents/{id}/body/delete`.
3. B kembali online.

Hasil: status B menjadi `recovery-required`, editor B tidak lagi bisa diedit (selector `.ProseMirror[contenteditable=true]` hilang), banner "Local changes were not applied to the current document version" dengan tombol "Export local changes". Ini sama dengan flow review/export yang tidak diinginkan.

### Penyebab

- `backend/internal/infrastructure/repository/document/delete_node_writer.go:135` menaikkan `body_epoch + 1` di setiap DeleteNode. MoveNode (`move_node_writer.go`) dan accept suggestion (`suggestion_query.go:351`) melakukan hal serupa.
- `collaborative_writer.go` menolak update dengan epoch lama (`ErrStaleBodyEpoch`, kode WS `stale_epoch`).
- `frontend/src/features/docs/lib/collaboration-provider.ts` (sekitar baris 161, 358, 534, 664+) memanggil `requireRecovery('epoch-changed')` untuk setiap mismatch epoch.
- `frontend/src/features/docs/components/remote-markdown-doc-editor.tsx:474` menampilkan banner dan tombol export.
- `collaboration-recovery.ts` juga melempar `multiple structural commands need separate review` bila ada lebih dari satu command struktural pending.

Delete dan move blok adalah operasi sehari-hari, jadi user lain yang sedang mengetik atau offline akan sering jatuh ke recovery.

### Arah perbaikan

- Yjs sudah menangani delete dan move secara CRDT. Kirim sebagai update Yjs biasa dengan validasi server (`ValidateExistingStructure`, `ValidateOpaquePreservation`) disesuaikan, atau
- rebase otomatis update stale-epoch lewat CRDT merge di server alih-alih menolak.
- Batasi kenaikan epoch ke perubahan schema atau rebuild destruktif.
- Tambahkan E2E offline-plus-delete sebagai regresi.

## P1 — Presence tidak ada

Perlu:
- Pesan WS `presence` (join/leave/heartbeat) atau Yjs awareness, state in-memory per room.
- Fanout lintas instance lewat Redis broker yang sudah ada.
- UI avatar di `frontend/src/features/docs/components/editor-header.tsx`, opsional kursor remote.

## P1 — Skalabilitas dan keandalan

- **Rebuild penuh per update.** `yjs/merge.go` membangun ulang seluruh Y.Doc dari state tersimpan tiap update. `replaceDocumentBody` melakukan `DELETE` + `INSERT` seluruh node. Tiap ketikan adalah transaksi O(ukuran dokumen) dengan `FOR UPDATE`, sehingga banyak user antre. Komentar `ponytail:` di kode sudah mengakui ini.
- **Query berlebihan.** `fanoutLocal` membaca snapshot dan authz DB per peer per update. `watch` poll tiap 5 detik per peer. Tidak skala ke banyak peer.
- **Tidak ada batching/debounce** penulisan AST dan auto-revision di server.
- **Redis broker tanpa tes** (`collaboration/redisfanout`: no test files) dan tanpa replay event setelah reconnect.
- **Tidak ada rate limit** per koneksi WS.

## P2 — Temuan lain

- **Config E2E salah port.** `e2e/playwright.config.ts` hard-code `127.0.0.1:4173`, sedangkan `ALLOWED_ORIGIN=http://localhost:5173`. Origin check WS menolak koneksi, sehingga smoke `markdown-collaboration.spec.ts` gagal deterministik dengan status "Offline". Ini masalah environment test, bukan bug produk; di `:5173` WS tersambung dan status "Synced".
- **Celah tes.** Tes unit backend collaboration (`application/collaboration`, `websocket`, `yjs`) hijau, tetapi tidak ada tes skenario offline edit + operasi struktural dari klien lain.

## Urutan kerja yang disarankan

1. Hilangkan kebutuhan review pada delete dan move (P0), dengan E2E regresi.
2. Tambah presence (backend + header UI).
3. Optimasi hot path: cache Y.Doc per room, tulis AST debounced, hentikan polling DB per peer.
4. Perbaiki config E2E agar bisa menargetkan `:5173`, tambah tes Redis broker.

## Catatan metode

- Probe memakai dua browser context, masing-masing login sebagai admin seed, dokumen dibuat via API dengan `initialBody`.
- Pemutusan jaringan disimulasikan lewat `page.routeWebSocket` (menutup socket dan menolak reconnect). `context.setOffline` tidak memutus WS Chromium yang sudah terbuka, jadi tidak dipakai.
- Skrip probe bersifat sekali pakai dan sudah dihapus; tidak ada perubahan pada kode atau database.

## Status tindak lanjut

Diperbarui 2026-10-01 (setelah G6 dan ADR 0017). Keputusan: P0 lewat client-side rebase per `nodeID` ([ADR 0015](adr/0015-rebase-pending-edits-by-node-id.md)) dan re-issue command struktural ([ADR 0016](adr/0016-reissue-structural-commands-across-body-epoch.md)). Catatan teknis lengkap per langkah ada di bagian "Progress G6" `docs/plans/dokudocs-refactor-gap-closure.md`.

| Item | Status | Bukti |
|---|---|---|
| P0 auto-rebase edit teks dan insert lintas epoch | Selesai | Vitest rebase (8), Yjs (2), provider; Playwright `markdown-offline-rebase.spec.ts` |
| P0 `DeleteNode`/`MoveNode` pending lintas epoch | Selesai di tingkat provider | Vitest "structural command retarget" (7). E2E lewat UI `test.fixme`: gestur move/delete di editor tidak mengirim request di build saat ini (regresi editor sebelum G6) |
| P1 presence, satu instance | Selesai | Go `presence_test.go`, Vitest socket/provider/`presence-avatars`, Playwright `markdown-presence.spec.ts` |
| P1 presence lintas instance (Redis, TTL) | Selesai | Go dengan store palsu, integrasi Redis asli (store dan dua server) |
| P1 presence tidak merusak klien lama | Selesai | opt-in `capabilities`, klien mengabaikan frame tak dikenal |
| P1 write deadline frame `ready` | Selesai | Go `TestReadyFrameWriteToAClientThatNeverReadsIsAbandoned` |
| P1 tes broker Redis | Selesai, dengan satu bug diperbaiki | integrasi Redis asli (pembatalan context kini menutup stream) |
| P1 hot path: tulis diff node (A) | Selesai | commit 2.001 node p50 341 → 80 ms |
| P1 hot path: fan-out dan polling per ruangan (C) | Selesai | 5 SELECT tetap tanpa kunci baris; oracle terhadap `ReadBody` |
| P1 hot path: batching klien (D) | Selesai | Vitest provider |
| P1 hot path: debounce revisi (B) | Selesai | revisi bergulir ditulis paling banyak sekali per 10 detik (ADR 0017) |
| P1 hot path: cache body dan dokumen Yjs per dokumen, validasi diff-aware | Selesai | ADR 0017; cache dikunci revisi state dari trigger DB |
| **Gate G6 latensi: p95 ≤ 200 ms pada 10 editor, 2.000 node** | **Lulus di lingkungan lokal** | 5 dari 5 run: p95 66–115 ms, ±17,8 commit/s; belum diukur dengan latensi jaringan, Redis, dan WebSocket ujung ke ujung |
| P2 config E2E port | Selesai | `UI_BASE_URL` di `e2e/playwright.config.ts` |
| `markdown-collaboration.spec.ts` baris 316 dan gestur editor | Belum, bukan bagian pekerjaan ini | `wouldRemoveInlineRun` dan gestur struktural di editor tidak mengirim request; 12 file Vitest `muya/*` juga gagal sebelumnya |
| `tsc -b` bersih | Tidak, oleh pihak lain | error `canSuggest` di `remote-markdown-doc-editor.tsx` membuat `make test-e2e-with-backend` gagal di tahap build |
