# Riset: best practice harness AI agent untuk backend Dokudocs

Tanggal: 2026-10-16. Cakupan: `backend/internal/application/agent`, `backend/internal/infrastructure/openai/agent.go`, `backend/internal/application/mcp`.

## 1. Temuan di kode saat ini (akar masalah)

| # | Temuan | Lokasi | Dampak |
|---|--------|--------|--------|
| 1 | Batas output model **2000 token per step** (`max_completion_tokens` / `max_output_tokens`) | `infrastructure/openai/agent.go:117,171` | Konten dokumen panjang di argumen tool terpotong di tengah JSON. |
| 2 | Argumen tool yang JSON-nya tidak valid **diam-diam diganti `{}`**; `finish_reason` / `status` tidak diperiksa | `agent.go:142-145` | Tool jalan dengan argumen kosong, lalu model hanya menerima "operations must be a non-empty list" atau "arguments are not valid". Model tidak tahu bahwa ia terpotong, jadi ia bertanya ke user atau mengulang hal yang sama. **Ini penyebab utama "gagal saat konten banyak".** |
| 3 | `envelope()` memotong **JSON mentah** pada `MaxResultBytes` lalu membungkusnya sebagai string. `read_document` adalah `map`, jadi Go mengurutkan key secara alfabet dan `version` ada di **paling akhir** | `executor.go:190-197`, `tools.go:247` | Dokumen besar: `version` hilang, jadi `edit_document_content` tidak bisa dipanggil dengan benar. Selain itu tidak ada petunjuk cara mempersempit hasil. |
| 4 | `read_document` selalu mengembalikan seluruh teks. Tidak ada offset/limit, outline, atau baca per heading | `tools.go:225-252` | Dokumen besar memenuhi konteks atau terpotong (poin 3). |
| 5 | Operasi edit Markdown hanya `replace_text` (find harus unik), `insert_after_heading`, `append_section`. Tidak ada `replace_section`, `append` ke dokumen, atau `insert_before` | `content.go:146` | Menulis/menyisipkan konten besar harus lewat satu argumen raksasa atau `find` yang sering tidak unik. |
| 6 | `create_document` menerima seluruh teks dalam satu argumen. Converter hanya paham heading dan paragraf, jadi daftar, kode, dan tabel jadi teks, dan baris digabung dengan spasi | `tools.go:318`, `markdown.go` | Konten banyak gagal (poin 1), dan hasilnya rusak walau berhasil. |
| 7 | Pesan error generik: `"The tool failed. Try another way or tell the User."`, `"The arguments are not valid JSON..."` | `chat.go:106-125` | Model tidak punya petunjuk perbaikan. Perilaku "tolong jelaskan lagi" muncul dari sini. |
| 8 | System prompt tidak punya aturan **bias bertindak**. Ada kalimat bahwa perubahan perlu persetujuan, tetapi tidak ada "jangan bertanya jika permintaan sudah jelas" | `chat.go:92-99` | Model menjadi terlalu hati-hati. |
| 9 | `maxAgentSteps = 8`, tanpa retry, tanpa ringkasan konteks, riwayat dipotong 20 pesan | `chat.go:23,188` | Tugas multi-bagian (dokumen panjang) kehabisan step lalu berhenti dengan "I stopped after too many steps". |
| 10 | Tool edit banyak aksi sekaligus dan tidak ada tool validasi hasil. Setelah edit tidak ada langkah verifikasi | `tools.go:492` | Kegagalan senyap tidak terdeteksi. |

Yang sudah baik dan perlu dipertahankan: executor sebagai satu pintu (izin + scope), version pinning dengan revision otomatis sebelum edit langsung, mode suggestion untuk Markdown, pending-action untuk persetujuan, hasil tool dibungkus sebagai data (anti prompt-injection), audit dan rate limit MCP.

## 2. Best practice dari sumber luar

**Tool design** ([Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))
- Buat sedikit tool berdampak tinggi yang cocok dengan alur kerja, bukan bungkus tiap endpoint.
- Respons yang bisa besar wajib punya pagination, rentang, filter, atau truncation dengan default wajar. Saat memotong, beri tahu agent cara mempersempit.
- Error harus spesifik dan actionable, dengan contoh input yang benar. Hindari kode buram.
- Nama parameter tidak ambigu, deskripsi ditulis seperti untuk anggota tim baru, dan skema divalidasi ketat.
- Ubah ID buram menjadi nama yang terbaca bila memungkinkan, dan beri opsi `response_format` concise/detailed.
- Iterasi deskripsi tool berbasis evaluasi.

