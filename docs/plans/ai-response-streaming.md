# Streaming respons AI Dokudocs

Status: diimplementasikan di branch `feat/ai-response-streaming` (satu PR). Lihat bagian Hasil implementasi di akhir untuk apa yang dikerjakan dan yang sengaja belum.

## Fakta kode saat perencanaan

- Chat workspace dan panel dokumen memakai POST `/api/v1/rag/conversations/{id}/messages`. Handler memilih Agent jika tersedia, atau RAG; keduanya mengembalikan JSON lengkap setelah penyimpanan.
- Adapter model belum meminta streaming. Agent menerima teks dan argumen tool lengkap per langkah; argumen harus lengkap dan tervalidasi sebelum tool dijalankan.
- MCP eksternal menjalankan tool dan menyediakan prompt tanpa memakai model Dokudocs. Handler memakai Streamable HTTP dengan `JSONResponse: true`; streaming token aplikasi AI eksternal merupakan jalur terpisah.
- Test Connection menguji satu keperluan: answer, agent, atau embedding. Embedding menghasilkan vektor; re-embedding sudah memiliki hitungan selesai/total. Judul percakapan berasal dari pertanyaan, bukan generasi AI.
- Belum ada penyimpanan proses chat berjalan, replay stream, atau jawaban parsial. Tool bisa menghasilkan perubahan sebelum jawaban chat tersimpan; pembatalan tidak membatalkan perubahan tersebut.
- `http.TimeoutHandler` menahan respons. Pembungkus respons logger dan metrics belum meneruskan Flush/Unwrap. Proxy nginx API belum memiliki pengaturan khusus streaming. Perilaku proxy production belum diperiksa.

## Keputusan putaran pertama — disetujui

1. Cakupan: seluruh jalur AI, dengan teks jawaban, status agent/tool, progres Test Connection, progres embedding/re-embedding, dan progres tool MCP sesuai kegunaannya.
2. Diralat pada Q10: koneksi chat terputus atau panel ditutup tidak menghentikan pekerjaan AI di server. Client yang kembali harus dapat mengambil status/hasil pekerjaan yang sama tanpa menjalankan ulang tool.
3. Tampilan agent: teks, status tool singkat, dan kartu persetujuan. Jangan tampilkan reasoning internal atau argumen/hasil tool mentah.
4. Diralat oleh User: teks jawaban chat harus tampil token per token seperti Claude/Codex. Keputusan sebelumnya untuk menahan teks RAG sampai finalisasi tidak lagi menjadi target. Aturan pengungkapan draft berbasis sumber perlu disepakati sebelum implementasi.

## Aturan snapshot sumber — keputusan Q9

User memilih sumber kebenaran pada awal request. RAG memakai snapshot sumber yang diizinkan saat request dimulai; perubahan sumber atau akses setelah itu tidak membatalkan jawaban request tersebut. Keputusan ini mengubah aturan finalisasi berbasis sumber pada [ADR-0004](../adr/0004-persistent-rag-chat-history.md), dicatat dalam [ADR-0046](../adr/0046-streamed-answers-use-the-request-source-snapshot.md). Agent mengambil snapshot sumber baru ketika pertama kali berhasil dibaca dengan izin saat itu, lalu menggunakan snapshot yang sama sepanjang pekerjaan. Tindakan tulis tetap memeriksa izin terbaru saat eksekusi. Hak membuka percakapan terpisah dari isi snapshot.

## Keputusan putaran kedua

5. Diralat: jawaban Agent juga tampil token per token, tidak ditahan seluruhnya sampai selesai. Reasoning internal dan argumen tool mentah tetap tidak ditampilkan; argumen tool harus lengkap dan tervalidasi sebelum dieksekusi.
6. Disetujui: hanya jawaban selesai disimpan dalam riwayat. Pemberitahuan gagal/dihentikan ditampilkan; aksi dan kartu persetujuan yang sudah tersimpan tetap dapat dilihat. Penanganan draft yang sudah terlihat serta koneksi putus dibahas pada putaran ketiga.
7. Disetujui: persetujuan menjalankan tindakan dan menampilkan hasil; tidak otomatis melanjutkan model.
8. Disetujui: provider tanpa streaming tetap boleh dipakai dengan progres selama menunggu respons lengkap. Jangan otomatis mengulang seluruh proses Agent saat gagal.

