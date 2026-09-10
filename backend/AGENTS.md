# AGENTS.md

Panduan arsitektur, batas tanggung jawab layer, konvensi teknis, dan alur request backend DokuDocs Go. Wajib dipatuhi oleh agent dan developer saat memodifikasi atau menambah fitur baru di `backend/`.

---

## Ringkasan Arsitektur

Backend DokuDocs dibangun dengan pendekatan **Pragmatic Layered / Clean Architecture** menggunakan **Go 1.22+ Standard Library** (`net/http`) dan pure `database/sql` dengan driver PostgreSQL (`github.com/jackc/pgx/v5/stdlib`).

- **Router**: Go 1.22+ `http.ServeMux` dengan method-based pattern routing (`GET /api/v1/projects/{id}`) dan `r.PathValue("id")`. Dikelola modular melalui helper `routes.NewGroup`.
- **Database**: Pure `database/sql` dengan PostgreSQL parameterized query (`$1`, `$2`). Abstraksi query interface via `database.Queryer` dan `database.DB` (`WithTransaction`).
- **Multi-Tenancy**: Workspace-scoped data isolation via header `X-Workspace-Id` (fallback query param `workspace_id`) yang divalidasi oleh middleware `RequireWorkspace`.
- **Response Format**: Strict JSON envelope via `presentation/response`:
  - Sukses: `response.Data(w, statusCode, payload)` -> `{"data": ...}`
  - Gagal: `response.Error(w, statusCode, title)` -> `{"title": ...}`
- **Request Validation**: Strict JSON decoding via `response.DecodeJSON(r, &req)` (`DisallowUnknownFields()`) dan reflection validator struct tag `validate:"required"`.

---

## Struktur Direktori

```text
backend/
├── cmd/
│   ├── server/                  # Entry point HTTP REST API
│   ├── migrate/                 # Custom pure SQL migration runner (up, down, status)
│   └── seeder/                  # Database seeder execution (admin user, demo data)
├── constant/
│   └── errors.go                # Domain error constants terstandar
├── database/
│   ├── migrations/              # SQL migration pairs: YYYYMMDDHHMMSS_<name>.up.sql & .down.sql
│   └── seeders/                 # Seeder implementations (admin_user.go, demo_data.go, registry.go)
├── internal/
│   ├── application/             # Application business logic & use cases
│   │   ├── auth/                # Auth logic & DTO
│   │   ├── document/            # Document, trash, collaborator, access use cases & DTO
│   │   ├── jwt/                 # JWT token generation & verification
│   │   ├── project/             # Project, category, member, star use cases & DTO
│   │   ├── user/                # User profile & settings use cases & DTO
│   │   ├── utils/               # Crypt (bcrypt) & application helpers
│   │   └── workspace/           # Workspace & member use cases & DTO
│   ├── config/                  # Environment config parsing
│   ├── domain/                  # Enterprise domain core (zero external dependencies)
│   │   ├── contract/
│   │   │   ├── repository/      # Interface kontrak repository per domain
│   │   │   └── usecase/         # Interface kontrak use case per domain
│   │   └── model/               # Pure domain structs (User, Workspace, Project, Document, dll.)
│   ├── infrastructure/          # Adapters & technical implementations
│   │   ├── api/
│   │   │   ├── routes/          # Modular route registration & router_group abstraction
│   │   │   ├── router_group.go  # Go 1.22+ ServeMux grouping & middleware chaining
│   │   │   └── server.go        # HTTP server lifecycle & graceful shutdown
│   │   ├── database/            # Queryer & DB interfaces, WithTransaction abstraction
│   │   ├── logger/              # Structured logger
│   │   ├── postgres/            # PostgreSQL connection pool initializer
│   │   ├── repository/          # Concrete SQL repository implementations per domain
│   │   ├── runtime/container/   # Dependency injection container (DB, Logger, Validator)
│   │   └── validator/           # Minimalist reflection-based struct validator
│   └── presentation/            # HTTP transport boundary (net/http only)
│       ├── <domain>/
│       │   ├── handler/         # HTTP handlers (parse request, invoke usecase, write response)
│       │   └── presenter/       # Request DTOs & response schemas
│       ├── middleware/          # HTTP middlewares (Logger, Recover, CORS, ValidateToken, RequireWorkspace)
│       ├── request/             # Request helpers & validation title formatter
│       └── response/            # JSON response envelope (Data, Error, DecodeJSON)
├── Makefile                     # Docker, migration, seeder, dan test commands
└── go.mod
```

---

## 5-Tier Layer Architecture & Alur Request

Arah dependensi selalu mengalir ke dalam (**Inward Dependency Rule**):

