# Rencana tipe diagram di luar Mermaid, DBML, dan Architecture

Status: draft, belum disetujui. Tidak ada kode yang diubah. Keputusan akhir dicatat sebagai ADR di `docs/adr`.

## Latar belakang

Dokudocs punya empat tipe dokumen: `markdown`, `dbdiagram`, `mermaid`, `architecture`. Perbandingan dengan skill _diagram-design_ (sekitar 44–45 tipe diagram dalam satu gaya editorial) menunjukkan tipe yang belum tertangani, misalnya swimlane, pyramid/funnel, radar, venn, waterfall, heatmap, treemap, fishbone, wardley, dan org chart.

Skill itu menghasilkan satu file HTML dengan SVG inline. Dokudocs menyimpan dokumen sebagai Yjs state atau teks, jadi tidak ada tempat untuk "HTML bebas" tanpa keputusan baru. Rencana ini memisahkan tiga jalur dari yang paling murah.

## Kapabilitas yang dituju

Artifact Claude punya kapabilitas runtime yang harus dideklarasikan halaman. Padanannya di Dokudocs:

| Kapabilitas artifact | Padanan di Dokudocs | Status |
| --- | --- | --- |
| State bersama antar pemirsa | Body Yjs lewat Hocuspocus (ADR 0029, 0033) | Ada |
| Tahu siapa yang melihat | Presence dan kursor (awareness Yjs) | Ada di editor |
| Tanya Claude dari halaman | Tool Agent/MCP (ADR 0043, 0044) | Ada di branch `feat/ai-agent-mcp`, belum di `main` |
| Memberi file untuk disimpan | Ekspor SVG/PNG/JSON | Hanya Architecture |
| Riwayat versi | Revisi dokumen | Ada |
| Tipe siap pakai yang hanya menerima data | Renderer per `kind` (jalur 2) | Belum ada |

## Fase 0: spike Mermaid (kira-kira 1 hari)

Cek tipe diagram Mermaid apa yang aktif di versi terpasang (`^11.17.0`): xychart, radar, treemap, block, dan lainnya. Hasilnya menentukan isi jalur 2. Tipe yang sudah tertangani Mermaid tidak perlu renderer sendiri.

### Hasil spike ([#179](https://github.com/UnFik/dokudocs/issues/179))

