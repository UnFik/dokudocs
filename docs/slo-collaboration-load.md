# SLO dan hasil uji beban kolaborasi (G6, issue #2)

Status: **hasil pengukuran LOKAL, bukan lingkungan mirip produksi.** Klien, server WebSocket, PostgreSQL 16 (tmpfs), dan Redis 7 berjalan di satu mesin 12 core yang juga dipakai pekerjaan lain (load average 20 saat sebagian run). Angka di bawah menunjukkan perilaku relatif dan titik patah, bukan kapasitas produksi. Load average mesin selama run 7 sampai 18 pada 12 core karena ada pekerjaan lain; tiap baris mencatat `loadAvgAtEnd` di JSON. Pengukuran di infrastruktur terkelola (jaringan nyata, Redis dan PostgreSQL terkelola, beberapa instance di mesin terpisah) belum dilakukan.

## Harness

- `backend/internal/infrastructure/repository/document/collaborative_websocket_load_integration_test.go`, `TestWebSocketCollaborationLoad` (tag `integration`).
- Alur yang diukur: klien Yjs asli, WebSocket, server Go, commit PostgreSQL, ACK ke penulis, dan fan-out ke semua socket lain.
- Metrik: waktu dari `update` dikirim sampai frame `ack` (ACK) dan sampai frame `update` diterima socket lain (penerimaan peer), masing-masing p50/p95/p99/max. Juga jumlah frame `update` vs `resync`, dan socket yang tidak mencapai versi akhir.
- Skenario: `single-instance`; `two-instances-redis` (dua server, socket dibagi rata, fan-out lewat Redis); `two-instances-redis-pg-rtt` (sama, server ke PostgreSQL lewat proxy TCP yang menambah RTT, default 10 ms, `WS_LOAD_PG_RTT_MS`).
- Penerimaan peer tidak menghitung socket penulis sendiri (penulis menerima update-nya kembali sebagai frame `update` biasa).
- Smoke default (3 editor, 3 peer, 101 node) ikut `make test-backend-integration`, jadi jalur WebSocket ini diperiksa di setiap PR.
- Gate: `WS_LOAD=1` (10 editor, 10 peer baca-saja, parameter lewat `WS_LOAD_EDITORS|VIEWERS|COMMITS|PARAGRAPHS|INTERVAL_MS`, laporan JSON lewat `WS_LOAD_REPORT`, batas lewat `WS_LOAD_ACK_P95_MS` dan `WS_LOAD_PEER_P95_MS`). `make test-backend-load` menjalankannya dengan compose sekali pakai; job `collab-load` di CI (jadwal malam) memanggilnya. Ini padanan WebSocket untuk `COMMIT_LOAD=1`.
- Pembantu: `internal/test/loadmetrics` (persentil nearest-rank, dites) dan `internal/test/netdelay` (proxy TCP berlatensi, dites).

## Diagnosis dan perbaikan (2026-10-02)

Run awal runtuh pada 2.001 node (ACK p95 detik sampai puluhan detik, server menutup peer dengan antrean penuh). Profil CPU (`go test -cpuprofile`) menunjukkan sekitar 45% waktu di `BodyReadUseCase.Read` (baca penuh body: `ProjectV1`, `Validate`, JSON) dan sekitar 25 sampai 40% di GC, dipanggil dari `fanoutFromRoomHead`. Frame `resync` (membawa state penuh) mencapai ±1 per commit, dan peer yang lambat menghabiskan antreannya. Tiga penyebab, masing-masing diperbaiki test-first (`room_read_test.go`) dan diukur ulang:

