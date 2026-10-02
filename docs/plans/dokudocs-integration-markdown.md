# Plan integrasi Dokudocs dan hardening Markdown

Status dokumen: aktif untuk integrasi auth/workspace/project/API; jalur editor source dan body teks Markdown digantikan rencana AST
Baseline: 2026-09-21
Pemilik eksekusi: agent berikutnya

Dokumen ini adalah sumber tracking untuk integrasi frontend-backend Dokudocs. Tugas auth, workspace, project, metadata, trash, pemisahan user, dan E2E backend nyata tetap relevan. Tugas Monaco ↔ Muya, source Markdown sebagai jalur tulis, `documents.content` sebagai body Markdown kanonis, serta localStorage autosave sebagai jalur persistence produk **superseded** oleh [rencana AST/LTree/kolaborasi](dokudocs-ltree-collaborative-refactor.md) dan [gap closure](dokudocs-refactor-gap-closure.md); checklist historis di bawah tidak boleh dieksekusi sebagai arsitektur target. Update checklist dan `Progress log` pada pekerjaan yang masih relevan. Jangan menganggap test UI lokal sebagai bukti integrasi API.

## Ringkasan status


| Milestone | Fokus                                         | Status                    | Bukti terakhir                                                                                     |
| --------- | --------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| M0        | Baseline dan reproduksi                       | selesai sebagian          | Build/backend test lulus; full frontend test masih merah                                           |
| M1        | Kontrak dan adapter API domain                | selesai sebagian          | Adapter workspace/project/document list/detail/create memakai `apiFetch`; trash/access/revision masih memiliki gap |
| M2        | Integrasi workspace, project, document, trash | berjalan sebagian         | Workspace/project dan sebagian route Markdown AST/Yjs terhubung; backfill belum dijalankan dan consumer Markdown belum seluruhnya cutover |
| M3        | Editor persistence dan user isolation         | historis; superseded      | Flush Muya/localStorage hanya bukti regresi editor lama; persistence produk mengikuti G1–G4       |
| M4        | Sinkronisasi editor dan preview Markdown      | superseded                | Hasil test lama menjadi referensi regresi editor visual baru                                       |
| M5        | E2E dengan backend nyata                      | berjalan sebagian         | Smoke API workspace/DBML tersedia; route AST ada, tetapi alur Markdown lengkap masih menunggu backfill/cutover dan E2E nyata |
| M6        | Quality gate dan handoff                      | berjalan sebagian         | Build, test terarah, dan workflow PR smoke/nightly ada; full gate serta handoff belum selesai       |


## Temuan baseline yang tidak boleh hilang

- Backend memiliki route domain di `backend/internal/infrastructure/api/routes/`, termasuk document, project, workspace, trash, dan public document.
- Frontend hanya memakai `apiFetch` untuk auth/profile. Data dokumen saat ini berasal dari `frontend/src/stores/dokudocs-store.ts` dan persistence lokal.
- Workspace backend memakai UUID dan header `X-Workspace-Id`; model frontend masih memiliki `orgId`/mock ID seperti `org-1` dan `usr-1`.
- `go test ./...` lulus.
- `bun run build` lulus, dengan warning asset image unresolved dan chunk besar.
- `bun run lint` gagal: 323 masalah (295 error, 28 warning).
- Full `bun run test` gagal: 30 test gagal dari 1.642.
- Test fokus komponen editor lulus: 18/18.
- Test state/roundtrip Muya fokus lulus: 122/122.
- E2E Markdown lokal lulus: 4/4, tetapi belum memakai backend nyata.
- Regresi konkret: `frontend/src/features/docs/components/local-user-editor.browser.test.tsx` gagal pada flush input sebelum `switchLocalUser`.
- `replaceContent.spec.ts` gagal karena slug/ID block DOM berubah antar-eksekusi (`mu-N`), bukan karena assertion Markdown text utama.

## Milestone detail

### M0 — Baseline, reproducibility, dan kontrak kerja

Status: selesai sebagian

#### Sudah