## Keputusan putaran ketiga

9. Disetujui dengan ralat: sumber kebenaran hanya pada awal request, bukan diperiksa ulang untuk membatalkan draft saat finalisasi.
10. Disetujui dengan ralat: proses tetap berjalan di server saat koneksi putus/client ditutup. Ini membutuhkan siklus hidup pekerjaan yang tidak mengikuti konteks request HTTP.
11. Disetujui: simpan draft/status pekerjaan agar bisa dilanjutkan tampilannya ketika reconnect, terpisah dari jawaban final. Putus koneksi client bukan kegagalan generasi; kegagalan pekerjaan/provider menjadi status gagal tanpa otomatis mengulang tool.

## Keputusan putaran keempat — disetujui

12. Agent menggunakan snapshot ketika pertama kali sumber berhasil dibaca dengan hak saat itu. Tindakan tulis tetap memeriksa hak terbaru saat eksekusi.
13. Server restart: tandai pekerjaan terputus dan pertahankan draft/status/tindakan yang tersimpan, tanpa otomatis mengulang generasi atau tool. Kelangsungan lintas restart tidak menjadi jaminan versi awal.

## Keputusan putaran kelima — disetujui

14. Sediakan tombol Stop untuk membatalkan generasi dan langkah tool berikutnya. Tindakan selesai tetap berlaku; menutup panel bukan Stop.
15. Satu pekerjaan chat aktif per percakapan. Tab lain mengikuti pekerjaan yang sama; pertanyaan baru menunggu selesai/dihentikan. Percakapan berbeda boleh berjalan bersamaan.
16. Test Connection dan Save tetap berjalan ketika halaman ditutup; status/hasil bisa dibuka kembali. Test tidak menyimpan konfigurasi, Save menyimpan setelah uji berhasil. Tidak otomatis mengulang pengujian gagal.
17. MCP memakai progres tool melalui mekanisme standar MCP pada client yang mendukung, dengan hasil akhir untuk client lain. Jaminan reconnect pekerjaan persisten chat tidak diterapkan pada MCP versi awal. Re-embedding tetap memakai worker yang sudah ada.

## Keputusan putaran terakhir — disetujui

18. Batas pekerjaan: pertahankan deadline chat bawaan 120 detik dan batas Agent delapan langkah; deadline tidak diperpanjang saat reconnect. Pertahankan deadline uji 40 detik dan batas HTTP provider yang sudah ada.
19. Retensi draft: hapus draft pekerjaan terminal setelah tujuh hari; jawaban final dan tindakan mengikuti kebijakan penyimpanan masing-masing. Penghapusan percakapan/workspace membersihkan pekerjaan terkait.
20. Provider: dukung streaming Chat Completions dan Responses sesuai protokol terpilih. Provider tanpa streaming tetap mendapat progres dan jawaban lengkap; jangan otomatis mengganti protokol atau mengulang generasi setelah teks/tool mulai menghasilkan keluaran. Uji koneksi melaporkan kemampuan streaming secara terpisah dari keberhasilan koneksi.
21. Kompatibilitas dan kriteria uji: pertahankan API respons JSON lama, tambahkan jalur pekerjaan/stream untuk UI baru; uji token bertahap, reconnect tanpa duplikasi, Stop, provider gagal, server restart, akses/snapshot, Test/Save, dan MCP. Uji provider nyata parameterized/opt-in tanpa menyimpan API key dalam test atau artefak.

## Hasil yang harus terlihat

| Jalur | Perilaku |
| --- | --- |
| Chat workspace dan panel dokumen, RAG/Agent | Teks bertambah dari delta provider, status proses/tool, Stop, reconnect ke pekerjaan sama |
| Provider tanpa streaming | Progres selama menunggu, kemudian jawaban lengkap; bukan simulasi mengetik |
| Test Connection | Progres uji satu keperluan, hasil koneksi dan kemampuan streaming terpisah, tanpa menyimpan konfigurasi |
| Save AI provider | Uji lalu simpan, status/hasil bisa dibuka kembali setelah halaman ditutup |
| Embedding/re-embedding | Progres batch/done/total dari worker; tidak ada token teks pada vektor |
| MCP | Progress notification sesuai protokol dan client, lalu hasil tool final; tanpa pekerjaan chat model Dokudocs |

