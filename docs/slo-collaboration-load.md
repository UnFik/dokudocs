# SLO dan hasil uji beban kolaborasi (G6, issue #2)

Status: **hasil pengukuran LOKAL, bukan lingkungan mirip produksi.** Klien, server WebSocket, PostgreSQL 16 (tmpfs), dan Redis 7 berjalan di satu mesin 12 core yang juga dipakai pekerjaan lain (load average 20 saat sebagian run). Angka di bawah menunjukkan perilaku relatif dan titik patah, bukan kapasitas produksi. Pengukuran di infrastruktur terkelola (jaringan nyata, Redis dan PostgreSQL terkelola, beberapa instance di mesin terpisah) belum dilakukan.

## Harness

- `backend/internal/infrastructure/repository/document/collaborative_websocket_load_integration_test.go`, `TestWebSocketCollaborationLoad` (tag `integration`).
- Alur yang diukur: klien Yjs asli, WebSocket, server Go, commit PostgreSQL, ACK ke penulis, dan fan-out ke semua socket lain.
- Metrik: waktu dari `update` dikirim sampai frame `ack` (ACK) dan sampai frame `update` diterima socket lain (penerimaan peer), masing-masing p50/p95/p99/max. Juga jumlah frame `update` vs `resync`, dan socket yang tidak mencapai versi akhir.
- Skenario: `single-instance`; `two-instances-redis` (dua server, socket dibagi rata, fan-out lewat Redis); `two-instances-redis-pg-rtt` (sama, server ke PostgreSQL lewat proxy TCP yang menambah RTT, default 10 ms, `WS_LOAD_PG_RTT_MS`).
- Smoke default (3 editor, 3 peer, 101 node) ikut `make test-backend-integration`, jadi jalur WebSocket ini diperiksa di setiap PR.
- Gate: `WS_LOAD=1` (10 editor, 10 peer baca-saja, parameter lewat `WS_LOAD_EDITORS|VIEWERS|COMMITS|PARAGRAPHS|INTERVAL_MS`, laporan JSON lewat `WS_LOAD_REPORT`, batas lewat `WS_LOAD_ACK_P95_MS` dan `WS_LOAD_PEER_P95_MS`). `make test-backend-load` menjalankannya dengan compose sekali pakai; job `collab-load` di CI (jadwal malam) memanggilnya. Ini padanan WebSocket untuk `COMMIT_LOAD=1`.
- Pembantu: `internal/test/loadmetrics` (persentil nearest-rank, dites) dan `internal/test/netdelay` (proxy TCP berlatensi, dites).

## Hasil terukur (lokal)

10 editor, 10 peer baca-saja (19 penerima per commit), 1 karakter per commit, satu dokumen. Satu run per sel kecuali disebut lain; sampel 120 sampai 200 commit, jadi p99 kasar.

| Skenario | Node | Commit/s | ACK p50 / p95 / p99 (ms) | Peer p50 / p95 / p99 (ms) | Catatan |
|---|---|---|---|---|---|
| single-instance | 201 | 19,1 | 5,3 / 10,6 / 15,6 | 9,1 / 17,6 / 23,0 | semua 3.800 fan-out sebagai `update` |
| two-instances-redis | 201 | 19,1 | 5,3 / 9,8 / 18,2 | 12,2 / 26,0 / 35,0 | semua 3.800 fan-out sebagai `update` |
| two-instances-redis-pg-rtt (10 ms) | 201 | 19,1 direncanakan | 16.560 / 23.866 / 24.066 | 18.732 / 23.997 / 24.373 | **runtuh**: 77 dari 200 ACK, 11 error, 20 socket tertinggal |
| single-instance | 2.001 | 4,6 | 16,2 / 37,5 / 45,2 | 37,2 / 75,5 / 99,6 | semua 2.280 fan-out sebagai `update` |
| single-instance | 2.001 | 9,2 (run lain) | 653 / 12.768 / 13.427 | 90 / 9.244 / 13.539 | **runtuh**: 71 dari 120 ACK, socket tertinggal |
| single-instance | 2.001 | 18 (run lain) | p95 9.359 | p95 6.903 | **runtuh**, socket diputus server |
| two-instances-redis | 2.001 | 4,6 direncanakan | 194 / 1.593 / 2.735 | 151 / 2.292 / 4.914 | **runtuh**: 23 dari 120 ACK, 21 error |
| two-instances-redis-pg-rtt (10 ms) | 2.001 | 4,6 direncanakan | 961 / 4.152 / 4.152 | 915 / 5.596 / 5.963 | **runtuh** |

Kolom "runtuh" berarti server memutus socket (error `read: EOF`; kode server menutup peer yang antreannya penuh, `WebSocket peer queue is full`) dan klien tidak pernah mencapai versi akhir. Run diulang pada 201 node lewat `make test-backend-load` saat mesin sedang padat (load average 20 sampai 22): ACK p95 meleset di kedua skenario pada run pertama (1.361 dan 2.312 ms) dan di skenario Redis pada run kedua (3.172 ms), sedangkan `single-instance` lulus di run kedua. Variansinya besar, jadi batas CI saat ini adalah penjaga regresi di runner bersama dan bisa flaky.

Sebagai pembanding, gate repository (tanpa WebSocket, PostgreSQL lokal, 2.001 node, 10 editor, ±17,8 commit/s) p95 66 sampai 115 ms.

## Temuan