- [x] Inventaris route backend dan sumber state frontend.
- [x] Jalankan baseline backend test, frontend build, lint, full test, focused editor test, dan E2E Markdown.
- [x] Catat working tree sebagai dirty; hasil audit tidak boleh dipakai untuk menyimpulkan semua perubahan berasal dari agent berikutnya.
- [x] Pisahkan bug integrasi dari failure library/test fixture.

#### Belum

- [ ] Sediakan environment yang menjalankan PostgreSQL, backend, dan frontend melalui proxy.
- [ ] Simpan hasil test baseline di CI atau artefak yang repeatable.
- [ ] Tambahkan satu smoke test yang membuktikan dokumen dibuat di backend lalu muncul setelah reload.

#### Exit criteria

Baseline dapat dijalankan ulang dengan command yang sama dan menghasilkan status yang terdokumentasi. Tidak ada test yang diberi label “passed” hanya karena mock/local store.

### M1 — Kontrak API dan adapter frontend domain

Status: selesai sebagian; adapter API dasar ada, trash/access/revision dan kontrak response/error masih perlu ditutup.

#### Scope minimum

- [ ] Petakan request/response backend untuk workspace, project, document, trash, revision, dan access.
- [ ] Tetapkan satu bentuk ID dan mapping frontend-backend; jangan meneruskan `org-1`/`usr-1` ke API nyata.
- [ ] Tambahkan adapter API domain menggunakan `apiFetch` yang sudah ada; jangan membuat client HTTP kedua.
- [ ] Sertakan `X-Workspace-Id` pada request yang membutuhkan workspace.
- [ ] Parse response envelope `{ data: ... }` dan error `{ title: ... }` di boundary API.
- [ ] Tentukan mapping metadata `type`, `isDraft`, `projectId`, `visibility`, `tags`, dan `categories`; untuk Markdown, `content` hanya hasil export AST pada read/import, bukan body write REST biasa.

#### Verifikasi

- Unit test adapter untuk success, 401, 404, 422/400, dan 5xx.
- Test memastikan workspace header tidak hilang.
- Test memastikan unknown/malformed response tidak masuk ke store sebagai data valid.

#### Exit criteria

Frontend memiliki satu sumber API domain yang dapat dipanggil tanpa mock. Tidak perlu mengubah seluruh UI pada milestone ini; adapter dan kontrak harus stabil dulu.

### M2 — Integrasi workspace, project, document, dan trash

Status: berjalan sebagian; beberapa alur UI memakai API AST/Yjs, tetapi backfill dan perpindahan seluruh consumer Markdown belum selesai.

#### Urutan implementasi

1. Workspace aktif dan daftar workspace.
2. Project aktif dan daftar project.
3. Document list/detail/create/update/delete-to-trash/restore.
4. Revision/autosave dan metadata document.
5. Search/filter/sort setelah source of truth server sudah benar.

#### Checklist

- [ ] Ganti `defaultOrganizations`, `mockProjects`, `mockDocuments`, dan `mockTrash` sebagai source utama dengan query server.
- [ ] Pertahankan Zustand hanya untuk UI state ringan: selection, mode, panel, dan optimistic state bila memang diperlukan.
- [ ] Gunakan TanStack Query untuk server state, cache, invalidation, dan mutation status.
- [ ] Setelah create/update/delete, invalidate query yang tepat; jangan reload seluruh aplikasi.
- [ ] Tampilkan loading, empty, 401/403, 404, conflict, dan 5xx secara eksplisit.
- [ ] Pastikan dokumen tidak bisa dibaca atau dimutasi lintas workspace.
- [ ] Pastikan route editor mengambil document detail dari backend, bukan fallback diam-diam ke mock.

#### Exit criteria

Create → reload → read kembali dari backend berhasil. Edit Markdown melalui jalur AST/kolaborasi → reload browser → isi tetap sama. Delete/restore mengikuti API dan tidak hanya mengubah localStorage.

### M3 — Editor persistence dan isolasi user

Status: historis; jalur flush/autosave localStorage superseded oleh persistence AST/Yjs pada G1–G4. Isolasi auth/workspace yang tidak bergantung pada editor tetap aktif pada milestone terkait.

#### Temuan historis

