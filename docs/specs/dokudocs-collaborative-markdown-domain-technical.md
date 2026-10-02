# Spesifikasi domain dan teknis kolaborasi Markdown

Status: kontrak produk disepakati; implementasi menunggu gate G0–G5
Terkait: [rencana refactor dan milestone](../plans/dokudocs-ltree-collaborative-refactor.md), [gate eksekusi tunggal](../plans/dokudocs-refactor-gap-closure.md), [arsitektur](../architecture/dokudocs-collaborative-markdown.md), [ADR AST kanonis](../adr/0002-canonical-markdown-ast.md), [ADR pola Outline/Yjs](../adr/0003-outline-yjs-tree-and-relational-projection.md), [ADR akses](../adr/0005-document-access-policy.md), [ADR serialisasi revoke](../adr/0011-access-revocation-serialization.md), [ADR structural command](../adr/0012-movenode-owns-existing-node-structure.md), [ADR schema offline](../adr/0013-preserve-pending-edits-across-schema-mismatch.md), [ADR track changes](../adr/0006-track-changes-outside-canonical-body.md), [ADR receipt MoveNode](../adr/0009-durable-movenode-receipts.md), [ADR offline restart](../adr/0010-offline-restart-contract.md), [ADR epoch MoveNode](../adr/0014-structural-moves-start-body-epoch.md)
Tanggal: 2026-09-27

## 1. Tujuan dan batas produk

Dokumen ini menentukan model domain, aturan yang tidak boleh dilanggar, kontrak modul, storage PostgreSQL, alur realtime, dan migrasi untuk kolaborasi Markdown. LTree adalah optimasi opsional yang memerlukan bukti query/benchmark.

### Dalam scope

- Markdown Dokudocs diedit bersama online dan offline melalui browser; perubahan lokal bertahan di IndexedDB sampai server mengonfirmasi commit durable. Dokumen existing yang body dan app shell-nya sudah tersimpan dapat dibuka lagi lewat URL setelah browser restart selama AccessToken lokal belum kedaluwarsa.
- Kolaborasi berbasis CRDT Yjs-compatible. Runtime Go atau Node ditentukan melalui spike.
- Format aplikasi Markdown berupa AST dengan node blok/container dan run inline. Editor kolaboratif mengikuti pola Outline: schema tree ProseMirror terikat pada shared types Yjs; state itu diproyeksikan ke AST relasional Dokudocs.
- Pengalaman editor mempertahankan view, editor, dan suggestion pada model bersama; Muya boleh diganti bila spike integrasi gagal. Suggestion adalah track changes yang diterima/ditolak, bukan mutasi body langsung. Tidak ada editor source Markdown mentah sebagai jalur tulis produk; Markdown tetap format impor/ekspor.
- Gunakan model izin Dokudocs yang ada, tetapi perbaiki effective read/write policy agar visibility, grant, draft, lifecycle, dan workspace diterapkan sama di semua jalur. Pertahankan komentar/thread, reply, resolve, revision, dan restore.
- PostgreSQL menyimpan AST dan state CRDT secara durable; Redis menyampaikan perubahan antar-instance. IndexedDB menyimpan state lokal/pending update. Redis bukan durability layer.
- AST mempertahankan stable node IDs dan body version yang kelak dapat diproyeksikan untuk RAG. Chunking, retrieval, citation, dan acceptance RAG berada di G5, bukan gate cutover AST.
- AI authoring dan typed suggestion adalah tahap terpisah; bukan deliverable G0–G3.
- Availability dan scalability tinggi menjadi tujuan produksi. Angka capacity/SLO belum ada dan menjadi gerbang sizing/load/failover sebelum rilis.

### Di luar scope

- DBML dan Mermaid menjadi AST atau mendapat kolaborasi realtime.
- Presence/cursor pada milestone sinkronisasi isi pertama.
- Membangun embedding, vector database, dan layanan RAG saat refactor ini.
- Eksekusi AI tanpa preview/persetujuan manusia.
- Mengganti entitas workspace, project, user, atau tabel document access yang sudah ada; aturan evaluasi aksesnya perlu diperbaiki.
- Event sourcing penuh atau append-only CRDT operation log pada fase awal.

## 2. Bahasa domain

| Istilah               | Arti domain                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dokumen Markdown      | Dokumen Dokudocs dengan `type=markdown`, metadata workspace/project dan effective document access policy, serta body yang dapat diimpor/diekspor sebagai Markdown.                                                                    |
| Document Body         | Isi Markdown terstruktur sebagai root dan node turunannya. Ini bagian dari Document, bukan dokumen terpisah.                                                                                                                          |
| Document Node         | Bagian bernama dan beridentitas stabil dalam Document Body: blok, container, atau run inline. Node menyimpan parent, sibling order, type, dan payload yang sesuai.                                                                    |
| Node Path             | Representasi turunan opsional untuk query subtree; `parent_id` dan sibling order tetap menentukan struktur.                                                                                                                           |
| Collaborative Session | Periode saat satu atau lebih User berizin mengedit Document Body yang sama online; state offline lokal disinkronkan saat tersambung kembali.                                                                                          |
| Editor Mode           | Cara view, editor, atau suggestion menampilkan Document Body melalui schema bersama; suggestion membuat usulan di luar body sampai diterima. Engine visual dapat berubah tanpa mengubah kemampuan produk.                             |
| Pending Offline Edit  | Perubahan CRDT yang tersimpan di IndexedDB tetapi belum mendapat server ACK atas commit PostgreSQL.                                                                                                                                   |
| Body Version          | Nomor monotonik Dokudocs untuk setiap perubahan CRDT baru yang menjadi durable; retry duplikat tidak menaikkan versi.                                                                                                                 |
| Comment Thread        | Percakapan pada satu rentang isi dokumen, memiliki komentar pembuka, reply, dan state resolve.                                                                                                                                        |
| Comment Anchor        | Referensi stabil dari Comment Thread ke rentang pada body. Anchor dapat menjadi orphan jika isi yang dirujuk dihapus atau tidak dapat di-resolve.                                                                                     |
| Document Revision     | Snapshot Document Body pada satu versi. Named revision immutable sejak dibuat; autosnapshot boleh dicoalesce selama window 10 menit lalu menjadi immutable. Restore membuat state baru dan tidak mengubah revision yang sudah sealed. |
| Accepted Edit         | Update CRDT yang sudah lolos otorisasi/validasi dan commit state CRDT serta AST-nya di PostgreSQL. ACK berarti edit sudah durable.                                                                                                    |
| Suggestion            | Usulan teks, format, atau struktur blok terhadap Document Body; punya pengusul, basis versi, target node, dan status. Hanya acceptance yang menjadi Accepted Edit.                                                                    |

## 3. Peta domain dan kepemilikan

```mermaid
flowchart TD
  U[User] -->|membership/access| D[Document]
  D --> B[Document Body]
  B --> R[Root Node]
  R --> N[Document Node tree]
  D --> S[Document Revision]
  D --> T[Comment Thread]
  T --> P[Comment Reply]
  T --> A[Comment Anchor]
  D -. active online session .-> C[Collaborative Session]
  C --> E[Participants + Muya modes]
  D --> RAG[Future RAG projection (G5)]
```

### Aggregate roots

**Document aggregate** tetap memakai identitas `documents.id` yang ada. Ia memiliki metadata dan Document Body. Perubahan node yang perlu invariant lintas node dijalankan sebagai satu command/transaksi terhadap Document, bukan update SQL lepas per node.

**Comment Thread aggregate** memiliki komentar pembuka, reply, resolve state, dan anchor. Ia mereferensikan `document_id` serta `node_id`; ia tidak memiliki Document Node. Menghapus node target tidak menghapus thread.

**Document Revision** adalah snapshot milik Document. Named revision immutable sejak dibuat; autosnapshot terbuka dapat dicoalesce selama window 10 menit dan menjadi immutable setelah window/sesi ditutup. Restore menghasilkan edit/current revision baru.

**Collaborative Session** bersifat ephemeral. Ia tidak menjadi tabel konten durable. Runtime menyimpan koneksi dan data routing sementara; editor mode bukan lease/sumber kebenaran. Redis hanya diperlukan untuk fan-out lintas instance. PostgreSQL tetap menjadi sumber body durable.

UI view/editor/suggestion berbagi model visual yang sama. Source Markdown mentah tersedia melalui import/export, bukan mode tulis produk. Usulan disimpan terpisah dari body; preview usulan tidak boleh menulis AST/Yjs sebelum acceptance.

### Relationship dan kardinalitas

- Document 1 — 1 Document Body; Body mempunyai satu root node.
- Document Node 0..1 parent — 0..n child; graph harus berupa pohon tanpa cycle.
- Document 1 — 0..n Document Revision.
- Document 1 — 0..n Comment Thread; thread memiliki 0..n reply dan paling banyak satu rentang anchor aktif.
- Document 0..1 Collaborative Session aktif; session mempunyai 1..n participant selama aktif.
- User tidak disalin ke sistem permission baru. Membership, workspace/project role, visibility, dan `document_accesses` tetap mengatur akses.

## 4. Bentuk Document Body

Tree menyimpan struktur Markdown yang dapat diedit, bukan satu node per kata. Batas node teks adalah pergantian format, hyperlink, atau inline object.

### Node taxonomy

**Root/container:** root, block quote, list (ordered/bullet/task), list item, table, table row, footnote container. Container tidak menyimpan teks run.

**Block/leaf:** paragraph, ATX/setext heading, thematic break, code block, HTML block, table cell, math block, frontmatter, embedded diagram block, raw/opaque Markdown block untuk syntax yang belum dapat dinormalisasi dengan aman.

`raw/opaque` menyimpan source Markdown persis seperti saat impor. Editor menampilkannya sebagai blok baca saja; operasi teks, format, dan `MoveNode` yang menargetkan blok itu ditolak sampai adapter membuktikan round-trip aman. Pengguna tetap dapat mengedit blok lain dalam dokumen yang sama. Exporter menulis ulang bytes blok opaque tanpa normalisasi; kegagalan mempertahankan bytes menahan cutover dokumen itu.

Server melindungi invariant ini setelah merge, bukan hanya lewat UI. Bandingkan AST committed sebelum merge dengan AST hasil projection update. Setiap OpaqueNode yang sudah ada harus mempertahankan `node_id`, tipe, source bytes persis, serta jalur struktural penuh: parent dan urutan relatif tiap node pada jalur dari root terhadap sibling lama yang masih ada. Perubahan isi/identitas/tipe, penghapusan, reorder, reparent, atau perpindahan ancestor menolak seluruh transaksi tanpa commit, ACK, atau broadcast. Pergeseran ordinal akibat insert/delete sibling biasa tidak dianggap move bila urutan relatif node lama tetap sama. Edit blok biasa dan insert blok baru tetap boleh. Penghapusan node opaque ditolak; penghapusan node existing biasa harus melalui `DeleteNode` agar epoch lama dipagari. `ImportMarkdown` dan `RestoreRevision` adalah penggantian body eksplisit; keduanya tetap harus lulus validasi parse/round-trip milik command masing-masing.

**Inline:** text run dengan `attributes` marks seperti bold/italic/strike/code; link run dengan URL/title; inline image/object node dengan metadata sumber. Text kosong tidak boleh dibuat menjadi run normal, tetapi empty document dan empty paragraph tetap merupakan state yang sah.

Taxonomy ini harus dicocokkan dengan parser Muya yang ada, termasuk `paragraph`, heading ATX/setext, code fence dan info string verbatim, list bersarang/task list, table, HTML, math, frontmatter, diagram, dan footnote. Parser/exporter tidak boleh menghilangkan whitespace atau metadata format yang belum dipahami.

Contoh domain body untuk `**Dokudocs** berjalan`:

```json
{
  "type": "root",
  "children": [
    {
      "id": "paragraph-id",
      "type": "paragraph",
      "children": [
        {
          "id": "run-bold-id",
          "type": "run",
          "text": "Dokudocs",
          "attributes": { "bold": true }
        },
        {
          "id": "run-plain-id",
          "type": "run",
          "text": " berjalan",
          "attributes": {}
        }
      ]
    }
  ]
}
```

Contoh ini menunjukkan domain shape saja. Node type final dan aturan inline harus berasal dari grammar Muya/editor terpilih; jangan memaksa semua leaf menjadi generic `RUN`.

### Aturan ID dan perubahan struktur