1. **Gema ke penulis.** ACK menggeser versi penulis ke versi commitnya sendiri, sehingga fan-out commit itu ke penulis dianggap "perubahan pada versi yang sama" dan dijawab dengan resync berisi state penuh plus satu baca body penuh per commit. Kini ACK tidak menggeser versi (hanya frame `update` dan `resync` yang menggeser), dan penulis menerima update-nya sendiri sebagai frame `update` kecil yang diterapkan Yjs secara idempoten. Ini juga menutup lubang: sebelumnya fan-out commit lain yang versinya di bawah commit penulis dianggap sudah tercakup dan dibuang. Tes: `TestAuthorIsNotSentItsOwnCommitBackAsAFullResync`.
2. **Fan-out tidak berurutan.** Fan-out tiap commit berjalan di goroutine penulisnya, jadi commit N sering sampai ke peer sebelum N-1 dan semua peer melihat celah lalu resync. Kini fan-out satu dokumen berjalan menurut urutan versi (menunggu fan-out sebelumnya paling lama 250 ms, lalu lanjut seperti dulu). Tes: `TestFanOutDeliversCommitsInVersionOrderWhenTheyFinishOutOfOrder`.
3. **Baca body berulang.** Peer yang tetap harus resync kini berbagi satu baca body per level akses dalam satu fan-out, dan fan-out yang berjalan bersamaan memakai ulang baca body yang dimulai setelah pembacaan head mereka (aman terhadap commit yang hanya mengubah state tanpa menaikkan `body_version`). Tes: `TestFanOutReadsTheBodyOncePerRoomWhenManyPeersMustResync`, `TestConcurrentFanOutsShareBodyReads`.

Hasil perbaikan 1 sampai 3: nol frame `resync` di hampir semua run (satu run punya 4), semua socket mencapai versi akhir, tidak ada peer yang diputus.

## Hasil terukur (lokal, sesudah perbaikan)

10 editor, 10 peer baca-saja (19 penerima per commit), 1 karakter per commit, sekitar 19 commit/s total. Tiga run per konfigurasi; p99 dari 150 sampai 200 commit kasar. Semua run lain di bawah dilakukan pada load average 10 sampai 18.

| Skenario | Node | Run | ACK p50 / p95 / p99 (ms) | Peer p50 / p95 / p99 (ms) |
|---|---|---|---|---|
| single-instance | 201 | 1 / 2 / 3 | 6 / 37 / 86; 6 / 21 / 46; 6 / 10 / 17 | 8 / 43 / 100; 7 / 29 / 55; 7 / 12 / 24 |
| two-instances-redis | 201 | 1 / 2 / 3 | 6 / 13 / 25; 6 / 22 / 48; 5 / 26 / 132 | 8 / 16 / 34; 7 / 26 / 55; 7 / 33 / 159 |
| single-instance | 2.001 | 1 / 2 / 3 | 17 / 641 / 821; 24 / 320 / 619; 28 / 68 / 132 | 18 / 650 / 825; 27 / 347 / 625; 30 / 70 / 135 |
| two-instances-redis | 2.001 | 1 / 2 / 3 | 15 / 35 / 50; 29 / 88 / 110; 21 / 43 / 95 | 17 / 39 / 52; 34 / 97 / 120; 24 / 48 / 99 |
| two-instances-redis-pg-rtt 10 ms, 4,6 commit/s | 201 | 1 / 2 / 3 | 146 / 283 / 313; 146 / 284 / 313; 150 / 302 / 327 | 253 / 375 / 433; 254 / 392 / 437; 257 / 420 / 488 |
| two-instances-redis-pg-rtt 10 ms, 19 commit/s | 201 | 1 | 9.413 / 22.418 / 23.177 (140 dari 200 ACK, 20 socket tertinggal) | 2.748 / 21.059 / 23.683 |

Sebelum perbaikan (run yang sama, mesin dengan beban serupa): 2.001 node satu instance p95 ACK 1,1 sampai 12 detik dan 16 sampai 19 detik pada run lain; 2.001 node dua instance 1,6 sampai 3,8 detik; 201 node dengan RTT 10 ms pada 4,6 commit/s p95 ACK 3,7 sampai 5,0 detik. Run 2.001 node satu instance paling lambat (p95 641 dan 320 ms) terjadi saat load average 10 sampai 11, sedangkan run ketiga (68 ms) saat 17, jadi sebaran besar itu bukan dari beban mesin saja dan sebabnya belum dijelaskan.