Pending input Muya pernah hilang ketika `switchLocalUser` dipanggil; regression test tetap berguna selama editor lama masih ada, tetapi jangan memperluas localStorage sebagai persistence Markdown produk.

#### Checklist historis — jangan jalankan sebagai desain persistence target

- [ ] Tentukan satu pemilik flush. `switchLocalUser`, `changeUser`, dan editor tidak boleh melakukan flush yang tumpang tindih tanpa kontrak urutan yang jelas.
- [ ] Pastikan flush membaca Markdown terbaru dari Muya sebelum scope user berubah.
- [ ] Pastikan save timer dibatalkan setelah flush dan tidak dapat menulis ke user baru.
- [ ] Pastikan async thumbnail/revision dari user lama tidak masuk ke user baru.
- [ ] Pastikan logout/switch user mempertahankan draft user lama tanpa menampilkannya ke user lain.
- [ ] Tambahkan test memakai event/input pengguna nyata, bukan hanya `document.execCommand`.
- [ ] Tambahkan test: ketik → switch user → login kembali → pending content tetap ada.

#### Exit criteria

Test regresi flush lulus secara repeatable. Tidak ada kehilangan input pada switch user, logout, unmount editor, atau route change. Isolasi local storage tetap kompatibel dengan integrasi server.

### M4 — Sinkronisasi Monaco, Muya, dan preview Markdown

Status: historis; jalur Monaco ↔ Muya dan source editor superseded oleh pengalaman view/editor/suggestion berbasis AST. Temuan kehilangan input, identitas node, dan preview read-only tetap menjadi kriteria regresi pada editor terpilih.

#### Bug/risk aktif

- `UnifiedMonacoEditor` dan `MuyaEditor` melakukan mutasi editor/state pada jalur render; ini adalah boundary berisiko untuk overwrite dan loop sinkronisasi.
- `replaceContent.spec.ts` gagal karena ID block DOM global berubah antar-test.
- Failure image/Prism/drag-drop/formatting perlu dipisahkan antara bug production dan fixture/library issue.

#### Checklist

- [ ] Tetapkan source of truth selama perpindahan Monaco ↔ Muya: content prop, editor instance, atau store; satu saja per transisi.
- [ ] Pastikan external content update tidak menimpa ketikan lokal yang belum di-flush.
- [ ] Pastikan switch mode tidak memicu duplicate `onChange`, duplicate revision, atau caret jump.
- [ ] Pindahkan mutasi editor dan state derived ke lifecycle/event yang benar tanpa menambah direct `useEffect`.
- [ ] Stabilkan ID/slug block untuk test dan runtime, atau reset generator ID di setup test bila identitas memang hanya lokal.
- [ ] Verifikasi `getMarkdown()` roundtrip untuk heading, list, quote, code fence, table, link/image, Mermaid, LaTeX, dan HTML.
- [ ] Verifikasi preview read-only: tidak editable, drag handle tersembunyi, dan tidak ada mutation ke store.
- [ ] Klasifikasikan failure Muya utility menjadi production bug, test-environment bug, atau unsupported feature.

#### Exit criteria

Focused editor tests, Muya state tests, preview tests, dan regression tests lulus. Markdown yang disimpan ke backend identik dengan Markdown yang dibuka kembali; perbedaan HTML internal tidak boleh mengubah isi atau struktur dokumen.

## Catatan historis: TDD editor lama

Status: TDD-1 sampai TDD-4 selesai untuk scope editor/preview lama; TDD-5 berjalan sebagian (image path selesai). Jalur Monaco ↔ Muya dan source Markdown sudah superseded; item tersisa di bagian ini bukan antrean implementasi AST/API.

Catatan ini merekam bukti regresi lama. Gunakan hanya bila komponen lama masih menjadi caller aktif atau saat memindahkan perilaku yang sama ke editor AST. Correctness editor AST, WebSocket, serta recovery sekarang mengikuti G1/G3; cutover body mengikuti G2. Jangan menahan integrasi auth/workspace/API karena failure utility pada jalur editor yang superseded.

### Seam yang diuji

Sebelum test baru ditulis, gunakan dan konfirmasi seam publik berikut:


| Seam                | Perilaku yang diamati                                                                         | Bentuk test                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Editor lifecycle    | User mengetik Markdown lalu switch user/logout/unmount; isi terakhir tetap tersimpan          | Vitest browser melalui UI dan local-user lifecycle                                  |
| Mode transition     | User berpindah Monaco ↔ Muya; Markdown tetap identik dan tidak terduplikasi                   | Vitest browser melalui kontrol mode dan editor DOM                                  |
| Preview contract    | Preview menampilkan hasil Markdown, read-only, dan tidak mengubah content saat hanya dibaca   | Vitest browser atau Playwright UI                                                   |
| Content replacement | External document update mengganti content tanpa merusak block, caret, atau struktur Markdown | Test melalui public editor content/mode API; hindari assertion terhadap private ref |


### Urutan slice red → green

#### TDD-1 — Flush pending Muya sebelum switch user

Status: selesai

- [x] Reproduksi failure existing di `local-user-editor.browser.test.tsx`.
- [x] Ubah test menjadi input pengguna nyata pada seam editor, bukan hanya `document.execCommand`.
- [x] Tegaskan hasil publik: setelah switch user lalu login kembali, pending Markdown dan revision milik user lama tetap ada.
- [x] Telusuri seluruh caller flush: `switchLocalUser`, `changeUser`, `use-doc-editor`, dan `registerEditorWidgetFlush`.
- [x] Pilih satu pemilik flush dan satu urutan lifecycle.
- [x] Buat fix minimum untuk membuat test hijau.
- [x] Jalankan test focused yang sama dan satu test logout/unmount terkait.

Exit criteria: tidak ada pending input hilang saat switch user, logout, unmount, atau route change; tidak ada save async dari user lama yang menulis ke user baru.

#### TDD-2 — Monaco → Muya → Monaco mempertahankan Markdown

Status: selesai sebagian; mode roundtrip utama sudah hijau

- [x] Tulis test merah melalui mode switch publik dengan fixture Markdown yang mencakup heading dan paragraph; fixture kompleks tetap menjadi follow-up.
- [x] Verifikasi content editor setelah setiap perpindahan mode menggunakan Markdown text, bukan snapshot HTML internal.
- [ ] Verifikasi satu perubahan user menghasilkan satu content update/revision yang dapat diamati.
- [x] Perbaiki source of truth dan timing update dengan diff sekecil mungkin.
- [ ] Pastikan external content update tidak menimpa ketikan lokal yang belum di-flush.

Exit criteria: content roundtrip identik, tidak ada overwrite, duplicate save, atau caret jump yang terlihat pada alur utama.

#### TDD-3 — Preview read-only dan live render

Status: sebagian sudah ter-cover oleh E2E, belum cukup sebagai regression suite

- [x] Pertahankan test bahwa preview view menolak typing dan menyembunyikan drag handles.
- [ ] Tambahkan fixture Markdown yang mencakup elemen yang sebelumnya bermasalah.
- [ ] Tegaskan bahwa masuk/keluar preview tidak mengubah Markdown store.
- [ ] Tegaskan bahwa render failure pada Mermaid/LaTeX tidak menghapus atau mengganti content asli.
- [ ] Jika test gagal, perbaiki boundary preview; jangan menambal assertion dengan snapshot HTML yang rapuh.

Exit criteria: preview read-only, render failure terisolasi, dan content tetap sama sebelum/sesudah preview.

#### TDD-4 — `replaceContent` dan identitas block

Status: selesai

- [x] Ubah assertion agar menguji perilaku block/Markdown yang stabil, bukan counter global `mu-N`, kecuali ID tersebut memang kontrak produk.
- [x] Gunakan test existing untuk memastikan replacement tidak menggandakan block dan tidak meninggalkan block lama.
- [x] Biarkan generator ID tetap instance-local; normalizer test mengisolasi `data-slug` runtime yang bukan kontrak lintas instance.
- [x] Verifikasi ulang struktur replacement melalui suite undo/redo dan roundtrip.

Exit criteria: replacement repeatable antar-test dan antar-mount; struktur Markdown tidak berubah hanya karena ID DOM berbeda.