Istilah token per token berarti delta teks asli selama generasi. Satu delta provider dapat berisi lebih dari satu token; jangan memecah jawaban yang sudah selesai dengan timer agar terlihat seperti streaming. Citation final hanya diterbitkan setelah struktur jawaban selesai dan tervalidasi. Teks yang sudah terlihat tetap draft sampai pekerjaan berhasil.

## Bentuk implementasi

Gunakan Go stdlib, PostgreSQL, SDK MCP, serta pola worker dan klien HTTP yang sudah terpasang. Tidak menambahkan Redis atau framework antrean. Pisahkan empat tanggung jawab: adapter delta provider, orkestrasi pekerjaan, penyimpanan status/event, dan transport/UI.

### Pekerjaan dan penyimpanan

- `AI run` menjadi satu percobaan chat atau pengujian/penerapan konfigurasi dengan ID stabil. Simpan pemilik, jenis, conversation/workspace bila ada, status, waktu, deadline, sequence terakhir, draft, metadata hasil/error yang aman, dan instance server pemroses.
- Status: `running`, `completed`, `failed`, `cancelled`, `interrupted`. Kegagalan provider dan timeout adalah `failed`; Stop adalah `cancelled`; restart yang menghentikan pekerjaan adalah `interrupted`.
- Mulai pekerjaan secara atomik dengan idempotency key. Pengulangan request karena respons penerimaan hilang mengembalikan ID sama; payload berbeda dengan key sama ditolak. Unique constraint mencegah dua pekerjaan chat aktif dalam percakapan sama, termasuk dari dua tab dan API JSON lama.
- Deadline dihitung sekali ketika pekerjaan diterima: chat 120 detik, uji provider 40 detik. Tetap hormati deadline HTTP model dan batas delapan langkah Agent. Perpanjangan koneksi pengamat tidak mengubah deadline pekerjaan.
- Worker memakai konteks lifecycle server dengan deadline pekerjaan, bukan `r.Context()` dari pengamat. Pengamat lambat/putus tidak membatalkan atau menahan provider. Batasi pekerjaan/model aktif dan ukuran draft/event agar goroutine, memori, dan database tidak tumbuh tanpa batas.
- Simpan delta/event dalam batch kecil dengan sequence monotonic; terbitkan setelah commit. Jangan satu insert per token. Status/tool/aksi/hasil terminal disimpan segera. Teks yang sudah terbit dapat dipulihkan saat reconnect.
- Finalisasi menyimpan pasangan pesan, metadata/citation, hasil pekerjaan, dan status `completed` dalam transaksi yang sama. Retry transaksi tidak menjalankan model/tool ulang. Jika client kehilangan event final, ia mengambil hasil pekerjaan yang sudah tersimpan.
- Tautkan tool/action records ke pekerjaan. Bedakan aksi yang sudah selesai dari aksi mulai tetapi hasilnya belum diketahui. Restart tidak menjalankan ulang keduanya; untuk hasil tidak pasti, tampilkan bahwa tindakan perlu diperiksa. Jangan menjanjikan rollback atau exactly-once untuk efek eksternal.
- Gunakan ownership instance dan lease/heartbeat agar restart hanya menandai pekerjaan pemroses yang mati, bukan milik instance lain yang sehat. Pekerjaan terputus tidak dilanjutkan otomatis. Proses shutdown memakai batas shutdown yang sudah ada.
- Draft terminal gagal/cancelled/interrupted dibersihkan setelah tujuh hari. Untuk pekerjaan sukses, draft tidak perlu menggandakan jawaban final; event replay terminal dapat dibersihkan setelah tujuh hari. Penghapusan percakapan/workspace membersihkan pekerjaan terkait dan menghentikan pekerjaan aktif sebelum finalisasi.
- Hanya pemilik dapat melihat pekerjaan chat. Pekerjaan platform memerlukan peran Superadmin saat mengambil status/hasil. Reconnect memeriksa otorisasi terbaru untuk pekerjaan; snapshot sumber tidak memberikan hak membuka pekerjaan milik pihak lain.
- API key mentah tidak disimpan dalam record pekerjaan, event, draft, log, atau error. Test/Save memakai key dalam memori saat berjalan; Save memakai enkripsi pengaturan yang sudah ada ketika sukses. Karena restart tidak melanjutkan pekerjaan, kredensial percobaan tidak perlu disimpan untuk replay.