- `node_id` adalah identitas permanen node selama makna node tetap ada; UUID baru untuk node baru.
- Reorder/reparent tidak mengganti node ID.
- Split run mempertahankan ID pada segmen yang masih memiliki identity kontinuitas; segmen tambahan mendapat ID baru. Adapter wajib memetakan relative positions dan anchor saat transform ini.
- Merge node tidak boleh menghapus identity yang masih dirujuk anchor tanpa memindahkan posisi secara terverifikasi atau menandai anchor orphan.
- Delete node menandai seluruh anchor terdampak sebagai orphan di transaksi yang sama; thread/reply tetap ada.
- Ganti judul heading tidak mengganti node ID dan tidak mengubah label path.
- Jika LTree kelak diadopsi, label `node_path` dibuat dari node ID; jangan memakai title/slug atau posisi sibling.

### Invarian body

1. Satu root per dokumen Markdown; root tidak punya parent. Root boleh membawa atribut internal `trailingWhitespace` untuk suffix, `sourceGaps` untuk separator antarblok, dan `sourceTables` untuk bytes syntax tabel sumber. Metadata memakai node ID stabil. Serializer hanya memakai `sourceTables` jika tabel saat ini masih setara secara semantik dengan tabel sumber; setelah isi berubah ia menserialisasi AST terbaru. Metadata internal tidak ditampilkan sebagai konten editor.
2. Setiap non-root memiliki parent dalam dokumen yang sama.
3. Tidak ada cycle. Node type harus cocok dengan hubungan parent/child yang diizinkan grammar AST.
4. Run hanya berada pada parent yang menerima inline content; block tidak menyimpan inline marks sebagai atribut block kecuali schema mengizinkan.
5. Sibling order unik dalam satu parent setelah commit.
6. Jika LTree diadopsi, path anak adalah `parent.node_path || stable_label(node_id)`.
7. Hasil ekspor Markdown adalah serialisasi body AST; kolom Markdown lama bukan input kanonis setelah cutover.
8. Root adalah wrapper body yang tetap ada walau dokumen kosong; operasi node-level tidak dapat memindahkan atau menghapus root. `ImportMarkdown` dan `RestoreRevision` boleh mengganti keseluruhan body/root dalam transaksi penggantian body mereka.

## 5. Model persistence PostgreSQL

Ini adalah bentuk target konseptual. Nama/tipe akhir perlu diselaraskan dengan konvensi migration Dokudocs dan hasil spike; contoh video bukan DDL siap produksi.

### Skema Dokudocs saat ini dan pemetaan perubahan

Skema existing memakai `documents.id` sebagai UUID dan enum `document_type` (`markdown`, `dbdiagram`, `mermaid`). `documents` juga memiliki metadata workspace/project, `author_id`, tags, draft/visibility/share token, thumbnail, timestamps, serta soft-delete fields. Pertahankan kolom dan relasi metadata tersebut.

| Tabel/kolom existing                                                              | Perlakuan dalam refactor                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents.content TEXT NOT NULL DEFAULT ''`                                      | Untuk `markdown`, menjadi sumber backfill sementara lalu bukan jalur baca/tulis body setelah cutover; export Markdown dibuat dari AST. Kolom tetap dipakai `dbdiagram` dan `mermaid`. Jangan drop kolom bersama ini.                                                                    |
| `documents.type`, `workspace_id`, `project_id`, `author_id`, visibility/lifecycle | Pertahankan; AST hanya untuk `type='markdown'`. Otorisasi tetap melalui policy Dokudocs.                                                                                                                                                                                                |
| `document_accesses(document_id,user_id,access_level)`                             | Pertahankan PK dan enum `owner/edit/comment/view`; jangan duplikasi sebagai tabel permission baru.                                                                                                                                                                                      |
| `comment_threads`                                                                 | Pertahankan identitas, author, isi, status resolve, timestamps, replies, dan `selected_text`. Tambah anchor AST/Yjs; kolom lama `block_id`, `from_pos`, `to_pos`, `block_path`, `section_title` dipertahankan selama backfill/rollback dan baru dihapus setelah cutover UI tervalidasi. |
| `comment_replies`                                                                 | Tidak perlu perubahan struktur untuk AST; tetap bergantung pada `comment_threads` dan lifecycle cascade yang ada.                                                                                                                                                                       |
| `document_revisions.content TEXT`                                                 | Tambah snapshot AST dan versi schema/body untuk revision Markdown. `content` tetap dibutuhkan untuk revision DBML/Mermaid dan sebagai salinan migrasi sementara; jangan mengubah ID, author, nomor versi, nama, atau timestamp.                                                         |

Pemetaan schema additive inti:

```sql
ALTER TABLE documents
  ADD COLUMN root_node_id UUID,
  ADD COLUMN body_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN body_epoch BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN body_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN creation_request_kind TEXT,
  ADD COLUMN creation_request_id UUID,
  ADD COLUMN creation_request_hash BYTEA,
  ADD CONSTRAINT documents_body_version_positive CHECK (body_version > 0),
  ADD CONSTRAINT documents_body_epoch_positive CHECK (body_epoch > 0),
  ADD CONSTRAINT documents_body_schema_version_positive CHECK (body_schema_version > 0),
  ADD CONSTRAINT documents_creation_request_kind_check
    CHECK (creation_request_kind IS NULL OR creation_request_kind IN ('create', 'duplicate')),
  ADD CONSTRAINT documents_creation_request_complete_check
    CHECK ((creation_request_kind IS NULL AND creation_request_id IS NULL AND creation_request_hash IS NULL)
        OR (creation_request_kind IS NOT NULL AND creation_request_id IS NOT NULL AND creation_request_hash IS NOT NULL));

CREATE UNIQUE INDEX documents_creation_request_unique
  ON documents (author_id, creation_request_kind, creation_request_id)
  WHERE creation_request_id IS NOT NULL;