#### TDD-5 — Triage failure utility Markdown

Status: sebagian — image path selesai; Prism, drag-drop image, formatting, dan baseFloat belum ditangani

- [x] Kelompokkan failure image path sebagai satu slice; kelompok Prism grammar, drag-drop image, backspace formatting, dan baseFloat masih tersisa.
- [x] Untuk image path, buat reproduksi focused pada seam publik `getImageSrc` sebelum mengubah implementation.
- [x] Klasifikasikan image path sebagai production bug: `getImageSrc` hanya passthrough sehingga local path dan extensionless remote image kehilangan kontrak renderer.
- [ ] Untuk tiap kelompok tersisa, buat satu reproduksi user-facing sebelum mengubah implementation.
- [ ] Jika hanya test fixture/runtime dependency yang rusak, perbaiki fixture atau catat known limitation terpisah.
- [ ] Jangan memasukkan perubahan utility yang tidak diperlukan ke fix editor/preview utama.

Exit criteria: setiap failure tersisa memiliki klasifikasi dan owner; tidak ada failure yang disembunyikan dengan skip tanpa alasan.

### Aturan TDD untuk slice ini

1. Satu seam dan satu test merah per slice.
2. Assertion harus memakai perilaku publik: Markdown content, mode, persistence, dan kemampuan mengetik; bukan ref, call count internal, atau slug counter kecuali itu kontrak.
3. Setelah test merah, ubah kode sesedikit mungkin sampai hijau.
4. Refactor hanya setelah test slice hijau dan focused suite lulus.
5. Setiap slice wajib menambahkan entry ke `Progress log` dengan command dan hasil.
6. Aturan historis: urutan “perbaiki bug editor lama sebelum API” sudah superseded oleh rencana AST/G1–G3.

### M5 — E2E frontend-backend dengan runtime nyata

Status: berjalan sebagian untuk API E2E workspace/project/non-Markdown. Acceptance Markdown menunggu Gate G2, migrasi backend dev/demo, dan cutover consumer.

#### Checklist

- [ ] Jalankan PostgreSQL, migration, seeder/test fixtures, backend, dan frontend proxy.
- [ ] Tambahkan API E2E untuk workspace/project/document CRUD.
- [ ] Setelah Gate G2, tambahkan browser E2E: login → pilih workspace → buka document → edit body AST/Yjs → reload → verifikasi body dan ekspor Markdown.
- [ ] Tambahkan browser E2E untuk create, trash, restore, permission denial, dan workspace isolation.
- [ ] Setelah offline lifecycle G3, tambahkan browser E2E untuk switch user/logout ketika ada pending kolaborasi.
- [ ] Tambahkan test untuk API error yang terlihat jelas di UI.
- [ ] Pastikan E2E tidak mengandalkan `mockUser`, `localStorage` seeded document, atau mock auth untuk acceptance path.

#### Exit criteria

Minimal satu alur end-to-end membuktikan data bergerak: browser → frontend API adapter → backend → database → browser reload. Test tetap lulus setelah localStorage dihapus.

### M6 — Quality gate dan handoff

Status: berjalan sebagian; build dan pemeriksaan terarah sudah berjalan, tetapi full gate dan dokumentasi handoff belum selesai.

#### Checklist

- [ ] `go test ./...` lulus.
- [ ] Focused frontend tests untuk area yang diubah lulus.
- [ ] Full `bun run test` lulus atau failure yang tersisa diberi issue terpisah dengan alasan yang terverifikasi.
- [ ] `bun run build` lulus tanpa warning baru yang terkait perubahan.
- [ ] Lint area yang diubah lulus; lint legacy/vendor dipisahkan dari regression baru.
- [ ] Dokumentasikan env, migration, seed, command test, dan known limitation.
- [ ] Update semua checklist milestone dan `Progress log`.

#### Exit criteria

Agent berikutnya dapat menjalankan pemeriksaan yang relevan dan melanjutkan hanya item integrasi yang belum selesai; item Monaco/body teks yang superseded tidak menjadi antrean implementasi.

## Aturan eksekusi untuk agent berikutnya