### Kontrak API baru dan kompatibilitas

Pertahankan endpoint JSON lama sebagai jalur kompatibilitas, dengan orkestrasi dan pembatasan pekerjaan yang sama. Responsnya tetap JSON lengkap; koneksi pengamat yang putus tidak menjalankan ulang pekerjaan.

Kontrak rute yang direncanakan, mengikuti middleware auth/workspace yang sudah ada:

| Operasi | Rute |
| --- | --- |
| Mulai chat | `POST /api/v1/rag/conversations/{id}/runs` → `202`, ID/status/URL pengamat |
| Temukan pekerjaan aktif atau terakhir | `GET /api/v1/rag/conversations/{id}/runs` |
| Snapshot status, draft, sequence, hasil | `GET /api/v1/ai/runs/{id}` |
| Ikuti event | `GET /api/v1/ai/runs/{id}/events`, cursor melalui `Last-Event-ID` |
| Stop | `POST /api/v1/ai/runs/{id}/cancel` |
| Mulai Test/Save platform | `POST /api/v1/platform/ai/{purpose}/runs`, operasi eksplisit `test` atau `save` |

Respons non-stream mengikuti envelope JSON repo. Stream memakai SSE dengan `id`, `event`, dan `data` JSON. Event aplikasi: `status`, `text_delta`, `tool_status`, `action_pending`, `completed`, `failed`, `cancelled`, `interrupted`. Status berhasil/galat setelah header stream dikirim dinyatakan sebagai event terminal, bukan perubahan status HTTP.

Snapshot dan subscription harus bebas celah: sequence snapshot menentukan cursor, event setelah cursor direplay sebelum event langsung. Event duplicate diabaikan berdasarkan sequence. Cursor kedaluwarsa ditangani dengan snapshot terbaru dan resinkronisasi, bukan menjalankan model ulang. Heartbeat SSE menjaga koneksi pengamat tanpa dihitung sebagai token atau event produk.

Frontend membaca SSE melalui `fetch` agar bearer token, workspace, same-origin, pemeriksaan perubahan sesi, dan error auth tetap mengikuti klien API repo. Jangan meletakkan key/token dalam URL. Pembatalan fetch hanya melepas pengamat; tombol Stop memakai endpoint cancel. Reconnect memakai backoff terbatas, berhenti pada event terminal/auth gagal; pembukaan panel kembali memuat pekerjaan aktif/terakhir.

### Streaming provider, RAG, dan Agent