Diuji pada Mermaid 11.17.2 (terpasang dari `^11.17.0`), di Chromium headless. Tiap tipe diparse (`mermaid.parse`), dirender dengan tema bawaan terang (`default`) dan gelap (`dark`), lalu SVG-nya dimuat sebagai gambar dan digambar ke canvas, seperti jalur ekspor PNG di dialog ekspor. Tema Dokudocs ([#176](https://github.com/UnFik/dokudocs/issues/176)) belum dipakai pada pengujian ini.

Kata kunci tiap tipe diambil dari detektor di paket Mermaid, bukan dari dokumentasi. Contoh sintaks untuk tipe baru ditulis dari tata bahasa yang terpasang, jadi hanya sebagian yang diverifikasi lewat render.

| Tipe | Kata kunci | Parse + render terang/gelap | Ekspor PNG lewat canvas | Dikenali editor |
| --- | --- | --- | --- | --- |
| xychart (bar/line) | `xychart-beta` | ya | ya | ya |
| quadrant | `quadrantChart` | ya | ya | ya |
| sankey | `sankey-beta` | ya | ya | ya |
| packet | `packet-beta` | ya | ya | ya |
| architecture | `architecture-beta` | ya | ya | ya |
| timeline | `timeline` | ya | ya | ya |
| gitGraph | `gitGraph` | ya | ya | ya |
| block | `block-beta` | ya | **gagal** | ya |
| kanban | `kanban` | ya | **gagal** | ya |
| mindmap | `mindmap` | ya | **gagal** | ya |
| journey | `journey` | ya | **gagal** | ya |
| flowchart | `flowchart` | ya | **gagal** | ya |
| radar | `radar-beta` | ya | ya | **tidak** |
| treemap | `treemap` (juga `treemap-beta`) | ya | ya | **tidak** |
| venn | `venn-beta` | ya | ya | **tidak** |
| wardley | `wardley-beta` | ya | ya | **tidak** |
| ishikawa (fishbone) | `ishikawa-beta` | ya | ya | **tidak** |
| cynefin | `cynefin-beta` | ya | ya | **tidak** |
| tree view | `treeView-beta` | ya | ya | **tidak** |
| swimlane | `swimlane-beta` | ya (sintaks mirip flowchart dengan `subgraph`) | belum diuji | **tidak** |
| railroad | `railroad-ebnf-beta` (juga `-abnf-`, `-peg-`) | ya (EBNF); sintaks pendek lain ditolak | belum diuji | **tidak** |
| event modeling | `eventmodeling` | ya | **gagal** | **tidak** |
| requirement | `requirementDiagram` | ya | **gagal** | **tidak** |
| C4 | `C4Context` | ya | ya | **tidak** |
| ZenUML | - | tidak ada | - | - |

Catatan:

- **Ekspor PNG.** Diagram yang memakai `foreignObject` untuk label (flowchart, mindmap, journey, block, kanban, event modeling, requirement) gagal digambar ke canvas pada SVG mentahnya. Ini bukan masalah tipe baru: flowchart ikut terkena. [#177](https://github.com/UnFik/dokudocs/issues/177) harus menangani ini (mis. `htmlLabels: false` untuk jalur ekspor), atau ekspor PNG hanya benar untuk sebagian tipe.
- **Editor.** Validasi di Monaco memakai `mermaid.parse`, jadi semua tipe di atas sudah divalidasi. Yang belum ada adalah daftar kata kunci di tiga tempat: `monaco-setup.ts` (highlight), `mermaid-tokenizer.ts` (`DIAGRAM_TYPES`), dan `mermaid-intellisense.ts` (templat dan saran).
- **Beta.** Semua kata kunci berakhiran `-beta` dapat berubah antar versi minor. [#180](https://github.com/UnFik/dokudocs/issues/180) perlu mengunci versi Mermaid dan mencatat tipe mana yang beta.
- **Belum diperiksa.** Kontras warna tiap tipe di mode terang/gelap belum dilihat secara visual; yang dicek hanya bahwa render berhasil. Ini dikerjakan bersama [#180](https://github.com/UnFik/dokudocs/issues/180) setelah tema Dokudocs masuk.

#### Masukan untuk #178

Dari daftar usulan awal (swimlane, pyramid/funnel, radar, venn, waterfall, heatmap, treemap, fishbone, wardley, org chart), Mermaid terpasang sudah menangani **swimlane, radar, venn, treemap, fishbone, dan wardley**. Yang tetap belum tertangani: **pyramid/funnel, waterfall, heatmap, dan org chart** (`funnel`, `pyramid`, `waterfall`, `heatmap`, `orgchart` tidak dikenali). Daftar `kind` untuk tipe `diagram` sebaiknya dimulai dari keempat ini, dan hanya bila ada bukti kebutuhan.

## Jalur 1: perluas yang ada (tanpa migrasi)

1. Tema Mermaid selaras design system ([#176](https://github.com/UnFik/dokudocs/issues/176)).
2. Ekspor SVG/PNG Mermaid ([#177](https://github.com/UnFik/dokudocs/issues/177)).
3. Tipe Mermaid baru yang lolos spike: template, daftar di editor, highlight sintaks.
4. Bentuk "layer" dan "nested" lewat Group di Architecture, jika kanvasnya cukup.

Kolaborasi, presence, versi, dan RAG tetap berjalan karena dokumen Mermaid sudah punya semuanya.

## Jalur 2: tipe dokumen `diagram` dengan body terstruktur

Dikerjakan setelah ADR disetujui ([#178](https://github.com/UnFik/dokudocs/issues/178)).

- Body: amplop JSON `{ kind, schemaVersion, data }`.
- Penyimpanan kolaboratif: teks sumber di Yjs seperti DBML dan Mermaid (ADR 0033). Alternatif `Y.Map` terstruktur lebih halus untuk konflik tetapi jauh lebih mahal; diputuskan di ADR.
- Registry renderer per `kind`: `{ schema, render(data, theme) -> SVG, summarize(data) -> teks, anchors(data) -> id elemen }`.
- Validasi: backend memeriksa amplop dan batas ukuran; schema tiap `kind` berada di satu tempat bersama.
- Editor: panel teks/JSON dan preview langsung; form per `kind` menyusul.
- Kapabilitas: presence dari editor teks, komentar per elemen lewat `anchors()`, RAG lewat `summarize()`, ekspor SVG/PNG/JSON, Agent hanya baca di tahap awal.

Urutan: ADR, migrasi enum `document_type` dan union `DocType`, satu `kind` pembuktian (swimlane atau waterfall), editor/ekspor/komentar/RAG, lalu tambah `kind` satu per satu.

## Jalur 3: tipe dokumen `html` dengan sandbox seperti artifact

Risiko utama adalah kode pengguna berjalan di domain Dokudocs, jadi isolasi harus selesai sebelum fitur.

Isolasi:

- Render di `<iframe sandbox="allow-scripts">` tanpa `allow-same-origin`, sehingga origin-nya opak.
- Sajikan dari origin terpisah (mis. `usercontent.<domain>`), bukan domain aplikasi.
- CSP ketat: skrip hanya dari allowlist CDN dengan versi dikunci, stylesheet hanya dari Google Fonts, `connect-src 'none'`, `form-action 'none'`.
- Batas ukuran dan gambar disematkan sebagai `data:`.

Kapabilitas lewat jembatan `postMessage` yang memeriksa akses dokumen pada setiap panggilan:

| Kapabilitas | Cara |
| --- | --- |
| Menyimpan state | `dokudocs.state.get/set`, blob kecil per dokumen, diberi versi |
| Tahu siapa yang melihat | `dokudocs.viewer` (nama dan peran saja) |
| Tema terang/gelap | variabel CSS diinjeksi ke iframe |
| Memberi file untuk disimpan | `dokudocs.download(blob, nama)` dari klik pengguna |
| Tanya Claude/Agent | `dokudocs.ask()`, hanya baca, lewat izin AI pengguna (ADR 0044) |

Kapabilitas tanpa deklarasi tidak aktif.

Siklus hidup: body berupa teks HTML di Yjs; RAG membaca teks hasil ekstraksi tanpa menjalankan HTML; Agent tidak boleh menulis di tahap awal; ekspor berupa HTML mandiri. Jangan buka untuk public link sampai origin terpisah tersedia di deployment.

## Jalur pendamping: lampiran SVG/gambar di Markdown

Untuk gambar statis. Unggah sebagai aset, sanitasi SVG di server (buang `script`, `foreignObject`, event handler, referensi eksternal), sajikan dengan CSP dan tampilkan hanya lewat `<img>`, tidak pernah inline.

## Urutan keseluruhan

| Tahap | Pekerjaan | Issue | Bergantung pada |
| --- | --- | --- | --- |
| 0 | Spike tipe Mermaid yang aktif | [#179](https://github.com/UnFik/dokudocs/issues/179) | - |
| 1a | Tema Mermaid selaras design system | [#176](https://github.com/UnFik/dokudocs/issues/176) | - |
| 1b | Ekspor Mermaid ke SVG/PNG | [#177](https://github.com/UnFik/dokudocs/issues/177) | #176 (disarankan) |
| 1c | Tipe Mermaid baru (template, sintaks) | [#180](https://github.com/UnFik/dokudocs/issues/180) | #179, #176, #177 |
| 2a | ADR tipe `diagram` terstruktur | [#178](https://github.com/UnFik/dokudocs/issues/178) | #179 (menentukan daftar `kind`) |
| 2b | ADR keamanan tipe `html` | [#181](https://github.com/UnFik/dokudocs/issues/181) | - |
| 3a | Implementasi `diagram`: migrasi, registry, satu `kind` pembuktian, lalu `kind` lain | dibuat setelah #178 disetujui | #178, #176, #177 |
| 3b | Implementasi `html`: origin terpisah, sandbox, jembatan `postMessage` | dibuat setelah #181 disetujui | #181 |
| paralel | Lampiran SVG/gambar disanitasi | [#182](https://github.com/UnFik/dokudocs/issues/182) | - |

Urutan kerja:

1. Mulai dari tahap 0, 1a, dan lampiran SVG secara paralel. Ketiganya tidak saling bergantung.
2. Lanjut ke 1b, lalu 1c setelah spike dan tema selesai.
3. Tulis ADR 2a dan 2b setelah hasil spike ada. Keduanya bisa ditulis paralel.
4. Implementasi 3a dan 3b dimulai hanya setelah ADR-nya disetujui. Tipe `html` bisa mendahului `diagram` bila ADR keamanannya selesai lebih dulu, tetapi jangan dibuka untuk public link sebelum origin terpisah tersedia.
5. Integrasi Agent/MCP menunggu keputusan merge `feat/ai-agent-mcp`.

## Risiko

- Cakupan jalur 2 membengkak: mulai dari satu `kind`, tambah tipe hanya dengan bukti kebutuhan.
- Agent belum di `main`: integrasi Agent/MCP menunggu keputusan merge `feat/ai-agent-mcp`.
- Sanitasi SVG dan konfigurasi CSP mudah keliru: pakai sanitizer yang teruji dan test dengan payload berbahaya yang dikenal.
- Jalur 3 butuh domain konten terpisah, TLS, dan pengaturan CSP di deployment.

## Issue terkait

- [#176](https://github.com/UnFik/dokudocs/issues/176) tema Mermaid
- [#177](https://github.com/UnFik/dokudocs/issues/177) ekspor Mermaid
- [#178](https://github.com/UnFik/dokudocs/issues/178) spec tipe `diagram`