1. Kerjakan satu milestone atau satu slice vertikal kecil per perubahan.
2. Sebelum mengedit, baca caller dan test yang sudah ada untuk fungsi yang disentuh.
3. Jangan menghapus mock/local persistence sebelum adapter server dan fallback/error state tersedia.
4. Jangan menandai milestone selesai hanya karena build lulus; gunakan exit criteria.
5. Setelah setiap slice, update checklist, command yang dijalankan, hasil, dan blocker di `Progress log`.
6. Jika menemukan scope baru, tambahkan sebagai item atau milestone; jangan menyelipkan pekerjaan besar tanpa catatan.
7. Pertahankan perubahan user yang sudah ada; working tree bukan baseline bersih.

## Progress log

### 2026-09-28 — Integrasi workspace/document dan test environment

- Milestone: M1/M2/M5/M6, parsial.
- Selesai: adapter API domain memakai `apiFetch`, validasi Zod, dan header workspace; workspace/project/document list/detail/create terhubung ke dashboard/dialog.
- Selesai: create DBML/Mermaid memakai API backend; Markdown tetap tidak menulis body melalui REST legacy sambil menunggu endpoint AST.
- Selesai: test-seed yang hanya menerima `TEST_DATABASE_URL` untuk database `dokudocs_test`, Compose PostgreSQL disposable, dan target `make test-e2e-smoke`.
- Selesai: live smoke membuat workspace dan DBML lalu menghapus cache workspace UI dan memastikan dokumen dibaca kembali dari API.
- Selesai: workflow GitHub Actions untuk backend/frontend quality, PR smoke, dan nightly full API/UI E2E; artifact Playwright diunggah saat gagal.
- Belum: workflow belum dijalankan di GitHub; lint penuh sengaja advisory sampai baseline error lama ditangani.
- Belum: integrasi trash/access/revision, CRUD penuh, dan alur create/edit/reload Markdown melalui AST.
- Verifikasi: frontend domain/dashboard/dialog tests 15/15; dashboard E2E 4/4; `make test-e2e-smoke` 1/1; `go test ./cmd/testseed ./database/seeders` lulus; frontend build dan scoped ESLint lulus.
- Next: lanjutkan migration/projector AST dan acceptance test G1/G2 sebelum mengubah jalur penyimpanan Markdown.

### 2026-09-21 — Baseline audit

- Selesai: audit route backend dan sumber state frontend.
- Selesai: `go test ./...` lulus.
- Selesai: `bun run build` lulus.
- Selesai: focused editor tests 18/18 lulus.
- Selesai: focused Muya state/roundtrip tests 122/122 lulus.
- Selesai: Markdown UI E2E 4/4 lulus dengan mock/local data.
- Ditemukan: full frontend test 30 gagal dari 1.642.
- Ditemukan: lint 323 masalah.
- Ditemukan: flush pending Muya input gagal saat switch user.
- Ditemukan: frontend belum memakai document/project/workspace API backend.
- Blocker: runtime Docker/API belum dapat diverifikasi dari environment audit.

### 2026-09-21 — Prioritas TDD editor/preview

- Selesai: menetapkan scope awal pada flush editor, mode transition, preview contract, dan `replaceContent`.
- Selesai: menetapkan seam publik dan urutan slice TDD-1 sampai TDD-5.
- Belum: belum menulis test baru atau mengubah kode sebelum seam dikonfirmasi.
- Next: mulai TDD-1 dengan test flush yang memakai input pengguna nyata.

### 2026-09-21 — Eksekusi TDD-1 sampai TDD-4