- Adapter Chat Completions menangani chunk delta teks, delta tool call, terminator, dan usage terminal. Adapter Responses menangani event delta/output-item/completed/failed/refusal yang relevan. Jangan menganggap satu paket HTTP berisi satu event atau satu karakter UTF-8 lengkap.
- Parser SSE dan buffer provider dibatasi ukurannya. EOF sebelum sinyal selesai, JSON rusak, refusal, dan respons incomplete menjadi kegagalan yang terlihat; jangan mengubah draft menjadi jawaban sukses.
- Untuk RAG, pertahankan format final `answer` dan `source_ids` beserta hint eksplisit dari PR #152. Ekstrak hanya string `answer` secara incremental, dengan decoder escape/Unicode yang benar; jangan tampilkan JSON mentah. Validasi objek lengkap di akhir, petakan source IDs terhadap snapshot, dan tampilkan citation final.
- Snapshot RAG ditetapkan pada fase awal retrieval sebelum generasi, bukan selama/di akhir streaming. Jangan menahan lock database selama provider bekerja. Sumber Agent baru disnapshot saat pertama berhasil dibaca; perubahan isi berikutnya tidak diam-diam mengganti snapshot. Tulis tetap memakai hak dan versi operasi terbaru sesuai jalur tool yang ada.
- Bila sumber dihapus selama generasi, jawaban dari snapshot tetap dapat diselesaikan menurut ADR-0046; citation tidak membuat referensi DB yatim. Simpan teks yang diperbolehkan oleh kebijakan sejarah, tetapi hilangkan referensi citation ke sumber yang sudah dihapus. Hapus workspace/percakapan tetap menghentikan pekerjaan terkait.
- Agent mengirim teks dan status langkah tanpa reasoning internal. Bedakan teks tiap langkah supaya prosa sebelum tool dan jawaban akhir tidak terduplikasi saat replay/finalisasi. Argumen tool lengkap dan tervalidasi sebelum eksekusi; delta argumen mentah tidak dikirim ke UI.
- Kartu persetujuan berasal dari action yang sudah tersimpan. Persetujuan menjalankan aksi, tanpa model continuation otomatis. Error/Stop tidak menghilangkan kartu atau aksi selesai. Retry generasi baru tidak menyambung teks lama atau otomatis replay tool.
- Fallback respons lengkap hanya untuk konfigurasi/kemampuan yang diketahui tidak mendukung streaming, atau penolakan eksplisit sebelum ada keluaran/tool. Tidak fallback pada 401/404 dengan mengganti protokol, atau setelah stream menghasilkan teks/aksi. Kemampuan harus terkait base URL, protokol, model, dan konfigurasi yang diuji; kegagalan satu stream bukan bukti seluruh provider tidak mendukung streaming.
- Pencatatan usage mempertahankan feature/user/workspace attribution untuk setiap panggilan model, terpisah dari koneksi pengamat. Replay/reconnect bukan pemakaian model baru. Jika provider tidak mengirim usage saat terputus, tandai tidak diketahui, jangan mengarang token atau menyamakan dengan nol pemakaian.

### Test/Save, embedding, MCP, dan transport

- Test/Save menjadi pekerjaan platform yang hanya Superadmin boleh akses. Test tetap terisolasi per keperluan. Uji answer/agent memakai streaming bila tersedia; embedding hanya menguji vektor. Hasil melaporkan koneksi berhasil/gagal serta streaming didukung/tidak didukung/belum terverifikasi. Teks sample atau tool-call test tidak menjadi pesan chat atau aksi nyata.
- Save commit konfigurasi hanya sesudah test berhasil. Lindungi update bersamaan supaya Save lama yang selesai belakangan tidak menimpa konfigurasi lebih baru tanpa pemeriksaan versi. Restart sebelum commit tidak menerapkan konfigurasi; restart sesudah commit harus memperlihatkan hasil committed, bukan menyimpan ulang.
- Re-embedding tetap memakai worker existing. Kirim progres selesai/total/model/status ke halaman platform dengan contract pengamat yang sama; menutup halaman tidak menghentikan worker atau mengganti aturan pergantian model aktif ADR-0039. Embedding retrieval biasa memakai status tahap, bukan teks token.
- MCP memakai `progressToken` dan `notifications/progress` standar bila diminta client. Nilai progres bertambah, total boleh tidak diketahui, dan notifikasi berhenti saat selesai. Gunakan SSE transport SDK untuk permintaan yang memerlukan progress, dengan jalur hasil JSON untuk permintaan tanpa progress bila kompatibel SDK/client. Tidak membuat task/replay MCP sendiri pada versi awal; uji negosiasi dan disconnect client yang didukung.
- Streaming route tidak memakai `http.TimeoutHandler` yang menahan respons. Deadline pekerjaan tetap terpisah dari durasi pengamat. Pembungkus logger/metrics meneruskan kemampuan Flush/Unwrap yang diperlukan; perubahan tidak merusak WebSocket/Hijack.
- Atur proxy buffering/cache/compression dan read timeout untuk jalur SSE, heartbeat, serta deadline write server. Jangan mengubah endpoint JSON/WebSocket secara tidak sengaja. Verifikasi chunk lewat proxy sebenarnya, bukan hanya request langsung ke Go. Jika deployment memakai Cloudflare, ikuti CLI/proyek yang tersedia dan verifikasi jalur tunnel tanpa menganggapnya otomatis lolos.