```text
HTTP Request
  │
  ▼
[1. Route Layer]             (internal/infrastructure/api/routes)
  │  Mencocokkan method & pattern (Go 1.22 ServeMux)
  ▼
[2. Presentation Layer]      (internal/presentation/<domain>)
  │  Middleware -> Decode JSON -> Validate -> Extract Context
  ▼
[3. Application Layer]       (internal/application/<domain>/usecase)
  │  Business Orchestration, Role Guard, Transaction Boundary
  ▼
[4. Domain Layer]            (internal/domain/contract & model)
  │  Kontrak interface repository & struct domain data murni
  ▼
[5. Infrastructure Layer]    (internal/infrastructure/repository/<domain>)
  │  Raw parameterized SQL queries ($1, $2) -> Scan ke Model
  ▼
PostgreSQL Database
```

### 1. Route Layer (`internal/infrastructure/api/routes`)
- Mendaftarkan rute dengan method helper (`Get`, `Post`, `Put`, `Patch`, `Delete`).
- Memasang middleware level-grup atau level-route menggunakan `Group.Use(...)`.
- Menginjeksi dependency dari `container.Container` ke constructor use case dan handler.

### 2. Presentation Layer (`internal/presentation/<domain>/handler`)
- **Tanggung Jawab**: Boundary protokol HTTP saja.
- Mengambil parameter URL path via Go 1.22 `r.PathValue("param")`.
- Mem-parsing body dengan `response.DecodeJSON(r, &req)`.
- Memvalidasi data dengan `h.validate.Struct(req)`.
- Mengambil identitas user dan workspace dari context:
  - `middleware.UserFromContext(r.Context())`
  - `middleware.WorkspaceFromContext(r.Context())`
  - Helper lokal `getUserAndWorkspace(r)`
- Memanggil method usecase dengan `r.Context()`.
- Mengembalikan response menggunakan `response.Data` atau `response.Error`.

### 3. Application Layer (`internal/application/<domain>/usecase`)
- **Tanggung Jawab**: Logika bisnis inti, otorisasi per aksi, dan boundary transaksi.
- Menerima parameter bertipe primitif atau application DTO (`dto.CreateProjectInput`).
- Memeriksa hak akses (misal: apakah user berhak mengedit project/dokumen tertentu).
- Mengelola transaksi multi-tabel via `u.db.WithTransaction(ctx, func(tx database.Queryer) error { ... })`.
- Tidak boleh mengandung dependensi HTTP (`http.Request`, `http.ResponseWriter`, header, status code).

### 4. Domain Layer (`internal/domain`)
- `model/`: Struct data murni yang mewakili entitas sistem (misal: `model.Document`, `model.Project`).
  - **Aturan Serialisasi JSON**: Slice child (seperti `Categories`, `Tags`, `Members`) **wajib** diinisialisasi dengan `make([]T, 0)` sebelum di-return agar ter-marshal menjadi array kosong `[]` di JSON, bukan `null`.
- `contract/repository/`: Interface persistence yang dibutuhkan oleh usecase.
- `contract/usecase/`: Interface usecase yang dikonsumsi oleh presentation handler.

### 5. Infrastructure Repository Layer (`internal/infrastructure/repository/<domain>`)
- **Tanggung Jawab**: Eksekusi SQL query langsung ke PostgreSQL.
- Menerima `database.Queryer` pada constructor atau per method agar kompatibel baik dengan `*sql.DB` maupun `*sql.Tx`.
- Wajib menggunakan placeholder query PostgreSQL `$1`, `$2`, dst. Hindari string formatting untuk value query!
- Mapping row hasil query ke domain `model.*`.
- Mengembalikan error database asli (`sql.ErrNoRows`, db error) ke usecase tanpa dibungkus status HTTP.

---

## Multi-Tenancy & Workspace Authorization Model

Sistem DokuDocs mengisolasi resource per workspace.

### Workspace Context Injection
Rute yang memerlukan konteks workspace dilindungi oleh middleware `RequireWorkspace`:
```go
// Header utama: X-Workspace-Id: <UUID>
// Fallback query parameter: ?workspace_id=<UUID>
wsGroup := appGroup.Group("/workspaces/{workspace_id}", middleware.RequireWorkspace(workspaceService))
```

Middleware memverifikasi keanggotaan user pada workspace tersebut di database. Jika valid:
1. `workspaceID` (`uuid.UUID`) di-set ke request context (`workspaceIDContextKey`).
2. `workspaceRole` (`string`: `owner`, `admin`, `member`, `guest`) di-set ke context (`workspaceRoleContextKey`).