- Selesai: TDD-1; `switchLocalUser` sekarang memiliki satu pemilik flush/persist dan pending Muya input tidak hilang.
- Selesai: test lifecycle memakai `userEvent` pada contenteditable, bukan `document.execCommand`.
- Selesai: TDD-2; mode Monaco → Preview/Muya → Monaco mempertahankan Markdown kanonik.
- Selesai: replacement Muya dijadwalkan setelah render dan diberi guard terhadap editor/content stale.
- Selesai: TDD-4; normalizer `replaceContent` mengabaikan `data-slug` instance-local.
- Verifikasi: focused editor suite → 24/24 lulus.
- Verifikasi: `replaceContent.spec.ts` → 28/28 lulus.
- Verifikasi: Markdown UI E2E → 4/4 lulus.
- Verifikasi: scoped ESLint untuk file slice → lulus.
- Verifikasi: `bun run build` → lulus; warning asset image dan chunk besar tetap ada.
- Verifikasi tambahan: full `bun run test` tetap merah; 26 assertion failures, 3 dynamic-import suite failures, dan 1 browser iframe unhandled error. Failure berada di utility Prism/image/drag-drop/format/baseFloat atau test infrastructure, bukan focused editor slice.
- Belum: TDD-3 belum menambah fixture Mermaid/LaTeX failure isolation; TDD-5 masih menyisakan Prism, drag-drop, formatting, dan baseFloat.
- Blocker: visual Birdview preview tidak dapat dibuka karena environment tidak menyediakan browser surface.
- Next: lanjutkan TDD-5 pada Prism/drag-drop/formatting/baseFloat; jangan mulai adapter API domain sebelum failure utility yang relevan diklasifikasikan.

### 2026-09-21 — Eksekusi TDD-5 image path

- Milestone: TDD-5, kelompok `getImageSrc`/image preview.
- Selesai: restore resolver path lokal di `frontend/src/features/docs/lib/muya/utils/image.ts` dengan perilaku kompatibel MarkText: relative path memakai `window.DIRNAME`, absolute POSIX/Windows/UNC menjadi `file://`, dan `file://` tidak mendapat prefix ganda.
- Selesai: extensionless HTTP URL ditandai `isUnknownType: true` agar content-type detection tetap berjalan; data dan `blob:` URL tetap dipertahankan.
- Selesai: komentar kontrak `window.DIRNAME` diperbarui di `frontend/src/features/docs/lib/muya/types/global.d.ts`.
- Verifikasi merah: image utility → 14 gagal, 12 lulus.
- Verifikasi hijau: `bun run test src/features/docs/lib/muya/utils/__tests__/image.spec.ts --reporter=verbose` → 26/26 lulus.
- Verifikasi caller: `bun run test src/features/docs/lib/muya/inlineRenderer/renderer/__tests__/image.spec.ts --reporter=verbose` → 10/10 lulus.
- Verifikasi build: `bun run build` → lulus; warning asset image dan chunk besar tetap existing.
- Verifikasi lint: scoped utility/test lulus dengan satu warning existing `unused eslint-disable`; lint `global.d.ts` tetap gagal karena konfigurasi repo tidak mendefinisikan rule `ts/naming-convention`.
- Belum: Prism grammar, drag-drop image, backspace formatting, dan baseFloat masih memiliki failure dari full suite dan belum diubah.
- Next: pilih satu kelompok utility tersisa, mulai dari Prism atau drag-drop sesuai prioritas produk, dengan reproduksi focused baru.

### Template update

```text
### YYYY-MM-DD — <agent atau slice>

- Milestone: Mx
- Selesai: <item dan file/test yang membuktikan>
- Belum: <item yang masih terbuka>
- Verifikasi: <command> → <hasil>
- Blocker/risiko: <jika ada>
- Next: <satu langkah terkecil berikutnya>
```

## Referensi teknis

- Domain API: `backend/internal/infrastructure/api/routes/`
- Backend request/response document: `backend/internal/presentation/document/`
- Frontend API client: `frontend/src/lib/api-client.ts`
- Frontend document store saat ini: `frontend/src/stores/dokudocs-store.ts`
- Editor page: `frontend/src/features/docs/components/markdown-editor.tsx`
- Monaco wrapper: `frontend/src/features/docs/components/unified-monaco-editor.tsx`
- Muya wrapper: `frontend/src/features/docs/components/muya-editor/MuyaEditor.tsx`
- Flush lifecycle: `frontend/src/features/docs/lib/editor-flush.ts`, `frontend/src/lib/local-user-data.ts`, `frontend/src/lib/user-storage.ts`
- Existing auth integration scope: `docs/plans/auth-integration.md`