## Urutan implementasi dan bukti selesai

1. **Baseline dan data pekerjaan:** checkout bersih dari main yang mencakup PR #152; migration, repository run/events, ownership/idempotency, satu pekerjaan aktif, deadline, cancel, cleanup, dan pemulihan interruption. Uji dengan PostgreSQL nyata.
2. **Adapter provider:** streaming dua protokol, parser terfragmentasi, usage, schema/fenced JSON yang sudah didukung, dan fallback terbatas. Uji fake provider dengan delay/delta yang deterministik.
3. **RAG/Agent:** snapshot sesuai ADR-0046, delta jawaban, tool status/persetujuan, finalisasi atomik, efek tool yang sudah selesai/hasil tidak pasti. Uji perubahan sumber, pencabutan akses, deletion, dan Stop pada berbagai tahap.
4. **Transport dan UI chat:** API start/status/events/cancel, auth dan replay cursor, perbaikan middleware/proxy, satu consumer untuk workspace dan panel dokumen. Uji browser bahwa teks pertama terlihat sebelum provider selesai; reload/dua tab mengikuti ID sama tanpa menggandakan pesan, token, atau tool.
5. **Seluruh jalur lain:** pekerjaan Test/Save, laporan streaming, progres embedding/re-embedding, dan progress MCP. Uji per keperluan dan konfigurasi supaya key/data tidak bocor dan Test tidak mengubah settings.
6. **Integrasi dan deployment:** compatibility JSON, metrik/usage, startup/shutdown/retensi, E2E melalui proxy, lalu smoke test provider nyata opt-in. Tinjau rencana, implementasi, dan hasil sebelum deploy; belum ada deploy otomatis yang diotorisasi sesi perencanaan ini.

## Matriks pengujian

| Kasus | Bukti yang diharapkan |
| --- | --- |
| Streaming sukses Chat Completions/Responses | Delta terlihat sebelum selesai; teks final/citation sama dengan hasil tervalidasi |
| SSE/JSON terfragmentasi, Unicode/escape, terminator | Decoder benar; tidak ada JSON/argumen tool mentah; EOF/rusak ditandai gagal |
| Client putus, panel ditutup, reload, dua tab | Pekerjaan yang sama terus berjalan; replay tidak menggandakan token, pesan, tool, atau usage |
| Penerimaan start hilang / request berulang | Idempotency mengembalikan pekerjaan sama; satu pekerjaan aktif dijaga database |
| Stop vs completion, timeout, stream/provider gagal | Satu hasil terminal konsisten; tidak ada replay tool otomatis; draft tetap berlabel |
| Restart/shutdown/multi-instance | Hanya pekerjaan owner mati menjadi interrupted; pekerjaan sehat tidak dihentikan; efek tool tidak diulang |
| Snapshot berubah, akses dicabut, sumber dihapus | Snapshot jawaban dipertahankan sesuai keputusan; tool baru/tulis dan reconnect tetap memeriksa hak yang berlaku |
| User lain, sesi berubah, Superadmin dicabut | Status/draft/event tidak bocor; pengamat ditolak atau dihentikan sesuai auth |
| Test/Save, key baru/invalid, save bersamaan | Test tanpa perubahan settings; Save hanya setelah sukses dan tanpa lost update; key tidak masuk artefak |
| Embedding/re-embedding | Progres benar; model lama tetap aktif sampai transisi selesai |
| MCP dengan/tanpa progressToken | Progress standar jika didukung, hasil akhir tetap benar; tool tidak menjadi generasi model Dokudocs |
| Retensi, hapus percakapan/workspace | Draft/event terminal dibersihkan; pekerjaan terkait tidak dapat finalisasi kembali setelah penghapusan |
| Proxy dan klien lambat | Chunk tidak ditahan proxy; pengamat lambat tidak menahan pekerjaan/model |

Live E2E memakai base URL/model/protokol/API key parameterized melalui env, trace dimatikan dan error disanitasi. Key tidak di-hardcode, dipersist ke fixture, atau dicetak. Sumopod diuji dengan Chat Completions; Responses 404 tetap dilaporkan, bukan diganti protokol diam-diam. Provider nyata mengonsumsi usage; sebagian besar edge case diuji deterministik melalui fake provider.