Interpretasi RTT: satu editor, satu commit tanpa antrean pada RTT 10 ms memberi ACK p50 142 sampai 146 ms, kira-kira 14 round trip berurutan per commit (transaksi satu dokumen diserialkan oleh kunci baris dokumen). Batas throughput per dokumen pada RTT 10 ms karena itu sekitar 7 commit/s; 19 commit/s melebihinya dan antrean tumbuh tanpa batas. Ini batas kapasitas dari jumlah round trip commit, bukan bug fan-out, dan hanya RTT 10 ms yang dicoba.

Sebagai pembanding, gate repository (tanpa WebSocket, PostgreSQL lokal, 2.001 node, 10 editor, ±17,8 commit/s) p95 66 sampai 115 ms.

## SLO

Target adalah tujuan. Kolom status hanya mengklaim apa yang diukur, dan semuanya lokal.

| Metrik | Target | Status |
|---|---|---|
| ACK p95, 201 node, ±19 commit/s, 10 editor + 10 peer, tanpa latensi DB | <= 100 ms | Terukur 10 sampai 37 ms (satu instance) dan 13 sampai 26 ms (dua instance + Redis), enam run. |
| Penerimaan peer p95, kondisi sama | <= 150 ms | Terukur 12 sampai 43 ms dan 16 sampai 33 ms. |
| ACK p95, 2.001 node, ±19 commit/s (gate G6 lewat WebSocket) | <= 200 ms | Dua instance + Redis: 35 sampai 88 ms (tiga run, memenuhi). Satu instance: 68, 320, 641 ms (hanya satu dari tiga run memenuhi). **Belum konsisten**; penyebab sebaran belum diketahui. |
| Dengan RTT 10 ms ke PostgreSQL, 201 node | belum ditetapkan sebagai target | Tahan pada 4,6 commit/s (ACK p95 283 sampai 302 ms); tidak tahan pada 19 commit/s. Batas ±7 commit/s per dokumen berasal dari ±14 round trip per commit. |
| Semua socket mencapai versi akhir setelah beban berhenti | 100% | Tercapai di semua run sesudah perbaikan kecuali run RTT 19 commit/s. |

SLO produksi (p99, ketersediaan, batas dokumen besar) belum ditetapkan: belum ada pengukuran di lingkungan terpisah, p99 dihitung dari sampel kecil, dan sebaran antar-run besar.

## Penjaga CI

`make test-backend-load` (job `collab-load`, jadwal malam) menjalankan 201 node, 10 editor, 10 peer, ±19 commit/s untuk `single-instance` dan `two-instances-redis`, dengan batas ACK p95 250 ms dan peer p95 400 ms. Batas itu sekitar enam kali p95 terburuk yang terukur di 201 node (37 dan 43 ms) pada load average 10 sampai 18. Tiga eksekusi berturut-turut lulus pada load average 9 sampai 13. Ini penjaga regresi di runner bersama, bukan SLO; batas dapat diubah lewat `WS_LOAD_ACK_P95_MS` dan `WS_LOAD_PEER_P95_MS`.

## Yang belum dikerjakan

- Penjelasan sebaran p95 pada 2.001 node satu instance (68 sampai 641 ms).
- Ukur ulang di lingkungan terpisah (server, PostgreSQL, Redis di mesin berbeda) dan beberapa nilai RTT; kurangi round trip per commit bila RTT nyata tinggi.
- Interval kepercayaan dengan lebih banyak run; semua angka di atas tiga run atau kurang per sel.
- Redis failover di bawah beban.
- Jalur `checkRoom` (poll) masih membaca body per peer yang tertinggal; belum dioptimalkan.