**Context engineering** ([Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
- Konteks adalah sumber daya terbatas. Gunakan just-in-time retrieval (baca per bagian lewat tool), jangan memuat semuanya di awal.
- Pakai catatan terstruktur di luar konteks (progress/plan) dan ringkasan (compaction) untuk tugas panjang.

**Long-running harness** ([Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))
- Pecah pekerjaan besar menjadi daftar item terstruktur (JSON dengan status), kerjakan **satu per satu**, dan tulis progress sesudah tiap item.
- Verifikasi end-to-end sebelum menandai selesai. Agent cenderung mengumumkan selesai terlalu cepat.
- Pertahankan state bersih agar sesi berikutnya (atau retry) bisa melanjutkan.

**Output terpotong** ([Anthropic: Handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons))
- Jika `stop_reason == max_tokens` dan blok terakhir adalah tool call yang belum selesai, **jangan pakai output parsial**. Ulangi dengan budget lebih besar. Untuk OpenAI, setara dengan `finish_reason == "length"` atau `status == "incomplete"`.

**Edit dokumen besar**
- Model lebih baik mengirim perubahan (patch/find-replace) daripada menulis ulang seluruh dokumen. Batas output biasanya jauh lebih kecil daripada batas input ([ringkasan pola patch](https://github.com/theluk/llm-patcher)).
- Tiptap membaca dokumen besar per chunk (sekitar 32.000 karakter, struktur dijaga) dan agent berpindah antar chunk ([Tiptap: Read large documents](https://tiptap.dev/docs/content-ai/capabilities/agent/features/large-documents)).
- Tool edit exact-match harus menghasilkan pesan terpisah untuk "tidak ditemukan" dan "lebih dari satu kecocokan", disertai petunjuk perbaikan ([perbandingan 11 coding agent](https://arxiv.org/pdf/2609.00006), [Sweep: output normalization, gagal edit turun 38%](https://blog.sweep.dev/posts/jetbrains-coding-agent)). Gemini CLI memakai kaskade exact, lalu fuzzy, lalu "edit fixer" LLM.
- Catatan: sumber-sumber ini sekunder (blog/arXiv). Angka seperti "38%" berasal dari tulisan vendor masing-masing, bukan benchmark independen.

## 3. Rekomendasi (urut prioritas)

### P0: perbaiki kegagalan konten besar (kecil, dampak terbesar)
1. **Deteksi terpotong.** Parse `finish_reason`/`status`. Jika `length`/`incomplete`, atau `json.Valid(args)` false, **jangan ganti `{}`**. Kembalikan ke model hasil tool error: *"Output Anda terpotong sebelum argumen selesai. Kirim lebih kecil: satu bagian per panggilan (maks ~N kata)."* Tambahkan satu retry otomatis dengan budget lebih besar bila provider mendukung.
2. **Naikkan `max_completion_tokens`** (2000 terlalu kecil untuk tool call berisi dokumen). Jadikan konfigurasi per model (misalnya 8-16k), dan bedakan antara step jawaban dan step tool.
3. **Perbaiki `envelope`.** Letakkan metadata (`version`, `id`, `type`, `canEdit`) **sebelum** `content` (pakai struct berurutan, bukan `map`). Potong hanya field `content` pada batas heading/paragraf, dan tambahkan `truncated: true, nextOffset, totalChars` dengan petunjuk: *"panggil read_document dengan offset=..."*.
4. **Pesan error actionable** untuk semua `ToolError`. Contoh: untuk `find` tidak unik, sebutkan jumlah kecocokan dan sarankan menambah konteks; untuk operasi kosong, beri contoh JSON yang benar.

### P1: tool yang cocok untuk dokumen besar
5. `read_document` dengan `offset/limit` (atau `section`/`heading`), ditambah mode `outline` (daftar heading + jumlah karakter). Default: kembalikan outline bila dokumen lebih besar dari ambang.
6. Tambah operasi Markdown: `replace_section {heading, text}`, `append {text}`, `insert_before_heading`, `delete_section`. Semua boleh dikirim banyak dalam satu `operations`, tetapi dengan batas ukuran per panggilan.
7. **Pembuatan bertahap:** `create_document` hanya membuat kerangka (judul + heading), lalu agent mengisi per bagian dengan `append_section` / `replace_section`. Ini sejalan dengan pola "satu item per sesi" dan dengan batas output.
8. Perbaiki `MarkdownToContentJSON` agar mendukung list, code block, tabel, dan mempertahankan baris, atau pakai parser Markdown yang sudah dipakai editor. Tanpa ini, hasil konten besar tetap rusak.
9. Tool verifikasi ringan: setelah edit, harness mengembalikan ringkasan (jumlah karakter, heading yang berubah) atau agent diminta memanggil `read_document` mode outline untuk memeriksa.

### P1: perilaku agent (bias bertindak)
10. Tambahkan ke system prompt, kira-kira:
    - "Jika permintaan sudah menyebut dokumen dan perubahan yang jelas, **langsung lakukan**; jangan minta konfirmasi. Persetujuan user ditangani oleh sistem (suggestion/pending action), bukan oleh Anda."
    - "Tanya hanya jika ada ambiguitas yang mengubah hasil (beberapa dokumen cocok, atau tujuan tidak jelas). Ajukan **satu** pertanyaan spesifik dengan pilihan default."
    - "Untuk konten panjang: buat kerangka dulu, lalu isi per bagian. Satu bagian per panggilan."
    - "Jika tool gagal, baca pesan error, perbaiki, dan coba lagi sebelum melapor ke user."
11. Ganti pertanyaan terbuka dengan tool eksplisit `ask_user {question, options[]}` yang dihitung sebagai langkah terminal. Jadi bertanya adalah tindakan yang disengaja dan bisa diukur, bukan perilaku default.
12. `@[Title](doc:id)` dan dokumen aktif sudah masuk konteks. Baca otomatis (prefetch outline) di harness agar model tidak perlu satu step hanya untuk membaca.

### P2: ketahanan loop
13. **Plan/todo state** untuk tugas multi-bagian: tool `plan_update {items:[{title,status}]}` yang disimpan di run. Harness menyuntikkan plan terkini ke tiap step. Ini adaptasi langsung dari pola feature list JSON milik Anthropic.
14. Naikkan `maxAgentSteps` secara adaptif (misalnya 8 untuk tanya jawab, 25-40 untuk mode edit/penulisan), dan saat batas tercapai simpan progress serta tawarkan "lanjutkan" daripada hanya berhenti.
15. Retry dengan backoff untuk error provider sementara, deteksi loop (tool call identik berulang berurutan menghentikan loop dan memberi tahu model), dan kompaksi riwayat tool lama (ringkas hasil `read_document` lama menjadi stub).
16. Rangkum konteks: riwayat saat ini dipotong 20 pesan secara buta. Ganti dengan ringkasan pesan lama.

### P2: evaluasi dan observabilitas
17. Bangun **eval set** (di `cmd/rageval` sudah ada kerangka): 20-30 skenario seperti "buat dokumen 3000 kata", "edit 5 bagian", "ganti judul di dokumen 50 halaman", "perintah jelas, tidak boleh bertanya". Ukur success rate, jumlah step, jumlah pertanyaan balik, dan token. Gunakan sebagai gerbang regresi tiap mengubah prompt/tool.
18. Catat per run: `finish_reason`, panjang argumen, alasan error tool, dan jumlah retry. Data `ai_run_events` yang sudah ada cukup sebagai tempatnya.

## 4. Urutan kerja yang disarankan
1. PR kecil: poin 1-4 (deteksi terpotong, naikkan budget, perbaiki envelope, error actionable) + poin 10 (prompt). Seharusnya menghilangkan sebagian besar gejala yang dilaporkan.
2. PR berikutnya: poin 5-9 (tool baca/tulis bertahap, converter Markdown).
3. Lalu poin 11, 13-16, dan eval set (17-18) sebagai pengaman.

## 5. Batasan riset ini
- Kode dibaca statis, belum dijalankan. Hubungan poin 1-2 dengan gejala "gagal" adalah kesimpulan dari kode dan perlu direproduksi dengan satu skenario sebelum diperbaiki.
- Belum dicek model/provider mana yang aktif di produksi (batas output berbeda antar model), dan belum dicek isi `collab` (penerapan operasi di room).
- Sumber eksternal untuk edit dokumen besar sebagian besar sekunder.

## 6. Status implementasi (branch `claude/awesome-noether-u74g9p`)

Dikerjakan: poin 1-4 (deteksi terpotong di jalur streaming dan non-streaming, budget output 8k dengan retry sampai 32k, envelope dengan hint, error actionable), 5 (`read_document` offset/limit/outline, `version` sebelum `content`), 6 (`append`, `insert_before_heading`, `replace_section`, `delete_section`, termasuk mode suggestion), 7 (panduan bertahap di deskripsi tool dan prompt), 10-11 (bias bertindak, tool `ask_user`), 13-16 (`plan_update`, batas langkah adaptif 10/30, deteksi loop, retry provider, stub hasil tool lama, ringkasan riwayat lama). Poin 17-18 dicakup oleh test skenario di `harness_test.go`; eval berbasis model sungguhan belum dibuat.

Belum dikerjakan:
- Poin 8 (converter Markdown untuk list/kode/tabel): skema editor punya tipe node sendiri (`list_item`, `code_block`, dst.) yang perlu dipetakan bersama frontend; salah petakan merusak dokumen. Dibiarkan seperti semula.
- Poin 9 (tool verifikasi pasca-edit): hasil edit sudah mengembalikan versi baru; `read_document` mode outline bisa dipakai untuk memeriksa.
- Poin 12 (prefetch outline otomatis) dan eval dengan model nyata.