## Dokumen keputusan dan sumber

- [ADR-0046: snapshot sumber](../adr/0046-streamed-answers-use-the-request-source-snapshot.md).
- [ADR-0047: pekerjaan chat tetap berjalan](../adr/0047-ai-chat-runs-outlive-client-connections.md).
- [CONTEXT.md](../../CONTEXT.md): definisi AI run sebagai percobaan, bukan koneksi atau jawaban selesai.
- [Standar SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html): framing event dan cursor untuk replay; autentikasi fetch/recovery aplikasi tetap tanggung jawab Dokudocs.
- [Streaming OpenAI](https://developers.openai.com/api/docs/guides/streaming-responses): referensi format streaming; dukungan provider kompatibel harus diuji, tidak diasumsikan.
- [Progress MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress): progressToken dan notifications/progress; kemampuan SDK/client yang dipakai tetap diuji.

## Batas versi awal

Tidak ada auto-resume generasi setelah server restart, auto-replay aksi, reasoning internal, token streaming untuk vektor embedding, atau jaminan reconnect pekerjaan MCP. Provider tanpa streaming mendapatkan progres dengan respons lengkap. Draft bukan jawaban final; informasi yang sudah dikirim tidak dapat ditarik kembali. Memilih snapshot awal berarti pencabutan akses sumber sesudah snapshot tidak membatalkan jawaban dari snapshot itu.

## Referensi kode

- `backend/internal/application/rag/usecase/chat.go`
- `backend/internal/application/agent/chat.go`
- `backend/internal/presentation/mcpserver/handler.go`
- `backend/internal/infrastructure/openai/`
- `backend/internal/infrastructure/middleware/timeout_middleware.go`
- `backend/internal/infrastructure/middleware/logger_middleware.go`
- `backend/internal/infrastructure/metrics/metrics.go`
- `frontend/src/lib/api-client.ts`
- `frontend/nginx.conf`

Baseline implementasi harus memasukkan perbaikan PR #152 jika belum masuk main. Belum ada kode implementasi atau pengujian baru dalam sesi perencanaan ini.

## Hasil implementasi

Dikerjakan sesuai urutan di atas. Yang berbeda dari rencana atau sengaja belum:

- **Transport event:** SSE membaca tabel `ai_run_events` dengan polling 150 ms (bukan LISTEN/NOTIFY). Itu sederhana, benar lintas instance, dan cukup untuk satu pengamat per run. Heartbeat tiap 15 detik.
- **Finalisasi:** pesan, sitasi, dan status `completed` disimpan dalam dua transaksi (`StoreRAGAnswer`, lalu `Finish`), bukan satu. Jika server mati di antaranya, pesan sudah tersimpan dan run ditandai `interrupted`; run tidak dijalankan ulang. Menyatukannya ke satu transaksi butuh `StoreRAGAnswer` menerima transaksi dari luar.
- **Aksi tool yang hasilnya tidak pasti:** aksi yang disetujui tanpa hasil tercatat ditampilkan sebagai "hasil tidak pernah tercatat" dan tidak dijalankan ulang. Aksi belum ditautkan ke `ai_runs` lewat kolom.
- **Fallback provider:** permintaan streaming yang dijawab provider dengan JSON utuh diterima sebagai jawaban lengkap (dan dilaporkan `unsupported` pada Test). Penolakan eksplisit `stream: true` dengan 400 belum mengulang tanpa stream.
- **Progres MCP:** notifikasi bertahap nyata hanya dua langkah (mulai, selesai) karena eksekutor tool sinkron. Hanya permintaan dengan `progressToken` memakai balasan event stream; sisanya tetap JSON.
- **Satu instance:** Stop bekerja pada run yang berjalan di instance yang menerima permintaan Stop. Run di instance lain tidak dibatalkan (belum ada perintah lintas instance).
- **Belum diverifikasi:** jalur Cloudflare/tunnel. nginx sudah diuji mengalirkan chunk tanpa buffer; tunnel production belum.
