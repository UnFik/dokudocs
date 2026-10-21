# Fix with AI: AI membaca error editor DBML dan Mermaid

Status: rencana, belum diimplementasikan. Berkaitan dengan [ai-chat-panel.md](ai-chat-panel.md) (composer dan `extras` pertanyaan), [dbml-mermaid-collaboration.md](dbml-mermaid-collaboration.md) (binding Yjs editor sumber), dan [ai-response-format.md](ai-response-format.md).

## Masalah

User bertanya "coba kamu baca error dari editor", tetapi AI menjawab "Error apa yang dimaksud?". Contoh nyata: error `Invalid column definition or missing type` yang tampil di editor tidak pernah sampai ke AI.

## Kondisi awal (diverifikasi di kode)

- `frontend/src/features/docs/lib/monaco-diagnostics.ts`: `validateDbml` dan validasi Mermaid menghasilkan `DiagnosticMarker` (`startLineNumber`, `startColumn`, `endLineNumber`, `endColumn`, `message`, `severity`), lalu dipasang lewat `setModelMarkers`. Marker hanya ada di memori browser.
- `frontend/src/features/rag/use-chat-run.ts`: `startChatRun` mengirim `question`, `language`, `publicLinkTokens`, `categoryIds`, `contextChatIds`, `attachments`. Tidak ada field untuk keadaan editor.
- Server membaca isi dokumen dari database, tetapi tidak punya hasil validasi karena validasi berjalan di klien.
- Belum ada `registerCodeActionProvider`, jadi lampu kuning dan menu `Ctrl+.` di editor sumber kosong.
- `attachments` tidak cocok dipakai: dibungkus sebagai konten tak tepercaya, batas ukuran, dan dimaksudkan untuk file User.

## Keputusan

1. **Klien yang mengirim error, server tidak memvalidasi ulang.** Parser DBML dan Mermaid ada di klien; menduplikasinya di Go mahal dan bisa berbeda hasilnya. Server memperlakukan isi kiriman sebagai data tak tepercaya.
2. **Field baru `editorContext` di body run chat**, terpisah dari `attachments`:
   `{ documentId, kind: 'dbml' | 'mermaid', diagnostics: [{ line, column, endLine, endColumn, severity, message }], cursor: { line, column }, excerpt: { fromLine, toLine, text } }`.
   Batas: maksimal 20 diagnostik, `message` 500 karakter, `excerpt` 8.000 karakter. Melebihi batas dipotong di klien dan ditolak di server.
3. **Server mencocokkan `documentId` dengan dokumen yang sedang dibuka percakapan itu dan hak baca User.** Isi `excerpt` hanya dipakai sebagai petunjuk posisi; untuk jawaban, agen tetap membaca versi dokumen dari server (satu sumber kebenaran). Bila `excerpt` berbeda dari server, diagnostik tetap dikirim dengan catatan "editor memuat perubahan yang belum tersimpan".
4. **Prompt sistem** menerima blok `editor_diagnostics` yang dibungkus penanda konten tak tepercaya (aturan injeksi prompt agent #16 berlaku). Aturan: bila User menanyakan error atau meminta perbaikan, gunakan blok ini sebelum bertanya balik. Bila blok kosong, katakan editor tidak melaporkan error, jangan menebak.
5. **Dua pintu masuk di UI:**
   - **Fix with AI** di `registerCodeActionProvider` untuk bahasa `dbml` dan `mermaid`. Muncul hanya di marker `Error` dan `Warning` pada posisi cursor, juga lewat `Ctrl+.`. Memilihnya membuka panel chat, mengisi pertanyaan "Perbaiki error ini: …", dan mengirim `editorContext` dengan diagnostik pada cursor di urutan pertama.
   - **Konteks otomatis**: setiap pertanyaan dari panel dokumen DBML atau Mermaid ikut membawa `editorContext` (sebagai `extras`), sehingga "coba baca error editor" bekerja tanpa klik tambahan. Dokumen Markdown tidak mengirimnya.
6. **Hasil perbaikan: tahap 1 hanya saran di chat.** AI membalas dengan penjelasan singkat dan blok kode DBML atau Mermaid yang sudah diperbaiki. User menerapkannya sendiri. Penerapan satu klik memakai edit lewat `y-monaco` (bukan `setValue`, agar kolaborator tidak kehilangan edit); itu tahap 2 dan butuh keputusan terpisah, termasuk pratinjau diff.
7. **Pemakaian token tetap dihitung** ke limit (ADR-0048); tidak ada jalur khusus.

## Pengerjaan: satu worktree, satu branch (`feat/ai-fix-editor-errors`), satu PR ke `main`, commit berurutan

Tanpa atribusi Claude. Worktree baru dari `origin/main`, jangan pindah branch di checkout bersama, jangan `git stash` atau `reset --hard`. TDD per slice. Tunggu CI lewat cron.

1. **Backend**: terima dan validasi `editorContext` di endpoint mulai run (batas, kecocokan dokumen, hak baca); teruskan ke pembangun prompt sebagai blok tak tepercaya. Tes: dokumen salah ditolak, melebihi batas ditolak, blok masuk ke prompt, blok kosong tidak menambah apa pun.
2. **Prompt agen**: aturan "pakai `editor_diagnostics` dulu", dengan tes evaluasi atas pertanyaan seperti pada laporan ("coba kamu baca error dari editor").
3. **Frontend, pengumpul konteks**: fungsi murni yang mengubah marker model Monaco + cursor menjadi `editorContext` (urut: pada cursor dulu, lalu error lain, dipotong sesuai batas). Tes unit tanpa Monaco.
4. **Frontend, pengiriman**: `QuestionExtras` dan `startChatRun` membawa `editorContext`; panel dokumen DBML dan Mermaid mengisinya dari editor yang aktif. Markdown tidak berubah.
5. **Frontend, Fix with AI**: `registerCodeActionProvider`, pembukaan panel dengan pertanyaan terisi, dan tes browser (fokus keyboard, `Ctrl+.`, marker hilang saat error sudah diperbaiki).
6. **Dokumen dan gerbang**: perbarui `CONTEXT.md` bila ada istilah baru, E2E untuk kasus pada laporan, Delivery Gate antislop (`DESIGN.md`, `antislop-ui`, `antislop-human`).

## Risiko yang dijaga

- Diagnostik berisi teks yang berasal dari isi dokumen (pesan error bisa memuat nama tabel milik User): diperlakukan sebagai konten tak tepercaya, bukan instruksi.
- Editor dan server berbeda versi (perubahan belum tersimpan atau kolaborator baru mengedit): dicatat di keputusan #3, AI diberi tahu alih-alih diam-diam memakai salah satunya.
- Marker basi: `editorContext` diambil saat Send ditekan, bukan saat panel dibuka.
- Dokumen besar: `excerpt` dibatasi di sekitar error, bukan seluruh dokumen.

## Di luar cakupan

- Penerapan perbaikan satu klik dan diff inline (tahap 2).
- Validasi DBML atau Mermaid di server.
- Fix with AI untuk dokumen Markdown atau Architecture.