1. Pada 201 node dan 19 commit/s, jalur WebSocket lokal memenuhi target di bawah, baik satu instance maupun dua instance dengan Redis.
2. Pada 2.001 node jalur WebSocket jauh lebih lambat daripada jalur repository dan runtuh antara sekitar 5 dan 9 commit/s (satu instance). Gate G6 ("2.001 node, 10 editor, 2 commit/s") tidak terbukti lewat WebSocket. Penyebab belum didiagnosis. Petunjuk dari data: banyak frame `resync` (membawa state penuh) selain `update`, dan server menutup peer yang lambat. Kandidat yang perlu diprofil: encode/kirim snapshot per peer, pembacaan body per commit pada dokumen besar, dan urutan fan-out yang tidak berurutan memicu resync.
3. Menambah RTT 10 ms ke PostgreSQL meruntuhkan skenario bahkan pada 201 node. Commit memakai beberapa round trip berurutan dalam satu transaksi per dokumen, sehingga throughput per dokumen dibatasi RTT. Ini belum dikuantifikasi per RTT; hanya satu nilai (10 ms) yang dicoba.
4. Frame `resync` per commit terlihat di semua run (mis. 120 resync untuk 120 commit di 201 node). Belum diselidiki apakah ini frame awal per socket, balasan ke penulis, atau perilaku yang bisa dihindari.

## Diagnosis awal pada 2.001 node (run ulang, mesin tenang)

Run ulang `single-instance`, 10 editor, 10 peer, 2.001 node, 150 commit, mesin dengan load average sekitar 4 (bukan 20). Satu run per sel.

| Commit/s | ACK p50 / p95 / p99 (ms) | Peer p50 / p95 / p99 (ms) | Frame update / resync | Hasil |
|---|---|---|---|---|
| 9,4 | 12,1 / 20,5 / 38,8 | 31,2 / 45,3 / 52,4 | 2.850 / 150 | bersih |
| 13,4 | 13,2 / 28,5 / 50,2 | 32,2 / 86,1 / 115,6 | 2.830 / 163 | bersih |
| 18,7 | 3.159 / 7.332 / 7.979 | 378 / 7.952 / 8.352 | 1.010 / 294 | jenuh (antrean), semua socket tetap mencapai versi akhir |

Koreksi atas temuan 2: "runtuh" pada 9 commit/s di tabel atas terjadi saat load average 20, jadi lebih mungkin kontensi mesin daripada batas kode. Pada mesin tenang, 2.001 node bersih sampai 13 commit/s dan jenuh antara 13 dan 19 commit/s. Gate G6 (2 commit/s per editor, 20 commit/s total) tetap belum tercapai lewat WebSocket.

Profil CPU pada run 18,7 commit/s (`go test -cpuprofile`): sekitar 46% waktu di `BodyReadUseCase.Read` (pembacaan seluruh body: `loadDocumentBody`, `yjs.ProjectV1`, `documentbody.Validate`, `encoding/json`), dan sekitar 41% di GC. Pembaca itu dipanggil dari dua jalur: `fanoutFromRoomHead` lewat `readAuthorizedSnapshot` dan jalur pembacaan snapshot saat resync. Hipotesis yang belum dibuktikan dengan perubahan kode: saat commit dari beberapa editor tiba tidak berurutan, `fanoutNeedsFullSnapshot` bernilai benar (`receipt.BodyVersion > p.bodyVersion+1`) untuk banyak peer sekaligus, dan tiap peer memicu pembacaan body penuh. Jumlah frame `resync` naik dari 150 ke 294 pada run jenuh, sejalan dengan hipotesis ini. Perbaikan yang layak dicoba: memakai satu pembacaan snapshot per fan-out (di-cache per hak akses) dan menunda resync untuk peer yang hanya tertinggal beberapa versi. Belum dikerjakan dan belum diukur.

## SLO

Target ini ditetapkan sebagai tujuan. Kolom status hanya mengklaim apa yang diukur.

| Metrik | Target | Status |
|---|---|---|
| ACK p95, dokumen sampai 200 node, 20 commit/s, 10 editor + 10 peer | <= 100 ms | Terukur lokal 10 sampai 11 ms pada run tenang; meleset saat mesin padat. Belum terbukti di lingkungan terpisah. |
| Penerimaan peer p95, kondisi sama | <= 150 ms | Terukur lokal 18 sampai 26 ms pada run tenang. Belum terbukti di lingkungan terpisah. |
| ACK p95, dokumen 2.000 node, 2 commit/s per editor (gate G6) | <= 200 ms | **Belum tercapai lewat WebSocket.** Terukur lokal: 37 ms pada 4,6 commit/s total, runtuh pada 9 commit/s. Pada 20 commit/s tidak diukur dengan hasil bersih. |
| Dengan RTT ke PostgreSQL 10 ms | belum ditetapkan | **Tidak tercapai** pada 201 node; tidak ada angka layak dikutip. |
| Pemulihan: socket mencapai versi akhir setelah beban berhenti | 100% socket | Tercapai di run yang tidak runtuh; gagal di run yang runtuh. |

SLO produksi (p99, ketersediaan, batas dokumen besar) belum ditetapkan karena belum ada pengukuran di lingkungan mirip produksi dan sampel p99 di atas kecil.

## Yang belum dikerjakan

- Diagnosis penyebab keruntuhan di 2.001 node dan dengan RTT PostgreSQL (profil CPU/pprof server, hitung resync, ukuran frame).
- Ukuran ulang di lingkungan terpisah (server, PostgreSQL, Redis di mesin berbeda) dan beberapa nilai RTT.
- Pengulangan run untuk interval kepercayaan; angka di atas satu run per sel.
- Redis gagal-jalan (failover) di bawah beban.