-- Setelah document_nodes dibuat dengan PK(document_id, node_id):
ALTER TABLE documents
  ADD CONSTRAINT documents_root_node_fk
  FOREIGN KEY (id, root_node_id)
  REFERENCES document_nodes(document_id, node_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE comment_threads
  ADD COLUMN anchor_node_id UUID,
  ADD COLUMN anchor_start BYTEA,
  ADD COLUMN anchor_end BYTEA,
  ADD COLUMN anchor_state TEXT NOT NULL DEFAULT 'orphan'
    CHECK (anchor_state IN ('active', 'orphan'));

-- Composite FK mencegah anchor menunjuk node dokumen lain.
ALTER TABLE comment_threads
  ADD CONSTRAINT comment_threads_anchor_node_fk
  FOREIGN KEY (document_id, anchor_node_id)
  REFERENCES document_nodes(document_id, node_id)
  ON DELETE SET NULL (anchor_node_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX comment_threads_anchor_node
  ON comment_threads (document_id, anchor_node_id)
  WHERE anchor_node_id IS NOT NULL;

ALTER TABLE document_revisions
  ADD COLUMN ast_snapshot JSONB,
  ADD COLUMN body_version BIGINT,
  ADD COLUMN body_schema_version INTEGER,
  ADD COLUMN restore_request_id UUID;

CREATE UNIQUE INDEX document_revisions_restore_request_unique
  ON document_revisions (document_id, restore_request_id)
  WHERE restore_request_id IS NOT NULL;

-- Receipt restore disimpan pada revision hasil restore.
ALTER TABLE document_revisions
  ADD COLUMN body_epoch BIGINT,
  ADD COLUMN restore_source_revision_id UUID,
  ADD CONSTRAINT document_revisions_body_epoch_positive
    CHECK (body_epoch IS NULL OR body_epoch > 0),
  ADD CONSTRAINT document_revisions_restore_receipt_complete CHECK (
    (restore_request_id IS NULL AND restore_source_revision_id IS NULL AND body_epoch IS NULL)
    OR (restore_request_id IS NOT NULL AND restore_source_revision_id IS NOT NULL AND body_epoch IS NOT NULL)
  );
```

DDL ini menggambarkan urutan perubahan, bukan satu migration yang dijalankan persis sekaligus. Constraint root/type, satu root per dokumen, parent-child grammar, dan acyclicity perlu divalidasi setelah backfill oleh transaction/domain layer; `CHECK` biasa tidak dapat memvalidasi relasi antarbaris. Anchor lama yang tidak dapat dipetakan diberi `anchor_state='orphan'`, bukan dihapus.

### `documents`

Pertahankan ID, workspace/project, title, type, owner/author, visibility, access, trash, dan timestamp yang ada. Tambah `root_node_id` untuk Markdown, `body_version BIGINT NOT NULL DEFAULT 1` untuk setiap perubahan body durable, `body_epoch BIGINT NOT NULL DEFAULT 1` untuk generasi state kolaborasi, serta `body_schema_version INTEGER NOT NULL DEFAULT 1` untuk format AST/CRDT yang harus dibaca bersama. Restore menaikkan version dan epoch dalam transaksi yang sama; edit biasa hanya menaikkan `body_version`. Retry update duplikat di-ACK dengan versi saat ini tanpa membuat bump/revision palsu. FK composite harus memastikan root berasal dari dokumen yang sama. Buat dokumen + root dalam satu transaksi dengan constraint deferrable jika diperlukan.

`documents.content` dipakai sebagai compatibility source selama backfill. Setelah AST cutover, nilai yang diekspor boleh disajikan di API, tetapi tidak boleh menjadi jalur tulis body kedua. Markdown source dapat diekspor/dibangun kembali dari AST; DBML/Mermaid tetap memakai `content`. Drop field penyimpanan lama hanya jika consumer non-Markdown sudah dipindahkan.

### `document_nodes`

```sql
-- Skema kontraktual, bukan migration siap jalan.
document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
node_id       UUID NOT NULL DEFAULT gen_random_uuid()
parent_id     UUID NULL
sibling_order DOUBLE PRECISION NOT NULL
node_type     VARCHAR(32) NOT NULL
content       TEXT NOT NULL DEFAULT ''
attributes    JSONB NOT NULL DEFAULT '{}'
version       BIGINT NOT NULL DEFAULT 1
updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
PRIMARY KEY (node_id)
UNIQUE (document_id, node_id)
FOREIGN KEY (document_id, parent_id)
  REFERENCES document_nodes(document_id, node_id)
```

Tambahkan unique/indexes:

- Unique sibling ordering untuk node non-root `(document_id, parent_id, sibling_order)`; enforce root separately.
- Partial unique satu root per `document_id`; validasi `documents.root_node_id` menunjuk root dalam transaksi.
- `(document_id, parent_id, sibling_order)` untuk load children terurut.
- CHECK/validasi application untuk node type, finite sequence number, dan JSON attributes yang valid.

`parent_id` menjadi sumber struktur kanonis dan recursive query cukup untuk operasi subtree awal. Jangan menambah extension, `node_path`, atau GiST pada migration AST pertama: belum ada caller produk yang membuktikan kebutuhan indeks. Jika query subtree nyata kemudian terbukti lebih baik dengan LTree, tambahkan path turunan yang dapat dibangun ulang dari parent/node ID dan ukur GiST terhadap recursive query. Urutan hasil tetap memakai parent/sibling fields; jangan menerima path dari client. [PostgreSQL LTree](https://www.postgresql.org/docs/18/ltree.html).

### Allocating sibling order

Semua order awal berupa angka finite yang tersusun menaik. Parent tanpa anak memulai dari `1.0`; append/prepend mencoba `right + 1.0` atau `left - 1.0`. Insert di antara tetangga menghitung `mid = left + (right-left)/2`; server hanya menerima hasil finite bila `left < mid < right` dan tidak ada sibling lain dengan key tersebut. Bila kandidat overflow, tidak finite, collision, atau tidak lagi ketat di antara tetangga, transaction me-reindex seluruh anak dari parent itu menjadi `1..N`, lalu mengulang alokasi. Perubahan sibling order pada node lama hanya melalui `MoveNode`; alokasi urutan untuk insert dan reindex seluruh sibling tetap bagian projection server. Semua alokasi berjalan di bawah lock dokumen, sehingga dua writer tidak memilih posisi berdasarkan sibling set yang sama lalu commit bertabrakan.

`DOUBLE PRECISION` adalah angka inexact. Jangan pakai `1e-15` sebagai batas universal; representable gap tergantung magnitude. PostgreSQL docs menyebut double precision sebagai floating point inexact: [numeric types](https://www.postgresql.org/docs/16/datatype-numeric.html).

### `document_collab_states`

Satu baris per Markdown document: `document_id` PK/FK, `encoded_state BYTEA`, `schema_version`, `updated_at`. `schema_version` adalah `BodySchemaVersion` yang dibutuhkan untuk membaca AST dan encoded state. Binary Yjs state wajib disimpan sebagai format CRDT binary yang sebenarnya, bukan direkonstruksi dari JSON pada setiap connect. `documents.body_epoch` menandai generasi state ini; restore membangun state Yjs baru dari snapshot AST, sementara structural MoveNode membangun ulang shared state. Keduanya mengganti AST/Yjs secara atomik bersama kenaikan epoch. Jangan menambah CRDT update log append-only pada awal refactor.

AST dan binary state menyimpan bentuk data yang sama untuk dua kebutuhan berbeda: AST adalah model baca/domain yang di-query dan diekspor; encoded state mempertahankan identitas/causal metadata untuk melanjutkan merge. Keduanya harus diverifikasi konsisten saat transaksi dan saat recovery.

### Batas transaksi update

Urutan wajib untuk `ApplyCollaborativeUpdate`:

1. Autentikasi koneksi sebelum operasi database; anggap authorization handshake hanya pemeriksaan awal. Setiap update membawa `body_epoch` dan `BodySchemaVersion` saat dibuat.
2. Mulai transaksi. Ambil shared row locks pada workspace membership lalu project/project membership, berurutan. Lock row induk workspace/project bila perlu memagari grant yang belum ada.
3. Lock row `documents` dengan `FOR UPDATE`; lock ini menserialisasi body dan mutasi visibility/lifecycle pada dokumen. Setelah itu ambil shared lock pada direct document grant (atau lock dokumen sebagai parent fence jika grant belum ada), lalu re-evaluasi policy.
4. Cocokkan `body_epoch` dan schema version dengan state durable. Epoch lama menghasilkan `stale_epoch`; schema berbeda menghasilkan `schema_mismatch`; dokumen tanpa root/state awal menghasilkan `body_not_initialized`. Kondisi itu ditolak sebelum merge dan client mempertahankan pending update. Jika cocok, verifikasi projection state Yjs durable sama dengan AST committed, load keduanya ke working document terisolasi, lalu apply update secara idempotent.
5. Validasi ukuran, schema, tree invariants, sibling order, dan efek terhadap CommentAnchor. Projector membandingkan opaque node committed dengan hasil merge dan menolak perubahan ID, tipe, source bytes, atau jalur parent/order. Projector juga menolak parent/order change pada `node_id` lama kecuali update diproses sebagai `MoveNode` dengan command tervalidasi. Turunkan AST delta hanya setelah semua validasi berhasil.
6. Jika state CRDT benar-benar berubah, simpan encoded state, AST delta, anchor orphan transitions, `body_version = body_version + 1`, dan timestamp dalam transaksi yang sama. Jika update duplikat/no-op, jangan bump version atau revision.
7. Commit. Hanya setelah commit sukses, kembalikan `CommitReceipt{body_version}` untuk ACK dan publish update ke peserta lain.

Jika langkah 4–6 gagal, rollback dan buang working CRDT document; jangan mengubah state in-memory yang dipakai sesi. Retry setelah commit tetapi sebelum ACK harus aman: update CRDT duplicate tidak mengubah hasil dan tidak menaikkan versi, lalu server ACK dengan versi durable yang berlaku. `body_version` menandai urutan commit Dokudocs, bukan clock kausal CRDT. Snapshot reconnect selalu diambil dari state yang sudah commit.

### `document_revisions`

Pertahankan `id`, `document_id`, `author_id`, `version_number`, `title`, `is_named`, `created_at`, `updated_at`. Untuk revision Markdown, simpan `ast_snapshot JSONB` (atau format snapshot versioned yang lolos benchmark) beserta schema version/checksum dan `body_version`. `restore_request_id` nullable pada revision yang dibuat oleh restore memberi idempotency key per dokumen; retry restore yang sama mengembalikan hasil sebelumnya. Untuk DBML/Mermaid, kolom existing `content TEXT NOT NULL` tetap menjadi snapshot teks; jangan paksa tipe tersebut melewati AST Markdown. Karena kolom `content` wajib terisi, revision Markdown baru mengisi `content=''` (atau export compatibility yang hanya sementara), sementara `ast_snapshot` menjadi sumber kebenaran. Saat migrasi, simpan konten Markdown lama untuk validasi/backout; bukan untuk tulis setelah cutover.

Pertahankan auto revision/coalescing 10 menit yang sekarang terlihat di frontend, versi bernama, rename, dan restore. Autosave memperbarui snapshot terbuka dalam window aktif; setelah window/sesi ditutup snapshot sealed dan tidak diubah lagi.

### `comment_threads` dan `comment_replies`

Pertahankan identitas, author, body, resolve metadata, timestamps dan reply. Pada rilis pertama satu thread menandai rentang dalam **satu blok**; pilihan lintas blok memerlukan schema anchor baru dan tidak dicakup oleh `anchor_node_id` tunggal. Ganti offset/path sebagai anchor primer dengan:

- nullable `anchor_node_id`;
- encoded start/end Yjs RelativePosition sebagai binary;
- `selected_text`, quote prefix/suffix atau konteks minimum untuk verifikasi;
- `anchor_state`: `active` atau `orphan`;
- waktu/alasan orphan jika UI perlu ditampilkan.

Composite FK `(document_id, anchor_node_id)` harus memastikan node anchor berada di dokumen yang sama; penghapusan node hanya me-null-kan `anchor_node_id` dan mengubah status anchor, bukan `document_id` atau thread. PostgreSQL 16 mendukung `ON DELETE SET NULL (anchor_node_id)` pada FK komposit; domain transaction juga menandai thread orphan. Jangan `ON DELETE CASCADE` dari node ke thread. Jika posisi relatif null/tidak cocok dengan quote, simpan thread dan tandai orphan. Quote search tidak boleh auto attach pada hasil ambigu. [PostgreSQL 16 foreign keys](https://www.postgresql.org/docs/16/ddl-constraints.html)

### `document_suggestions` (G4; after AST cutover)

Gunakan composite primary key `(document_id, suggestion_id)` agar operasi/riwayat selalu terikat ke dokumen yang benar. Satu `suggestion_id` menyimpan satu change set atomik: accept atau reject berlaku untuk seluruh operasi di dalamnya; beberapa suggestion ID dapat ditinjau terpisah. Simpan usulan dalam tabel terpisah dengan `proposed_by`, `base_body_version`, `operation_schema_version`, `provenance` (`human`/`AI`), operasi terstruktur terhadap node ID/posisi, `summary`, `reason`, `status` (`pending`, `accepted`, `rejected`, `conflicted`), `decided_by`, `created_at`, dan nullable `decided_at`. Batasi provenance dan status ke nilai tersebut. Pending belum memiliki `decided_by/decided_at`; accepted, rejected, dan conflicted harus menyimpan keduanya. Text/format proposal membawa node ID, relative positions dan konteks/teks yang diharapkan untuk verifikasi; proposal struktur membawa node ID serta parent/sibling yang diharapkan dan targetnya. Representasi operasi harus mencakup teks, format, insert/delete/move blok. Jangan memakai snapshot Markdown sebagai proposal yang mengganti body penuh. Pertahankan operasi, ringkasan, alasan, provenance, dan keputusan sebagai riwayat setelah usulan selesai. Isi proposal dan riwayat hanya terlihat oleh pengusul serta editor/owner yang masih boleh membaca dokumen; viewer dan public link hanya melihat body kanonis. Pending proposal dan riwayatnya tidak menjadi `document_nodes`, Yjs body, revision body, export, atau chunk RAG. Penghapusan permanen dokumen menghapus proposal/riwayatnya.

## 6. Domain commands dan state transitions

### Struktur kolaboratif ala Outline

Ikuti model referensi/Outline: schema ProseMirror mendefinisikan root/block/container/inline, lalu `y-prosemirror` menyinkronkan tree editor melalui Yjs shared types. Ini adalah model operasi editor dan convergence, bukan pengganti AST relasional Dokudocs. Server memproyeksikan tree bersama ke `document_nodes` dalam transaksi yang sama dengan state Yjs. Node aplikasi mempertahankan `node_id` stabil walau implementasi shared type internal berubah; LTree bukan dependency projector awal.

Codebase Outline yang menjadi acuan lokal: [Multiplayer extension](../../references/outline/app/editor/extensions/Multiplayer.ts) mengikat ProseMirror ke Yjs dan menyediakan cursor/undo plugin; [PersistenceExtension](../../references/outline/server/collaboration/PersistenceExtension.ts) memuat encoded state atau membangun Y.Doc awal dari konten; [documentCollaborativeUpdater](../../references/outline/server/commands/documentCollaborativeUpdater.ts) menserialisasi update, mengambil snapshot ProseMirror, dan menyimpan keduanya dalam transaksi. Dokudocs mengadopsi batas model ini, bukan menyalin storage Outline. Presence/cursor tetap milestone terpisah. Persistensi Outline tidak membuktikan sendiri kontrak ACK Dokudocs: setiap update Dokudocs tetap harus commit ke PostgreSQL sebelum ACK.

Yjs shared type yang sudah terintegrasi tidak dapat dipindah begitu saja ke lokasi lain. Karena itu operasi block move tidak boleh diasumsikan sebagai mutasi pointer tree generik: kirim command `MoveNode` yang menghapus/menyisipkan node melalui transaksi editor dan server-order/revalidate command tersebut terhadap struktur terbaru. Writer saat ini membangun ulang seluruh Yjs fragment untuk memindahkan node; move yang mengubah struktur menaikkan `body_epoch` dan `body_version` atomik. Semua update/command pending dari epoch lama ditahan untuk review karena rebuild mengganti identitas shared type di seluruh fragment, termasuk blok yang tidak dipindah. Move no-op tidak membuat epoch baru. Per-node rebase baru boleh menggantikan fence ini setelah identity preservation dan pemulihan offline terbukti. Saat pindah/rebuild shared type, remap anchor hanya bila identitas/range dapat dibuktikan; selain itu tandai orphan. Untuk edit karakter/format biasa, gunakan operasi editor Yjs dan projection; semantic command khusus digunakan untuk operasi struktur yang butuh validasi lintas tree.

### Document Body commands

Create, duplicate, Markdown import, restore, dan seeder wajib memanggil satu domain write path. Tidak boleh ada route/usecase lain yang hanya mengubah `documents.content` atau node AST tanpa mempertahankan encoded Yjs state. DBML/Mermaid tetap di jalur text mereka.

| Command                     | Aturan utama                                                                                                                                                                                                                                                                     | Efek durable                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateMarkdownDocument`    | Satu domain write path; request membawa `request_id` stabil dan fingerprint payload.                                                                                                                                                                                             | Metadata, owner grant, root, initial Yjs state, dan hasil request tersimpan atomik. Retry identik mengembalikan document ID semula; fingerprint berbeda ditolak.                                                                                |
| `DuplicateMarkdownDocument` | Baca AST sumber yang berizin; request membawa `request_id` dan fingerprint; buat ID dokumen/node baru dan Yjs state baru.                                                                                                                                                        | Retry identik mengembalikan dokumen duplikat yang sama; causal state/comment anchors tidak disalin tanpa aturan copy.                                                                                                                           |
| `ImportMarkdown`            | Hanya type Markdown; parse dan validasi schema; request membawa `base_body_version` dan fingerprint sumber. Node hasil backfill deterministik untuk document ID + checksum + schema version + posisi struktural.                                                                 | Import awal atomik; retry dengan fingerprint sama no-op; basis usang dengan konten berbeda ditolak. Node baru saat edit mendapat UUID baru.                                                                                                     |
| `ApplyCollaborativeUpdate`  | Actor memiliki hak edit di dalam transaksi; epoch/schema cocok; update hanya mengubah isi/format atau memasukkan node baru; update tidak memindahkan, mengurutkan ulang, atau menghapus node lama.                                                                               | Update state CRDT, node delta, sibling order, version, dan orphan transitions dalam satu transaksi.                                                                                                                                             |
| `MoveNode`                  | Satu-satunya command untuk mengubah parent atau sibling order node yang sudah ada; root tidak dapat dipindahkan. Membawa `command_id`, node, target parent, posisi relatif, epoch, dan schema version. Server revalidasi permission, tree terkini, cycle, dan opaque protection. | Parent/order dan Yjs/AST tersimpan atomik bersama durable receipt. Move yang mengubah struktur menaikkan `body_version` dan `body_epoch`; no-op tidak. Pending dari epoch lama ditahan untuk review, bukan di-merge ke Yjs yang dibangun ulang. |
| `DeleteNode`                | Satu-satunya command untuk menghapus node existing selain root; membawa `command_id`, target node, epoch, dan schema version. Server revalidasi permission, tree terkini, serta opaque protection.                                                                               | Penghapusan, Yjs/AST rebuild, kenaikan `body_version`/`body_epoch`, dan receipt durable commit atomik; seluruh pending epoch lama ditahan untuk review.                                                                                         |
| `ExportMarkdown`            | Hanya membaca AST kanonis; format normalisasi mengikuti round-trip contract.                                                                                                                                                                                                     | Tidak menulis body.                                                                                                                                                                                                                             |
| `CreateRevision`            | Actor dapat membaca/mengedit sesuai aksi; snapshot AST diambil dari state commit.                                                                                                                                                                                                | Autosnapshot dapat diperbarui di window 10 menit; named snapshot immutable sejak dibuat; version number unik per dokumen.                                                                                                                       |
| `SeedMarkdownDocument`      | Memanggil jalur create/import domain yang sama; tidak menulis AST/Yjs langsung.                                                                                                                                                                                                  | AST, state awal, dan version konsisten.                                                                                                                                                                                                         |
| `RestoreRevision`           | Snapshot milik dokumen yang sama; hak edit terkini; `restore_request_id` idempotent; tidak menulis ulang revision lama.                                                                                                                                                          | Mengganti current body dengan AST dan Yjs state baru, menaikkan `body_version` dan `body_epoch`, menyiarkan epoch baru, serta membuat revision hasil restore.                                                                                   |

`request_id` create/duplicate dan fingerprint disimpan pada row dokumen yang dihasilkan di transaksi awal; ID dokumen itu menjadi hasil request. Untuk kedua command ini, `author_id` harus sama dengan actor terautentikasi. Unique `(author_id, creation_request_kind, creation_request_id)` membatasi retry per actor dan jenis command. Endpoint create dan duplicate menerima UUID stabil pada header `Idempotency-Key`; fingerprint create mengikat key ke payload dokumen, sedangkan fingerprint duplicate mengikatnya ke workspace dan dokumen sumber. Retry identik mengembalikan dokumen yang sama, sedangkan key yang dipakai untuk payload/sumber berbeda ditolak sebagai conflict. Jika dua request identik berlomba, hanya transaksi pemenang commit; transaksi lain membaca row pemenang dan mengembalikan ID yang sama. Import tidak memakai receipt umum: retry dengan source fingerprint sama menjadi no-op; import baru harus membawa `base_body_version` terkini. Jika basis usang dan body saat ini tidak cocok dengan fingerprint import, tolak sebagai stale import tanpa menimpa edit.

### Durable structural command receipts

Gunakan primary key `(document_id, command_id)` bersama untuk `MoveNode` dan `DeleteNode`, agar satu ID tidak dapat dipakai ulang untuk command atau payload lain dalam dokumen yang sama. Simpan jenis command di dalam hash payload semantik, `body_epoch`, actor, target/parameter command, hasil, dan `body_version`; jangan beri TTL selama dokumen masih ada. Cek effective edit access dengan lock sumber ACL di dalam transaksi sebelum receipt dapat dibaca. Jika receipt ditemukan dan actor, epoch, jenis command, serta hash payload sama, kembalikan hasil commit asli sebelum membandingkan epoch terhadap head saat ini. Ini menangani retry setelah restore atau command struktural berikutnya menaikkan epoch: receipt lama tetap menjawab bahwa command sudah committed, lalu client resync ke head terkini. ID yang sama dengan actor/epoch/jenis/payload berbeda ditolak sebagai `command_id_reused`.

Jika receipt belum ada, cocokkan epoch saat ini dan validasi tree terbaru. Simpan perubahan command, AST/Yjs, hasil receipt, serta kenaikan `body_version` dan `body_epoch` untuk perubahan struktural dalam satu transaksi. Move no-op yang diterima tetap menyimpan receipt tanpa menaikkan versi/epoch. Konflik/stale epoch yang tidak commit tidak membuat receipt; setelah resolusi pengguna, kirim command dengan ID baru. Receipt hanya memberi ACK untuk command asal, bukan menyatakan bahwa hasilnya masih menjadi head body saat ini.

### Collaborative Session dan offline state

Sesi server mengelola koneksi dan routing, bukan lease mode editor. Mode Muya memakai schema bersama; perpindahan mode tidak mengubah sumber body atau aturan sinkronisasi.

Di browser, IndexedDB menyimpan state Yjs lokal, `body_epoch`, envelope update yang belum di-ACK, dan queue terpisah untuk `MoveNode`/`DeleteNode` commands. Penghapusan node existing tidak dikirim sebagai Yjs UPDATE. Tampilkan status terpisah: “tersimpan di perangkat” saat transaksi IndexedDB selesai, dan “tersinkron ke server” hanya setelah ACK durable. Jangan hapus state pending hanya karena socket berhasil mengirim; tunggu ACK dan verifikasi `body_version`/state vector. Reconnect mengecek izin dan epoch sebelum mengirim state vector/pending untuk merge. Client menghentikan retry duplikat yang sudah acknowledged, tetapi mempertahankan salinan lokal hingga server receipt diketahui.

Schema browser target, termasuk key User+Document dan queue structural command `MoveNode`/`DeleteNode` yang belum ada pada IndexedDB v1 saat ini, tercantum pada [arsitektur penuh](../architecture/dokudocs-full-implementation-architecture.md#schema-lokal-browser-untuk-kolaborasi-dan-offline). Penambahan store adalah upgrade additive ke DB versi 2 yang mempertahankan seluruh row pending v1. Sampai store command dan replay/recovery terpasang, gate G3 tetap terbuka.

Offline editing hanya tersedia bagi dokumen Markdown yang pernah dibuka dengan akses sah dan body lengkapnya sudah tersimpan di perangkat. Cache app shell dan aset editor statis memakai service worker dengan navigation fallback agar dokumen yang sama dapat dibuka lagi lewat URL yang diketahui setelah browser restart. Cache service worker hanya berisi app/editor assets, bukan respons API. Tidak ada daftar proyek/dokumen atau pencarian offline. Create/import dokumen baru memerlukan koneksi server; jangan menciptakan ID dokumen sementara yang kemudian disisipkan ke aggregate PostgreSQL.

Setelah restart offline, identitas lokal hanya valid selama AccessToken tersimpan belum kedaluwarsa (TTL default backend 24 jam). Akses lokal ini bukan bukti otorisasi server: revoke baru diketahui saat reconnect dan server menolak write yang tidak lagi berizin. Reconnect memeriksa hak baca/edit sebelum mengirim pending state. Jika token kedaluwarsa ketika offline, kunci body dan pending edits dari penggunaan tetapi pertahankan state di IndexedDB; pengguna yang sama harus login online sebelum state dibuka atau disinkronkan. Logout terkonfirmasi tetap membersihkan state user tersebut. Browser yang menghapus/mengeviksi site data dapat menghilangkan shell dan edit yang belum di-ACK; Dokudocs tidak dapat memulihkannya dari server.

Satu tab menjadi penulis aktif untuk pasangan User+Document dalam satu profil browser. Tab lain membuka dokumen itu sebagai baca saja sampai berhasil mengambil alih peran penulis; handoff tidak boleh membuang pending update atau membiarkan dua tab menulis queue IndexedDB yang sama. Mekanisme koordinasi antar tab dan pemulihan dari tab yang crash dibuktikan pada spike browser. Perangkat atau profil browser berbeda tetap boleh berkolaborasi melalui CRDT.

Jika transaksi IndexedDB gagal, termasuk kuota penuh atau storage tidak tersedia, hentikan input edit baru dan tampilkan status gagal menyimpan. Jangan menyebut perubahan yang belum committed ke IndexedDB sebagai tersimpan di perangkat. Pertahankan perubahan yang sudah ada di memori selama tab masih hidup agar pengguna dapat mencoba ulang penyimpanan. Setelah penyimpanan pulih, lanjutkan editor hanya sesudah seluruh pending state berhasil ditulis. Bila pengguna logout atau berganti akun saat masih ada pending edit, tampilkan jumlah pending edit serta pilihan untuk tetap masuk dan menyinkronkannya, atau ekspor bila hak baca dapat diverifikasi saat itu. Logout yang dikonfirmasi membersihkan seluruh state dan queue lokal milik User tersebut; jangan tinggalkan konten dokumen di browser untuk akun berikutnya. Saat offline dan izin baca tidak dapat diverifikasi, ekspor tidak tersedia; pengguna dapat membatalkan logout dan menyinkronkan setelah tersambung. Data yang hilang karena storage browser dihapus di luar aplikasi tidak dapat dipulihkan sebelum server ACK, sehingga UI tidak boleh menjanjikan durability setara PostgreSQL.

Perubahan offline atas isi teks/format merge melalui CRDT hanya bila `body_epoch` dan `BodySchemaVersion` pending update cocok dengan server. Jika restore atau structural MoveNode mengubah epoch, pending dari epoch lama tetap tersimpan tetapi ditahan. Jika schema berubah, jangan kirim pending dari schema lama; perbarui app dan gunakan migrasi lokal yang sudah diuji atau recovery eksplisit sebelum edit dapat di-merge. UI menampilkan body terkini dan body lokal lama berdampingan; pengguna menyalin teks/blok yang dipilih ke editor saat ini sehingga lahir operasi baru pada epoch/schema terkini. Tidak ada rebase otomatis per blok atau pemindahan ID/anchor lama. Pending lama tetap tersedia sampai pengguna menyelesaikan atau membuangnya, selama hak baca masih ada. Hak edit terkini diperlukan untuk menyalin ke body baru. Jangan menerapkan binary update lama ke Yjs state baru atau mengubah label epochnya saja. Reparent/move offline direkam sebagai `MoveNode` command server-ordered, bukan raw shared-type mutation. Client boleh menampilkan move optimistic sebagai local overlay, tetapi server menerapkan command terhadap struktur terbaru dan mengirim hasil CRDT setelah commit. MoveNode yang pending dari epoch berbeda atau memiliki parent/sibling yang tidak tersedia menjadi blocked untuk user resolution; jangan clone atau membuang node diam-diam. Move online memakai command yang sama agar tidak ada dua aturan struktur.

### Comment Thread transitions

- `active anchor ↔ orphan anchor` ditentukan oleh kemampuan resolve dan verifikasi selected quote, bukan `is_resolved`.
- Resolve/reopen tidak mengubah anchor.
- Reply/edit/delete mengikuti kebijakan komentar Dokudocs dan tidak memutasi body CRDT.
- Penghapusan Document mengikuti lifecycle/trash Dokudocs; penghapusan permanen dokumen menghapus thread/revision sesuai FK lifecycle.

### Revision transitions

- Autosave memiliki satu snapshot terbuka per dokumen dalam window 10 menit; perubahan dalam window itu memperbarui snapshot terbuka. Setelah window/sesi ditutup snapshot sealed dan tidak diubah lagi. Implementasi harus mempertahankan semantik coalescing UI existing, bukan membuat snapshot baru per keystroke.
- Named revision tidak berubah saat body maju.
- Restore membuat `Accepted Edit`, membroadcast hasil, dan mencatat revision baru seperti perilaku UI sekarang.
- Anchor yang tidak lagi menunjuk isi sama setelah restore menjadi orphan, tidak hilang.

### Suggestion transitions

- `pending` dibuat hanya saat online oleh pengguna yang berhak comment/edit atau oleh AI atas permintaan pengguna berizin; proposal tidak mengubah body dan tidak menaikkan `body_version`.
- Editor/owner efektif boleh menolak `pending`; status dan siapa/kapan keputusan disimpan tanpa mengubah body. Pengusul dan editor/owner yang masih boleh membaca dapat melihat pending proposal; viewer lain tidak.
- Penerimaan berjalan di bawah lock dokumen yang sama dengan edit: cek ulang izin, basis versi, node target, posisi, schema, cycle, dan efek anchor; terapkan operasi ke Yjs state dan AST dalam satu Accepted Edit. Jika LTree kelak diadopsi, path ikut transaksi. Jika acceptance diulang, hasilnya idempotent dan tidak menaikkan versi lagi.
- Jika acceptance memindahkan node yang sudah ada, validasi memakai semantik `MoveNode` yang sama. Bila parent atau sibling order benar-benar berubah, commit acceptance membangun ulang AST/Yjs dan menaikkan `body_version` serta `body_epoch` satu kali secara atomik; pending update/MoveNode dari epoch sebelumnya ditahan untuk review dan client memuat state baru. Retry acceptance tidak menerapkan operasi atau menaikkan epoch lagi. Acceptance teks/format atau insert blok yang tidak menghapus/memindah node lama menaikkan `body_version` saja. Acceptance yang menghapus node existing mengikuti `DeleteNode`: status proposal, AST/Yjs, `body_version`, `body_epoch`, dan receipt commit atomik; pending epoch lama ditahan untuk review.
- Bila perubahan struktur lain membuat target/parent/posisi tidak dapat dipetakan aman, ubah status menjadi `conflicted`; manusia meninjau dan membuat proposal yang disesuaikan atau menolak. Jangan memilih node berdasarkan kecocokan teks saja.
- Track changes mencakup text insert/delete, format, block insert/delete/move sejak rilis pertama. Usulan tidak dibuat/diputuskan saat offline; edit body biasa tetap memakai protokol offline. Riwayat accepted/rejected/conflicted disimpan sampai dokumen dihapus permanen.

## 7. Hak akses dan kebijakan dokumen

Jangan salin model generik `users`/`document_permissions` dari referensi. Schema Dokudocs sudah mempunyai role/grant/visibility. Policy aplikasi dan query detail/list menerapkan aturan baca; Gate G0 tetap mensyaratkan pemetaan test acceptance ke seluruh aturan pada bagian ini. Gunakan policy yang sama atau query yang terbukti ekuivalen pada setiap consumer yang tersedia. Revision list/create/restore sudah menjadi consumer REST aktif: list memakai hak baca, sedangkan create dan restore memakai hak edit. Endpoint komentar dan export belum tersedia. WebSocket, suggestion, dan retrieval juga wajib memakai policy ini saat dibangun; list/query tidak boleh membocorkan metadata dokumen terlarang.

| Kondisi                                                 | Hak baca body untuk anggota workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace owner/admin                                   | Boleh membaca dokumen/proyek private di workspace sendiri, tunduk pada lifecycle; dianggap memiliki hak edit efektif untuk aturan draft.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Dokumen `inherit`, proyek `workspace` atau tanpa proyek | Anggota workspace boleh membaca, sebelum filter draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dokumen `inherit`, proyek `private`                     | Anggota proyek yang berhak baca boleh membaca; owner/admin workspace dan penerima grant dokumen menjadi pengecualian.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dokumen `workspace`                                     | Anggota workspace boleh membaca, walaupun proyek private; visibility eksplisit mengalahkan inheritance proyek.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Dokumen `private`                                       | Penulis, pemegang grant owner/edit/comment/view, atau owner/admin workspace boleh membaca; keanggotaan proyek saja tidak membuka dokumen.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dokumen `public_link`                                   | Jalur publik memerlukan token valid; visibility ini sendiri tidak memberi baca internal kepada seluruh anggota workspace. Tautan membuka dokumen, bukan metadata proyek private. Baca internal memerlukan author, workspace owner/admin, atau direct read grant; edit internal memerlukan workspace owner/admin atau direct edit/owner grant. Role editor proyek saja tidak memberi akses ke dokumen ini. Untuk chatbot anggota workspace tanpa grant internal, token itu harus sudah dibuktikan dan masih valid dalam sesi chat saat ini; flag visibility saja tidak cukup. Access log wajib menyamarkan token dari path public document. |
| `is_draft=true`                                         | Filter tambahan: hanya `author_id` atau pemegang hak edit/owner efektif yang boleh membaca; view/comment grant dan token publik saja tidak cukup.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `deleted_at` terisi                                     | Dikecualikan dari baca biasa, public link, kolaborasi, dan RAG; akses trash memakai policy lifecycle terpisah.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Grant langsung kepada anggota workspace melewati pembatasan proyek private. `document_accesses.owner` saat ini adalah DocumentOwner untuk restore dari Trash dan permanent delete; `author_id` mencatat pembuat dan bukan kepemilikan permanen. Restore dari Trash dan permanent delete hanya untuk DocumentOwner atau workspace owner/admin. Restore revision mengubah body dan memerlukan hak edit. Gunakan `workspace_id` milik dokumen dari database untuk memeriksa otoritas; batasi SQL mutasi pada ID dan workspace tersebut. Jangan memakai header workspace yang diberikan caller sebagai satu-satunya bukti.

Akses ke satu dokumen tidak membuka metadata proyek private yang menaunginya. Nama proyek dan kategorinya hanya tampil kepada workspace owner/admin, anggota proyek, atau anggota workspace bila proyek ber-visibility `workspace`. UUID project boleh tetap menjadi relasi dokumen, tetapi direct document grant dan visibility dokumen eksplisit tidak memberi izin untuk membaca katalog proyek.

Endpoint daftar/detail/kategori/member proyek mengikuti batas yang sama: anggota workspace hanya melihat proyek `workspace`; proyek `private` hanya terlihat oleh anggota proyek dan workspace owner/admin. Grant dokumen tidak memberi akses ke katalog proyek atau daftar anggotanya. `document_count` hanya menghitung dokumen yang actor itu sendiri dapat baca, termasuk draft hanya jika ia punya hak baca efektif.

Grant dokumen hanya memberi akses pada dokumen itu; ia tidak memberi wewenang menempatkan dokumen ke proyek private. Create, duplicate, atau reparent ke proyek private memerlukan role manager/editor pada proyek tujuan atau role owner/admin workspace. Untuk proyek visibility workspace, setiap anggota workspace boleh menempatkan dokumen. Update isi dokumen existing dengan grant edit tetap boleh selama proyeknya tidak berubah. Server memeriksa aturan penempatan di usecase dan mengulanginya di transaksi repository.

Hanya DocumentOwner saat ini atau workspace owner/admin yang boleh menetapkan, menurunkan, atau menghapus grant `owner`; hak edit efektif saja tidak dapat memindahkan kepemilikan. Pengguna dengan hak edit tetap dapat mengelola grant non-owner. `share_token` adalah credential: jangan sertakan pada payload list/detail/public document. Kembalikan token hanya melalui endpoint khusus setelah pemeriksaan hak edit. Permintaan ulang untuk dokumen yang masih `public_link` mengembalikan token yang sama; setelah visibility link dicabut, pembuatan ulang menghasilkan token baru sehingga URL lama tetap tidak berlaku.

Daftar Trash hanya menampilkan metadata dokumen yang aktor boleh kelola: pemegang grant `owner` atau workspace owner/admin. Grant baca biasa dan visibility workspace tidak membuka metadata setelah dokumen masuk Trash. `EmptyTrash` hanya untuk workspace owner/admin.

Pembuatan melalui document repository menyimpan dokumen, grant owner awal, dan kategori dalam satu transaksi; error insert grant menggagalkan create. Untuk data legacy, pertahankan grant owner yang ada; jika grant tidak ada, gunakan penerima transfer terakhir yang tercatat; jika transfer juga tidak tercatat, tetapkan `author_id` sebagai owner. Inventaris setiap environment sebelum cutover dan verifikasi bahwa owner hasil rekonsiliasi masih anggota workspace. Audit dev/demo 2026-09-29 menemukan 34 dokumen tanpa owner grant atau riwayat transfer; semuanya direkonsiliasi ke author setelah memastikan penulis masih anggota workspace. Data produksi memerlukan inventaris tersendiri sebelum cutover.

`documents.project_id` harus milik `documents.workspace_id`. Repository memvalidasi create/move dan migration `20260927000001_enforce_document_project_workspace` menambah serta memvalidasi FK komposit setelah memeriksa data lama. Audit tetap dijalankan pada setiap environment sebelum migrasi; jangan memakai visibility proyek dari workspace lain untuk menentukan akses dokumen.

Hak body edit adalah grant `edit`/`owner` atau role workspace/project yang secara eksplisit memberi edit; hak comment boleh membuat komentar dan Suggestion tetapi tidak menulis body; hak view hanya membaca. Hak menerima/menolak Suggestion sama dengan edit/owner efektif. Isi Suggestion, termasuk riwayat usulan selesai, terlihat hanya oleh pengusul dan editor/owner yang masih berhak membaca body. Public link tidak memberi hak WebSocket write atau melihat Suggestion.

Otorisasi join adalah pemeriksaan awal. Setiap edit mengambil shared lock workspace membership; bila operasi melibatkan proyek sumber dan tujuan, lock seluruh project row menurut urutan UUID lalu lock project membership dalam urutan yang sama. Setelah itu ambil document row `FOR UPDATE`, lalu shared direct document grant; jika grant belum ada, document row menjadi parent fence. Setelah semua lock diambil, cek ulang policy di transaksi. Mutasi ACL memakai exclusive lock pada sumber yang sama dengan urutan sama. Dengan begitu edit yang mendapat lock lebih dulu commit sebelum revoke, dan setelah revoke commit edit baru ditolak. Tutup sesi yang aksesnya hilang; indeks RAG memeriksa policy terkini terpisah dari `body_version`. Bila hak edit dicabut tetapi hak baca masih ada, hentikan retry otomatis, pertahankan pending edit sebagai blocked, dan izinkan ekspor setelah hak baca diverifikasi. Bila server mengonfirmasi hak baca hilang, tutup editor serta hapus cached body, state Yjs, dan semua pending update/command dokumen itu di perangkat; jangan menawarkan ekspor. Client offline baru mengetahui revoke saat tersambung; server tetap menolak update yang datang setelah revoke. Identitas dan `workspace_id` dari payload tidak dipercaya tanpa credential dan pengecekan server.

## 8. Batas modul, seam, dan interface

Istilah di sini mengikuti codebase-design: **Module** memiliki satu **Interface**; **Seam** adalah lokasi interface; **Adapter** adalah implementasi konkret. Kompleksitas tree, merge, transaction, dan projection disembunyikan di balik satu modul dalam alur edit.

### Modul logical

| Module                       | Tanggung jawab yang disembunyikan                                                                          | Interface konseptual                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Markdown Body                | Grammar AST, node invariants, path/order, import/export dan projection.                                    | `Import(source) -> Body`; `Export(body) -> Markdown`; `Validate(body) -> error`. Pure computation, tidak membuat koneksi DB.                                             |
| Collaborative Document       | Authz untuk command, lock/order update, CRDT apply, commit boundary, versi durable, reconnect snapshot.    | `Open(actor, docID, stateVector) -> SessionSnapshot`; `Apply(actor, session, update) -> CommitReceipt`; `Close(session)`. ACK hanya dikembalikan setelah durable commit. |
| Document Persistence adapter | Membaca/menulis aggregate dan state CRDT; memegang transaction dengan lock dokumen.                        | `WithLockedDocument(docID, fn(tx, currentState) -> newState,error)`. PostgreSQL production adapter; in-memory adapter hanya untuk pengujian domain/service.              |
| Markdown Codec adapter       | Mengubah representasi Muya/editor terpilih ke/dari domain AST dan source.                                  | Memenuhi kontrak round-trip; parser tidak mengakses database.                                                                                                            |
| Realtime transport adapter   | WebSocket handshake, frame parse, backpressure, local/Redis fanout. Tidak memiliki aturan domain atau SQL. | Memanggil `Open`, `Apply`, `Close`; memetakan domain errors ke frame/error code.                                                                                         |
| Comment/Revision use cases   | Operasi thread/reply/resolve dan snapshot/restore dengan otorisasi.                                        | Command yang bertransaksi dengan body saat anchor/restore terdampak.                                                                                                     |

### Penempatan di repo

- Domain model dan repository contracts mengikuti `backend/internal/domain/model` dan `backend/internal/domain/contract`.
- Validasi AST murni berada di `backend/internal/domain/documentbody`; `Validate(Body) error` tidak bergantung pada database atau Yjs. `ImportMuyaState` memetakan Muya block JSON dan dapat menerima tambahan `inline` dari `enrichMuyaStateForBodyImport`; ia membangun child nodes deterministik dan memvalidasi hasilnya, tetapi blocks tanpa tambahan itu masih menyimpan text mentah di `Content`. Adapter mengangkat reference definition paragraph menjadi block `link-reference-definition` dan meneruskan label untuk resolusi href/title link dan image references. Frontend `markdownToInlineNodes` memetakan token ke kandidat run/object, sedangkan `inlineNodesToMarkdown` mengekspor node inline dengan memakai source hanya ketika sesuai dengan nilai AST. `documentBodyToMarkdown` memproyeksikan flat body node ke struktur Muya dan memakai serializer blok yang ada; node block `opaque` mempertahankan `content` mentah dan hanya menambahkan sintaks parent bila perlu untuk nested block. Endpoint create menerima `initialBody` dan menyimpan metadata, grant owner, AST, encoded Yjs v1, request fingerprint, serta root secara atomik; endpoint initialize/read body, durable writer, encoder, dan projector Yjs Go juga tersedia. Route editor aktif belum memakai jalur create/read tersebut, jalur backfill belum ada, dan round-trip seluruh grammar inline/opaque belum terbukti. Backfill canonical baru boleh dijalankan setelah corpus AST↔Yjs seluruh grammar, termasuk opaque dalam setiap struktur parent, lulus lalu memvalidasi hasil melalui domain ini.
- Use case di `backend/internal/application/document` atau subpackage kolaborasi yang memiliki transaksi dan otorisasi; jangan menaruh aturan di handler.
- SQL di adapter `backend/internal/infrastructure/repository/document`; gunakan `database.DB.WithTransaction` dan parameter query.
- Transport WebSocket masuk `backend/internal/infrastructure/api`/presentation hanya bila runtime Go dipilih. Jika Node dipilih, protocol adapter tetap tidak boleh mengambil alih policy atau membuat model permission kedua.
- Frontend editor adapter berada dekat feature docs. Store server-state menggunakan pola API/query existing; Zustand tetap untuk mode/panel/selection UI, bukan body kanonis.
- Jangan membuat interface/factory permanen untuk dua runtime/editor setelah spike memilih salah satu. Hapus proof-of-concept yang kalah.

### Deep module interface: write path

Caller seharusnya hanya perlu mengetahui bahwa `Apply` menerima credential/session dan satu CRDT update, lalu mengembalikan durable version atau error domain. Caller tidak harus mengorkestrasi row lock, parse tree, midpoint/rebalance, optional LTree path, comment orphaning, SQL, atau Redis order.

Interface wajib mendokumentasikan:

- authz diperiksa sebelum update diterapkan;
- update idempotent saat retry;
- ACK/`CommitReceipt` bermakna PostgreSQL commit berhasil;
- domain error seperti `not_found`, `forbidden`, `invalid_update`, `move_conflict`, `conflict/retry`, `persistence_unavailable`;
- limits payload dan timeout;
- commit berurutan per document; dokumen berbeda boleh paralel.

## 9. Spike editor dan runtime

### Runtime CRDT

Uji runtime Go Yjs-compatible lebih dahulu bersama browser Yjs/ProseMirror. Gate runtime Go harus membuktikan:

- exchange update/state-vector dengan browser Yjs client tanpa perbedaan byte/projection yang merusak dokumen;
- penggunaan AccessToken dan policy membership/document access existing, termasuk revocation;
- transaksi PostgreSQL yang menyimpan CRDT state, AST delta, sibling order, dan document version bersama; optional LTree path ikut bila diadopsi;
- ACK tidak keluar sebelum commit; commit gagal tidak fan-out sebagai edit diterima;
- crash/retry setelah commit, duplicate update, PostgreSQL failover, Redis outage, reconnect state-vector resync, dan pending state IndexedDB;
- serialization hot-document dan throughput dokumen berbeda diukur untuk capacity target.

Jika gate correctness Go gagal, uji Hocuspocus sebagai fallback terhadap kontrak yang sama. Untuk runtime apa pun, satu pemilik write path wajib ditentukan: jangan biarkan Go dan Node sama-sama menulis AST/state tanpa satu transaction authority. Hocuspocus `onStoreDocument` yang di-debounce tidak membuktikan ACK durable.

### Editor dan format adapter

- Implementasikan spike dengan ProseMirror schema + Yjs shared tree (`y-prosemirror`) sebagai reference binding. Pertahankan pengalaman View/Edit/Suggestion; Muya boleh diganti jika tidak mempertahankan identitas, undo, selection, dan node projection.
- Prototipe pengalaman view/editor/suggestion pada shared model. Uji edit body offline dan reconnect saat mode tampilan berubah; usulan track changes tetap online-only.
- Buktikan node ID, formatting, selection, CommentAnchor, dan proposal struktur aman saat collaborator mengedit bersamaan. Jangan klaim suggestion siap sebelum accept/reject, konflik, dan pemisahan body kanonis terbukti.

### Round-trip Markdown

- Pelihara corpus golden sintetis berversi yang diturunkan dari syntax yang benar-benar didukung dan tes Muya; jangan memasukkan isi backup dokumen sebagai fixture.
- Verifikasi bytes source setelah import/export untuk syntax yang dinyatakan lossless, metadata seperti delimiter, setext style, list marker, code info string, frontmatter, table alignment, dan whitespace.
- Syntax unsupported tetap sebagai raw/opaque node atau menahan cutover; parser tidak boleh membuang konten.
- Bandingkan semantic AST sebelum/sesudah impor-ekspor Markdown dan edit visual agar codec tidak membuat body kedua.

## 10. Realtime protocol dan ordering

Wire format final ditentukan oleh Yjs-compatible runtime yang dipilih. Logical frame contract:

1. Credential masuk melalui mekanisme autentikasi WebSocket yang benar-benar tersedia pada browser dan tidak menaruh token di URL/log; validasi `Origin`, expiry, dan reconnect. Konstruktor WebSocket browser hanya menerima URL dan subprotocol, sehingga mekanisme auth perlu dipilih dan diuji pada spike. Payload `JOIN {documentId, stateVector?}` tidak menjadi sumber identitas. [Browser WebSocket constructor](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)
2. Server authenticate/authorize lalu balas `WELCOME {bodyVersion, bodyEpoch, bodySchemaVersion, state}` atau error domain.
3. Client kirim `UPDATE {updateId, bodyEpoch, bodySchemaVersion, updateBytes}` hanya untuk perubahan isi/format dan insert node baru; update yang memindah, mengurutkan, atau menghapus node existing ditolak. `MoveNode` dan `DeleteNode` dikirim sebagai structural command terpisah dengan epoch, schema version, `command_id`, dan payload tervalidasi. Hash receipt mencakup jenis command.
4. Server memeriksa sumber akses di dalam transaksi. Untuk command, ia mencari receipt identik sebelum validasi epoch agar retry pasca-commit tetap idempotent; jika receipt tidak ada, epoch/schema harus cocok sebelum apply. Untuk `UPDATE`, epoch/schema dicek sebelum merge. Request stale menghasilkan `stale_epoch`, schema berbeda menghasilkan `schema_mismatch`; keduanya tidak di-merge/ACK dan pending tetap tersimpan di client.
5. Server fan-out accepted update ke peserta lain setelah durable commit. Penerima apply secara idempotent.
6. Reconnect mengotorisasi ulang actor dan membandingkan `bodyEpoch` serta `bodySchemaVersion` lokal dengan server sebelum state-vector sync atau replay. Dalam epoch/schema yang sama, merge update isi pending, validasi command `MoveNode`/`DeleteNode`, proyeksikan AST, commit, lalu ACK. Pada epoch lama, tahan pending untuk tinjauan pengguna dan muat body baru sebagai state terpisah. Pada schema mismatch, jangan kirim pending ke server; perbarui app dan pertahankan IndexedDB sampai migrasi lokal yang sudah diuji atau pemulihan eksplisit tersedia. Revoke edit membuat update blocked tanpa retry otomatis; revoke baca yang dikonfirmasi server menghapus cache/pending dokumen pada client.

### Serialisasi antar-instance

Perubahan body mengambil shared locks pada workspace membership dan project/project membership, lalu lock eksklusif row `documents` untuk menserialisasi body serta perubahan visibility/lifecycle, lalu shared lock direct grant. Grant yang belum ada dipagari oleh lock row induk scope-nya. Mutasi ACL mengambil exclusive locks pada sumber yang sama dan dalam urutan sama. Policy dicek ulang setelah locks didapat dan sebelum body di-load/di-merge. Penulis dokumen lain paralel; workspace/project revoke menunggu edit aktif milik sumber akses yang sama, bukan mengunci seluruh dokumen.

Redis Pub/Sub meneruskan update ke koneksi di gateway lain; Redis bukan durability source. Edit yang memperoleh shared access lock lebih dulu dapat commit dan revoke menunggu; bila revoke commit lebih dulu, update berikutnya—termasuk tiap update pada sesi WebSocket lama—ditolak. Bila PostgreSQL commit sukses tetapi fan-out gagal, origin tetap menerima ACK durable dan boleh menghapus pending lokal; kesehatan subscriber adalah status terpisah. Setiap peserta membandingkan `body_version` dari pesan dan pemeriksaan head version berkala ke server; gap memicu state-vector resync. Pemeriksaan berkala diperlukan untuk menangkap pesan terakhir yang hilang tanpa update berikutnya/reconnect. Spike mengukur cadence terhadap target propagasi. Jangan menambahkan outbox/op log tanpa bukti bahwa resync gagal memenuhi target.

Yjs binary state harus tetap dalam format encoded Yjs yang bisa diload kembali. Hocuspocus `onStoreDocument` di-debounce secara default; gunakan hanya jika spike membuktikan ACK per update setelah commit AST+state, bukan setelah penerimaan socket atau flush yang tertunda. [Hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks)

### Protokol transport yang sedang diprototipekan

Backend saat ini menyediakan `GET /api/v1/collaboration/{documentID}` sebagai WebSocket route kandidat Go. Browser mengirim frame JSON pertama `{type:"auth", token, workspaceID}`; token tidak diletakkan di URL dan middleware logger hanya mencatat path. Server memeriksa exact `Origin` terhadap `ALLOWED_ORIGIN`, memverifikasi JWT, dan membaca body melalui policy efektif sebelum mengirim konten.

`GET /documents/{id}/body` menyertakan `canEdit` yang dihitung dari policy efektif dalam transaksi pembacaan body. Frame `ready` dan `resync` membawa `canEdit` bersama `bodyVersion`, `bodyEpoch`, `bodySchemaVersion`, dan state Yjs penuh. Frame `update` membawa `updateID`, `bodyEpoch`, `bodySchemaVersion`, dan update Yjs; array byte JSON dikodekan base64. `canEdit` hanya capability untuk mode UI. Setiap update tetap mengambil lock ACL dan memeriksa policy edit di transaksi writer sebelum perubahan durable.

Server menjalankan writer PostgreSQL durable, lalu mengirim `ack` berisi update ID serta versi/epoch. Baru setelah ACK berhasil ditulis, gateway mencoba fan-out frame `update` kepada peserta lain. Error fan-out tidak membatalkan ACK karena PostgreSQL sudah commit. Error domain menggunakan kode `stale_epoch`, `schema_mismatch`, `body_not_initialized`, atau `update_rejected`.

Gateway mengirim application-level `{type:"ping", pingID}` setiap 30 detik; provider browser harus membalas `{type:"pong", pingID}`. Jika pong yang cocok tidak tiba dalam 10 detik setelah ping terkirim, server menutup sesi. Timer ini membersihkan koneksi setengah terbuka yang TCP belum laporkan putus; native WebSocket pong tidak cukup karena library Go mengonsumsi control frame tanpa menyerahkannya ke handler. Cadence saat ini nilai awal dan perlu diuji bersama heartbeat proxy/browser sebelum produksi.

Gateway satu proses menyimpan koneksi lokal dalam hub per dokumen. Pemeriksaan head setiap lima detik membaca snapshot body terkini; bila versi/epoch peserta tertinggal, server mengirim `resync` berisi state penuh. Perubahan `canEdit` juga mengirim resync pada versi yang sama agar pencabutan hak edit segera mengunci editor aktif sesuai cadence tersebut. Pending lokal tetap disimpan dan tidak dikirim saat capability read-only; bila hak baca ikut dicabut, koneksi ditutup dan reconnect ditolak. Saat join, fan-out yang sudah tercakup oleh snapshot `ready` dibuang dari antrean; update yang lebih baru tetap dikirim sesudah `ready`. Akses dicek ulang saat pemeriksaan itu dan sebelum fan-out; koneksi ditutup saat token/akses baca tidak lagi valid atau queue outbound penuh. Masa lima detik adalah cadence awal yang belum diukur. Resync state penuh dan pembacaan body per peserta adalah implementasi awal, bukan target optimasi produksi.

Tes transport in-memory memakai `net.Pipe` membuktikan handshake WebSocket, auth frame, snapshot `ready`, update, dan pemanggilan writer sebelum ACK. Frontend memiliki provider yang memulihkan snapshot IndexedDB sebelum koneksi, mengirim auth/pong, menerapkan snapshot/update/resync ke Y.Doc, dan menyimpan snapshot+pending per user/document sebelum kirim. Pending dihapus setelah `ack`; reconnect mengirim ulang update ID yang sama; epoch/schema mismatch menahan pending. Capability baca saja dari `ready`/`resync` mengunci editor dan menahan pending tanpa retry. Capture snapshot sebelum antrean I/O mencegah edit tersimpan lebih dulu daripada pending-nya. `mountCollaborativeDocumentBody` menyatukan provider dengan ProseMirror EditorView; storage/recovery/auth error membuat editor read-only, sedangkan revoke baca membersihkan cache dan mengosongkan host. Pemeriksaan ACL-only resync dan WebSocket/provider/API/browser editor lulus; 33 tes browser terarah lulus, ESLint serta production build lulus. `make test-integration` juga lulus dengan test WebSocket memakai repository dan PostgreSQL: owner menerima edit durable dan ACK, viewer menerima fan-out tetapi write-nya ditolak. Test langsung sekarang meluncurkan dua proses Go terpisah, memutus socket Pub/Sub secara paksa dan memastikan subscriber tersambung lagi sebelum fan-out berikutnya, lalu mematikan origin pascacommit; survivor mengirim snapshot PostgreSQL dan menerima retry update setelah ACK tidak dibaca. Redis server/PostgreSQL failover terkelola, expiry/refresh pada deployment, logout cleanup, migration rollout, dan kesiapan produksi masih terbuka. Gate G1 tetap terbuka.

## 11. Anchor komentar dan revisi

### Membuat dan resolve anchor

Saat user memilih teks:

1. Editor mengubah selection ke node ID + start/end relative positions pada shared CRDT type.
2. Simpan selected quote beserta konteks seperlunya untuk memverifikasi bahwa resolved positions masih mengacu teks yang diharapkan.
3. Simpan thread dan reply metadata lewat komentar use case; anchor bukan integer absolute offset saja.
4. Rendering resolve relative positions terhadap state dokumen terkini, lalu buat decoration pada node/range tersebut.

Saat edit terjadi:

- Insert di depan range: relative anchor bergerak bersama posisi yang direferensikan.
- Edit di dalam range: anchor tetap range posisi; UI menunjukkan selected quote aktual dan dapat membedakan quote yang berubah.
- Node/shared type dihapus: relative position dapat null. Set `anchor_state=orphan`, null-kan `anchor_node_id`, pertahankan quote/thread dan tampilkan aksi reattach manual.
- Quote ditemukan lebih dari satu tempat: jangan memilih salah satunya otomatis.
- Pindah subtree: node ID stabil, path berubah; anchor tetap menunjuk node jika tipe CRDT sama.

Yjs relative positions tetap dapat dipetakan saat index berubah, tetapi resolve bisa gagal jika shared type yang menjadi target dihapus. Maka quote adalah verifikasi/recovery aid, bukan identitas utama. [Yjs relative positions](https://docs.yjs.dev/api/relative-positions)

### Restore revision

Restore diverifikasi terhadap document ID dan access, mengambil AST snapshot, lalu di bawah lock dokumen membangun Yjs state baru dari snapshot, mengganti AST/current state, dan menaikkan `body_version` serta `body_epoch` dalam satu transaksi. Perintah membawa `restore_request_id` yang dicatat pada revision hasil restore agar retry setelah commit tetapi sebelum respons mengembalikan hasil yang sama tanpa merestore dua kali. Setelah commit, gateway menyiarkan epoch baru; client aktif memisahkan pending lokal dari state baru sebelum membuka editor kembali. Pending update/`MoveNode` dari epoch lama ditahan untuk review, termasuk milik client yang offline. CommentAnchor/relative positions dari state lama tidak diasumsikan valid: resolve ulang lewat node IDs/quote dan orphan-kan yang tidak pasti. Revision lama tidak ditulis ulang. Batas epoch ini adalah aturan aplikasi Dokudocs; sifat komutatif/idempotent update Yjs sendiri tidak menentukan semantik restore terhadap edit offline. [Yjs document updates](https://docs.yjs.dev/api/document-updates)

## 12. Markdown compatibility contract

AST menjadi canonical, maka exporter adalah bagian domain penting dan harus melindungi isi lama.

- Baseline input adalah seluruh Markdown dari backend dev seeders dan fixtures. Browser localStorage/Zustand demo tidak dimigrasikan.
- Round-trip test membandingkan byte Markdown sebelum/selepas parse/export untuk subset yang diklaim lossless.
- Pertahankan metadata sintaks yang dibutuhkan: jenis heading, ordered list start/delimiter, loose list, bullet marker, setext underline, fenced code delimiter dan info string lengkap, table alignment, task checkbox, frontmatter, footnote identifier, math style, diagram language/type.
- Text node mempertahankan whitespace dan escaping yang memengaruhi source. Mark inline menjadi run boundaries; exporter menentukan delimiter tanpa mengubah semantics.
- Syntax yang belum dimodelkan harus masuk `raw/opaque` node atau menahan cutover. Jangan membuangnya, mengganti dengan HTML tanpa persetujuan, atau memberi fallback ke blank content.
- DBML/Mermaid type tidak melewati codec Markdown.

Muya parser saat ini menyediakan sebagian besar tipe block/container tersebut (`TState`); spike harus memastikan editor terpilih mempertahankan tipe yang benar-benar dipakai, bukan hanya deklarasi TypeScript.

## 13. Future RAG and AI contract (G5 / product phase)

Body model mempertahankan stable node IDs dan `body_version` agar kelak dapat diproyeksikan ke RAG. Chunking, retrieval, citation, serta acceptance RAG ada pada gate G5 dan tidak menjadi syarat cutover AST. DBML/Mermaid tetap memiliki body teks sendiri.

Tahap chatbot setelah refactor, termasuk kebijakan riwayat dan penghapusan, dirinci pada [proyeksi fondasi RAG](../plans/dokudocs-rag-foundation.md). Kontrak berikut berlaku saat G5 dimulai, bukan acceptance gate G0–G3.

Kontrak future chunk projection:

- Chunk mengikuti section/heading; section panjang dipecah hanya pada batas block agar tidak memotong struktur/format di tengah node.
- Setiap chunk membawa `document_id`, `body_version`, source `node_id` set, heading breadcrumb, judul dokumen dan nama proyek bila ada, document type, serta metadata ACL yang dapat dievaluasi ulang. Judul/proyek ikut menjadi teks yang dapat dicari, tetapi tidak menjadi bukti untuk jawaban faktual.
- Proyeksi berjalan async setelah perubahan durable dan dapat dibangun ulang dari AST. RAG/vector store bukan bagian write path kolaborasi.
- Fingerprint sumber indeks berasal dari `body_version`, judul dokumen, ID/nama proyek, dan versi renderer. Perubahan judul/proyek memicu indeks ulang tanpa menaikkan `body_version`; worker hanya menandai fingerprint terindeks setelah seluruh chunk versi itu lengkap.
- Retrieval wajib memeriksa ACL Dokudocs saat query. Chunk hanya boleh disajikan bila fingerprint terindeks sama dengan sumber terkini; bila index tertinggal, omit dokumen/chunk tersebut, jangan sajikan konten stale. Dokumen `public_link` tanpa grant internal memerlukan bukti token valid pada request/session chat saat ini; token/bukti tidak disimpan di riwayat chat, chunk, atau citation dan harus dibuktikan lagi pada sesi baru.
- Context builder boleh memakai pertanyaan User terdahulu untuk memahami rujukan pada pertanyaan lanjutan. Jawaban assistant terdahulu hanya boleh ikut sebagai konteks bila semua citation-nya masih dapat dibaca User dan fingerprint sumber masih cocok; jika tidak, keluarkan jawaban itu dari prompt. Jawaban baru hanya boleh didukung retrieval terkini; minta klarifikasi atau nyatakan bukti tidak ditemukan bila sumber dan konteks pertanyaan tidak cukup.
- Setelah model mengembalikan draft, simpan jawaban dan citations hanya dalam transaksi finalisasi yang mengambil shared lock sumber akses/body dalam urutan G0, memeriksa ulang membership, effective access, proof token, dan fingerprint, lalu mengunci conversation untuk append. Jangan memegang lock selama panggilan model. Jika revoke, hard delete, atau perubahan sumber menang lebih dulu, draft dibuang dan tidak dikirim; jika finalisasi commit lebih dulu, jawaban historis tetap mengikuti aturan riwayat yang telah dipilih. Citation tetap dihapus setelah hard delete sumber meski teks jawabannya bertahan.
- GroundedAnswer harus didukung teks body pada satu atau lebih `source_node_ids` yang masih valid. Dokumen dengan judul saja atau hasil yang cocok hanya karena nama proyek tidak cukup untuk jawaban faktual; chatbot menyatakan bukti tidak ditemukan. SourceCitation menunjuk blok/section body, bukan metadata judul/proyek.
- Blok `raw/opaque` hanya boleh menjadi sumber chunk bila renderer khusus dapat menghasilkan teks terbaca yang aman dan mempertahankan referensi ke node opaque tersebut. Jika tidak, lewati blok itu, catat jumlah node yang dilewati dan `coverage_status=partial` pada status indeks dokumen. Retrieval tetap boleh memakai blok lain yang valid, tetapi UI memberi tahu pengguna berizin bahwa cakupan sumber dokumen belum lengkap. Jangan kirim source Markdown opaque mentah ke model sebagai bukti.
- Jangan menambah embedding/vector DB sampai kebutuhan retrieval, provider, retention, dan kualitas retrieval punya keputusan tersendiri.

Kontrak AI document authoring adalah tahap produk terpisah setelah body write path stabil:

- AI membuat dokumen baru sebagai draft Markdown yang melewati import/parse/validation dan alur create-body yang sama.
- AI mengubah dokumen existing dengan Suggestion yang sama seperti usulan manusia: operasi terstruktur terhadap node ID stabil (edit/insert/delete/format, MoveNode, dan DeleteNode), bukan mengganti body Markdown penuh. Blok baru dapat dibawa sebagai Markdown lalu diparse menjadi operasi usulan.
- Pengguna berhak edit/owner melihat preview/diff dan menerima atau menolak. Hanya acceptance yang menerapkan command lewat body domain write path dan mencatat revision sesuai policy Dokudocs. Catat provenance AI pada riwayat Suggestion; pending AI proposal tidak masuk RAG.
- Hasil AI tidak dapat melewati ACL, schema validation, comment-anchor rules, ataupun durability ACK.

## 14. Migration dan cutover

Backfill hanya mencakup backend PostgreSQL demo/dev. Browser localStorage/Zustand berisi data demo yang sengaja tidak dimigrasikan.

### A. PostgreSQL

1. Backup snapshot dev sebelum migration.
2. Buat schema AST baru secara additive tanpa extension LTree.
3. Import `documents.content` Markdown ke AST; pertahankan document IDs dan metadata.
4. Ubah revision snapshots ke AST tanpa mengganti ID/author/time/version.
5. Map existing comment blockId/path/offset ke node ID/relative position bila bisa diverifikasi; selain itu simpan thread/reply dan tandai anchor orphan/reanchor-required.
6. Verifikasi root/parent/sibling order, export kesamaan, revisions, threads, replies, dan akses setiap dokumen. Jika nanti LTree diterima setelah query/benchmark, validasi path hasil rebuild sebagai migration terpisah.

### B. Browser demo state

Data dokumen/comments/revisions localStorage atau Zustand yang hanya dipakai demo tidak dimigrasikan. Jangan gabungkan data demo itu ke backend atau hapus sebagai bagian dari refactor. IndexedDB yang dibuat untuk offline adalah fitur baru: simpan Yjs state dan pending update per User+Document, version-kan schema lokal, dan pertahankan sampai ACK durable.

### Cutover body

- Selama backfill, body source tetap read-only untuk penulisan baru atau tulis lewat satu adapter yang mengubah ke AST; jangan ada dual-write yang tidak atomik.
- Setelah semua Markdown lulus round-trip, GET/export membaca AST; collaborative update hanya lewat WS protocol. Restore memakai command domain ber-`restore_request_id` yang menulis AST, Yjs state, `body_version`, dan `body_epoch` atomik.
- Inventaris create, update, duplicate, get, list/search, public link, revision/restore, import/export, thumbnail, dan seeder yang masih memakai `documents.content`. Alihkan Markdown ke AST/exporter atau proyeksi segar dalam satu cutover; kolom itu tetap dibutuhkan DBML/Mermaid. Jangan sajikan hasil pencarian Markdown dari `d.content ILIKE` lama setelah AST menjadi body kanonis.
- DBML/Mermaid tetap di `documents.content` sampai ada keputusan domain terpisah.
- Rollback dev: arahkan kembali ke backup/source Markdown hanya bila belum menerima edit baru setelah cutover. Setelah ada edit baru, rollback harus mengekspor current AST ke Markdown terlebih dahulu.

## 15. Error handling dan failure matrix

| Failure                                                                                            | Hasil yang diwajibkan                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tidak punya akses saat join                                                                        | WS menolak join; tidak mengirim snapshot.                                                                                                                                                                                          |
| Access dicabut saat aktif                                                                          | Tutup edit stream, hentikan broadcast ke user itu, tutup sesi koneksi yang dicabut.                                                                                                                                                |
| Update schema-invalid/oversized                                                                    | Tidak commit, tidak ACK accepted, kirim `invalid_update`/`payload_too_large`.                                                                                                                                                      |
| PostgreSQL unavailable/rollback                                                                    | Tidak ACK; IndexedDB mempertahankan update pending untuk retry saat online. Tidak menyiarkan sebagai durable.                                                                                                                      |
| Access berubah ketika client offline                                                               | Recheck saat reconnect; hak edit hilang menahan retry, hak baca hilang menghapus cache/pending setelah dikonfirmasi server.                                                                                                        |
| Hak baca dicabut dan dikonfirmasi server                                                           | Tutup editor dan hapus cached body serta semua pending state/command dokumen pada perangkat; tidak menawarkan ekspor.                                                                                                              |
| Hak edit dicabut tetapi hak baca masih ada                                                         | Pending edit menjadi blocked, tidak retry otomatis; ekspor diperbolehkan setelah hak baca diverifikasi.                                                                                                                            |
| Restore atau structural MoveNode/DeleteNode terjadi saat client offline                            | Epoch lama ditolak tanpa merge. Pending update/command tetap lokal untuk tinjauan; body hasil restore/perubahan struktural dimuat sebagai state baru.                                                                              |
| IndexedDB kuota/transaksi gagal                                                                    | Hentikan input edit baru; tampilkan status gagal menyimpan. Pertahankan perubahan memori yang masih ada selama tab terbuka dan coba ulang sebelum editor dilanjutkan.                                                              |
| Logout atau ganti akun dengan edit pending                                                         | Tampilkan jumlah edit pending dan pilihan sync atau ekspor dengan pemeriksaan hak baca. Setelah logout dikonfirmasi, bersihkan state Yjs dan queue lokal User; bila offline, ekspor tidak tersedia sampai izin dapat diverifikasi. |
| Create/import dokumen saat offline                                                                 | Tunda sampai tersambung; tidak membuat dokumen dengan ID sementara atau menyatakan dokumen sudah tersimpan di server.                                                                                                              |
| Dua tab dalam browser yang sama membuka User+Document                                              | Hanya tab pemegang peran penulis menerima edit; tab lain baca saja sampai handoff sukses. Tab yang crash tidak boleh mengunci edit selamanya.                                                                                      |
| Offline MoveNode/DeleteNode stale/invalid                                                          | Tahan command untuk resolusi pengguna; jangan clone/drop node atau mengubah struktur secara diam-diam.                                                                                                                             |
| Retry MoveNode/DeleteNode dengan receipt identik                                                   | Setelah cek edit access, kembalikan hasil receipt lama sebelum cek epoch terkini; jangan apply command atau bump `body_version`/`body_epoch` lagi.                                                                                 |
| `command_id` digunakan ulang dengan payload/actor/epoch berbeda                                    | Tolak sebagai `command_id_reused`; jangan mengganti receipt lama atau menjalankan command baru.                                                                                                                                    |
| Token kedaluwarsa saat browser offline                                                             | Kunci body dan pending dari penggunaan, tetapi jangan hapus state; buka kembali setelah user yang sama login online.                                                                                                               |
| Service worker/site data tidak tersedia offline                                                    | Route dokumen tidak dijamin dapat dimuat; pending yang telah dihapus browser sebelum ACK tidak dapat dipulihkan.                                                                                                                   |
| Process crash setelah commit sebelum ACK                                                           | Retry update aman/idempotent; reconnect mendapatkan durable state dan version.                                                                                                                                                     |
| Redis outage/publish loss                                                                          | Commit tidak hilang; origin menerima ACK durable setelah commit, subscriber mendeteksi gap versi dan resync. Tandai session degraded.                                                                                              |
| Relative anchor tidak resolve                                                                      | Thread/reply tetap ada; status orphan; tidak auto-attach ke quote match.                                                                                                                                                           |
| Float midpoint habis/collision                                                                     | Reindex sibling parent di transaction dan retry; jika invariant tetap gagal rollback.                                                                                                                                              |
| Client mengirim `BodySchemaVersion` lama                                                           | Tolak sebagai `schema_mismatch` sebelum merge/ACK; pertahankan pending IndexedDB sampai app kompatibel atau pemulihan eksplisit tersedia.                                                                                          |
| Yjs update memindahkan/mengurutkan node lama tanpa `MoveNode` atau menghapusnya tanpa `DeleteNode` | Projector menolak transaksi tanpa ACK/broadcast; body dan `body_version` tetap.                                                                                                                                                    |
| Restore saat ada collaborator                                                                      | Restore adalah accepted edit berurut; semua peserta menerima hasil atau resync ke version hasil.                                                                                                                                   |
| Parser menemukan syntax unknown                                                                    | Simpan bytes source sebagai opaque node baca saja atau batalkan import dengan laporan; blok lain tetap editable dan tidak ada content loss.                                                                                        |

## 16. Rencana verifikasi kontrak

Ini daftar validasi untuk fase implementasi; test belum dibuat/dijalankan oleh dokumen spesifikasi ini.

### Domain/body

- Valid/invalid parent-child grammar, root satu, parent same-document, cycle rejection.
- Stable IDs ketika edit text/reorder/reparent; ID baru saat insert; split/merge mempertahankan atau orphan anchor secara eksplisit.
- Float midpoint: normal insert, repeated insert, neighbor collision, edge insert, reindex parent, rollback jika gagal.
- `parent_id`/sibling order setelah insert/delete/reparent multi-level. Jika LTree diadopsi, uji path dan query subtree setelah rebuild.
- Import/export atas corpus synthetic golden berversi untuk setiap supported Muya block/inline mark dan opaque syntax; backup dokumen bukan fixture.
- Blok opaque mempertahankan ID, tipe, source bytes, dan jalur struktural penuh. Update Yjs yang memodifikasi/menghapus/reorder/reparent node opaque atau ancestor-nya ditolak server; edit isi dan insert sibling baru biasa tetap diterima. Penghapusan sibling existing memakai `DeleteNode`.

### Transaction/protocol

- Dua update sama document: tidak lost update, durable version monotonic, client converge.
- Update dokumen berbeda dapat berjalan paralel.
- ACK tidak dapat diamati sebelum commit berhasil.
- Revoke vs edit dua arah: revoke commit lebih dulu membuat update ditolak; edit yang memperoleh ACL lock lebih dulu harus commit sebelum revoke.
- Setiap update pada WebSocket yang sudah terbuka mengulang pemeriksaan ACL di dalam transaksi, bukan hanya saat join.
- Update Yjs yang mengubah parent/order node lama tanpa `MoveNode` atau menghapus node lama tanpa `DeleteNode` ditolak; command tervalidasi mengubah CRDT dan AST dalam satu commit.
- MoveNode commit + receipt atomik; ACK hilang lalu retry identik mengembalikan receipt tanpa perubahan versi. Uji no-op accepted move, retry setelah restore, payload berbeda pada ID yang sama, dan konflik belum commit.
- Create/duplicate request ID identik mengembalikan document ID yang sama; fingerprint berbeda ditolak. Import identik no-op; base version stale dengan source fingerprint berbeda ditolak.
- Browser restart offline: cache shell dan body online, tutup browser, putus jaringan, buka URL dokumen tersimpan, edit lokal, lalu reconnect dan sync setelah akses diverifikasi. Verifikasi token expiry mengunci tanpa menghapus pending dan login User yang sama melanjutkan proses.
- Simulasikan rollback, retry setelah ACK hilang, crash sesudah commit, Redis down, pesan terakhir pubsub hilang tanpa update berikutnya, pemeriksaan head berkala, dan state reload.
- Matriks akses pada list/detail/public link/retrieval, draft, proyek private, grant dokumen, join/update/revoke, dan workspace isolation. Revoke bersamaan edit harus mengikuti urutan ACL lock.
- Cross-mode simultaneous edit preserves node IDs, formatting, and anchors; if it fails, test the one-mode-per-session fallback.

### Comments/revisions/migration

- Anchor insert sebelum/range, delete di range, delete node, split/reparent, mode switch, restore.
- Replies/resolution tetap ada pada node delete/orphan dan restore.
- Comment anchor tahap pertama tetap dalam satu blok; selection lintas blok tidak disimpan sebagai anchor tunggal yang ambigu.
- Suggestion text/format/insert/delete/move blok: proposer comment tidak dapat langsung edit body, hanya proposer/editor melihat pending, acceptance sekali menaikkan versi, rejection tidak, konflik struktur ditahan, dan pending tidak masuk export/RAG.
- Acceptance Suggestion yang memindahkan/menghapus node lama mengikuti `MoveNode`/`DeleteNode`: perubahan struktur menaikkan epoch sekali bersama body/status/receipt commit dan seluruh pending epoch lama tetap tersimpan untuk review; retry tidak mengulang operasi.
- Named snapshot immutable; autosnapshot dapat berubah dalam window coalescing 10 menit lalu sealed; restore menambah revision baru.
- Restore menaikkan epoch tepat sekali pada retry `restore_request_id`; structural `MoveNode`/`DeleteNode` menaikkan epoch tepat sekali pada commit yang mengubah tree. Semuanya membangun AST/Yjs yang sama setelah restart dan menahan pending update lama untuk review tanpa otomatis menghidupkan kembali konten lama.
- MoveNode/DeleteNode yang mengubah tree menaikkan `body_version`/`body_epoch` atomik; update lama yang tiba sesudahnya ditolak sebagai stale dan dipertahankan untuk review, sedangkan no-op/retry tidak menaikkan versi atau epoch.
- UI perbandingan hasil restore dengan body lokal lama memungkinkan copy teks/blok terpilih hanya jika hak edit terkini ada; operasi baru memakai epoch baru, pending lama tidak hilang sampai pengguna menyelesaikan atau membuangnya.
- PostgreSQL dev backfill idempotent; local demo state is explicitly not imported. IndexedDB pending state survives reload/browser restart until durable ACK.
- Pembuatan dokumen dan grant owner atomic; restore dari Trash/permanent delete memakai owner grant saat ini dan workspace dokumen dari database, bukan header semata. Restore revision memerlukan hak edit.

### Offline/reconnect

- IndexedDB transaction selesai sebelum UI menyatakan “tersimpan di perangkat”; server ACK diperlukan untuk “tersinkron”.
- Offline multi-device edit merge, retry partial/duplicate ACK, schema migration IndexedDB, revoked access, command MoveNode/DeleteNode conflict/replay, dan `schema_mismatch` dengan pending data tetap tersimpan.
- Bedakan revoke edit dari revoke baca: yang pertama menyisakan pending blocked dan opsi ekspor; yang kedua menghapus cached body serta pending setelah dikonfirmasi server. Client yang tetap offline tidak boleh menerima update baru di server setelah revoke.
- Simulasikan kuota penuh, transaksi IndexedDB gagal, tab ditutup sebelum penyimpanan pulih, serta logout/ganti akun dengan pending edit. Status UI tidak boleh mengklaim saved sebelum transaksi lokal sukses; akun berikutnya tidak dapat membaca state sebelumnya.
- Dokumen yang belum tersimpan di perangkat dan create/import baru tidak menerima edit offline. Dua tab satu User+Document tidak dapat menulis queue lokal bersamaan; handoff setelah close/crash mempertahankan pending state.
- Uji delete node existing saat klien lain offline mengeditnya: `DeleteNode` mengubah AST/Yjs, `body_version`, `body_epoch`, dan receipt secara atomik; update epoch lama ditolak sebelum merge/ACK dan pending tetap tersimpan setelah reload/reconnect. Buktikan retry command sesudah ACK hilang mengembalikan receipt yang sama tanpa bump epoch kedua kali.
- RAG projection pada blok opaque hanya memasukkan teks yang dirender aman dan dapat dikutip; node yang dilewati membuat `coverage_status=partial` serta pesan cakupan terbatas bagi pengguna yang berizin.

### Production readiness

- Setelah angka disetujui: peak editors/document, total WebSocket connections, edit rate, p95 propagation, availability, RPO/RTO.
- Load test sambil merekam PG row-lock wait, tx latency, DB CPU/IO, binary state size, Redis throughput, event loop/Go goroutine pressure, resync volume.
- Failover PostgreSQL, Redis, collaboration runtime; verify ACKed update recovery and client convergence.
- Bila hot-document lock atau DB write volume gagal mencapai target, evaluasi per-document actor/sharding atau durable outbox/log dan revisi ADR sebelum rilis.

## 17. Open decisions yang sengaja ditinggalkan ke spike

1. Apakah gate correctness Go + ProseMirror/Yjs lulus; jika gagal, uji Hocuspocus sebagai fallback.
2. Bentuk exact Yjs shared type per node/block dan mekanisme round-trip Markdown import/export.
3. Ukuran payload/update limits, numerical capacity/SLO, Redis topology, Postgres HA topology, dan retention/compaction CRDT state.
4. Apakah pengukuran recovery Pub/Sub + gap detection/resync memenuhi target propagasi; tambahkan outbox/stream durable hanya bila terbukti perlu.
5. Angka kapasitas/SLO serta Postgres/Redis HA topology. Referensi video tidak menentukan angka; ukur dan putuskan di load-test gate.

Open decisions ini tidak membatalkan domain contract. Implementasi production tidak boleh mengunci runtime atau mengklaim high-scale readiness sebelum spike dan load/failover gates lulus.