### Otorisasi Bertingkat (Role Hierarchy)
Pemeriksaan otorisasi dilakukan di Application Use Case layer:
1. **Workspace Level**:
   - `owner` / `admin`: Memiliki kontrol administratif penuh atas workspace, seluruh project, dan seluruh dokumen.
   - `member`: Dapat membuat project, melihat project internal, dan mengelola project miliknya.
   - `guest`: Akses terbatas hanya pada project dan dokumen yang dibagikan secara eksplisit.
2. **Project Level** (`project_members`):
   - `manager`: Mengelola metadata project, kategori, dan anggota project.
   - `editor`: Membuat dan mengedit dokumen di dalam project.
   - `viewer`: Hanya membaca dokumen di dalam project.
3. **Document Level** (`document_accesses` & `visibility`):
   - `public`: Dapat diakses unauthenticated via public share token `GET /api/v1/public/documents/{shareToken}`.
   - `internal`: Dapat diakses oleh seluruh anggota workspace.
   - `private`: Hanya pemilik dan user yang diberi akses eksplisit di `document_accesses` (`can_read`, `can_edit`).

---

## Database, Transaksi & Migrasi

### Abstraksi Database
```go
// database.Queryer diimplementasikan oleh *sql.DB dan *sql.Tx
type Queryer interface {
    QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
    QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
    ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
```

### Menjalankan Transaksi
Gunakan `WithTransaction` pada `database.DB` untuk operasi yang menulis ke lebih dari satu tabel:
```go
err := u.db.WithTransaction(ctx, func(tx database.Queryer) error {
    repo := u.projectRepo.WithTx(tx) // atau pass tx ke NewRepository(tx)
    if err := repo.InsertProject(ctx, p); err != nil {
        return err // otomatis rollback
    }
    return repo.InsertCategory(ctx, cat)
    // jika return nil, otomatis commit
})
```

### Dynamic IN-Clause Placeholder
Untuk query dengan `WHERE id IN (...)`, bangun placeholder dinamis:
```go
placeholders := make([]string, len(ids))
args := make([]any, len(ids))
for i, id := range ids {
    placeholders[i] = fmt.Sprintf("$%d", i+1)
    args[i] = id
}
query := fmt.Sprintf("SELECT ... WHERE id IN (%s)", strings.Join(placeholders, ", "))
```

### Migrasi Database (`cmd/migrate`)
Database migrations dikelola melalui Go CLI murni di `cmd/migrate/main.go` yang mencatat eksekusi di tabel `schema_migrations`:
- File migrasi berada di `database/migrations/` dengan format nama: `YYYYMMDDHHMMSS_<name>.up.sql` dan `YYYYMMDDHHMMSS_<name>.down.sql`.
- Perintah Makefile:
  - `make migrate-create MIGRATION_NAME=create_feature_table` : Membuat sepasang template up/down migrasi.
  - `make migrate-up` : Menjalankan migrasi pending.
  - `make migrate-down` : Me-rollback 1 migrasi terakhir.
  - `make migrate-status` : Menampilkan status migrasi.
  - `make seed` : Menjalankan migrasi up lalu mengeksekusi `cmd/seeder`.

---

## Konvensi Request, Response & Error Handling

### Request Parsing & Validation
```go
var req presenter.CreateDocumentRequest
if err := response.DecodeJSON(r, &req); err != nil {
    response.Error(w, http.StatusBadRequest, "invalid JSON body")
    return
}
if err := h.validate.Struct(req); err != nil {
    response.Error(w, http.StatusBadRequest, err.Error())
    return
}
```

### JSON Response Envelope
Setiap endpoint REST API **wajib** menggunakan format envelope terstandar:
- **Sukses** (`response.Data`):
  ```json
  {
    "data": {
      "id": "c1f7203b-...",
      "name": "General Documentation"
    }
  }
  ```
- **Error** (`response.Error`):
  ```json
  {
    "title": "document not found"
  }
  ```

### Error Mapping di Handler
Mapping error konstan domain (`constant/errors.go`) ke HTTP Status Code yang sesuai di presentation handler:
```go
switch {
case errors.Is(err, constant.ErrUnauthorized):
    response.Error(w, http.StatusUnauthorized, err.Error())
case errors.Is(err, constant.ErrForbidden):
    response.Error(w, http.StatusForbidden, err.Error())
case errors.Is(err, constant.ErrDocumentNotFound):
    response.Error(w, http.StatusNotFound, err.Error())
case errors.Is(err, constant.ErrInvalidCredentials):
    response.Error(w, http.StatusBadRequest, err.Error())
default:
    response.Error(w, http.StatusInternalServerError, err.Error())
}
```

---

## Resep: Menambah Endpoint/Fitur Baru

Ikuti urutan langkah ini secara disiplin saat mengimplementasikan fitur atau endpoint baru:

1. **Schema & Migration**:
   - Jika membutuhkan tabel/kolom baru, buat file migrasi dengan `make migrate-create MIGRATION_NAME=<nama>`.
   - Tulis DDL di `.up.sql` dan rollback di `.down.sql`.
   - Jalankan `make migrate-up`.
2. **Domain Model**:
   - Tambahkan atau sesuaikan struct entitas di `internal/domain/model/<feature>.go`.
   - Pastikan field slice diinisialisasi non-nil (`make([]T, 0)`).
3. **Domain Contracts**:
   - Tentukan method repository di `internal/domain/contract/repository/<feature>_repository.go`.
   - Tentukan method use case di `internal/domain/contract/usecase/<feature>_usecase.go`.
4. **Application Layer (DTO & UseCase)**:
   - Tambahkan input/output DTO di `internal/application/<feature>/dto/`.
   - Buat implementasi use case di `internal/application/<feature>/usecase/`.
   - Tambahkan unit test di `internal/application/<feature>/usecase/<feature>_usecase_test.go`.
5. **Infrastructure Repository**:
   - Buat implementasi query PostgreSQL di `internal/infrastructure/repository/<feature>/`.
   - Gunakan `$1, $2` parameterized query dan mapping scanning ke model domain.
6. **Presentation Layer (Presenter & Handler)**:
   - Buat request DTO di `internal/presentation/<feature>/presenter/`.
   - Buat handler di `internal/presentation/<feature>/handler/`.
   - Parse path param via `r.PathValue()`, decode JSON via `response.DecodeJSON()`, kirim response via `response.Data()` / `response.Error()`.
7. **Route Wiring**:
   - Daftarkan endpoint di `internal/infrastructure/api/routes/<feature>_routes.go`.
   - Pasang middleware autentikasi (`ValidateToken`) dan multi-tenancy (`RequireWorkspace`) jika rute protected.
   - Panggil pendaftaran sub-group rute di `InitRoutes` (`routes.go`).
8. **Verifikasi & Testing**:
   - Jalankan unit test: `make test-backend` (`go test ./...`).
   - Tambahkan atau jalankan E2E Playwright test di `e2e/specs/`: `make test-e2e`.

---

## Testing & Verifikasi

Codebase memiliki dua level pengujian yang terintegrasi:

1. **Backend Unit & Integration Tests**:
   - Lokasi: Berdampingan dengan kode sumber (`*_test.go`).
   - Eksekusi:
     ```bash
     make test-backend
     # atau
     cd backend && go test ./...
     ```
2. **API End-to-End Tests (Playwright)**:
   - Lokasi: `e2e/specs/` (menggunakan TypeScript & Playwright API Request fixture).
   - Meliputi seluruh lifecycle: Registrasi, login, workspace invite, CRUD project/kategori/anggota, CRUD dokumen, 30-day trash lifecycle, akses kolaborator, dan public sharing.
   - Eksekusi:
     ```bash
     make test-e2e
     # atau
     cd e2e && bunx playwright test
     ```

---

## Do and Don't untuk Agent

### DO:
- Gunakan Go 1.22+ routing standar (`r.PathValue()`, `http.NewServeMux()`, `routes.NewGroup`).
- Gunakan `database.Queryer` di repository agar method dapat dieksekusi di dalam transaksi (`*sql.Tx`) maupun pool utama (`*sql.DB`).
- Gunakan placeholder PostgreSQL (`$1`, `$2`, dst) di semua query SQL.
- Selalu inisialisasi slice pada struct response dengan `make([]T, 0)` agar tidak menghasilkan `null` di JSON output.
- Selalu decode request JSON dengan `response.DecodeJSON(r, &req)` untuk menolak field tak dikenal (`DisallowUnknownFields`).
- Selalu bungkus response HTTP menggunakan helper `response.Data` atau `response.Error`.
- Selalu sertakan `context.Context` sebagai argumen pertama pada seluruh method repository dan use case.
- Selalu verifikasi perubahan dengan `make test-backend` dan `make test-e2e`.

### DON'T:
- Jangan mengimpor framework pihak ketiga (seperti Fiber, Gin, Chi, Echo) ke dalam router.
- Jangan menjalankan query SQL atau transaksi database langsung di presentation handler.
- Jangan mengembalikan raw database error ke HTTP client tanpa mapping.
- Jangan hardcode credential atau konfigurasi di dalam file kode sumber; gunakan `internal/config`.
- Jangan menggunakan package `github.com/lib/pq`; gunakan driver modern `github.com/jackc/pgx/v5/stdlib`.
- Jangan menamai tabel dengan prefix warisan seperti `app_` (misal: gunakan `users`, bukan `app_users`).
- Jangan abaikan pengecekan workspace membership (`X-Workspace-Id`) pada resource yang bersifat workspace-scoped.
