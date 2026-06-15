# Agents.md

Panduan ini menjelaskan struktur codebase, batas tanggung jawab tiap folder, dan pattern layer yang wajib diikuti saat agent atau maintainer mengubah project ini.

## Ringkasan Project

Project ini adalah REST API backend Go berbasis Fiber dengan pendekatan layered/clean architecture pragmatis:

- `cmd/` sebagai entrypoint aplikasi.
- `internal/domain/` sebagai kontrak dan model bisnis inti.
- `internal/application/` sebagai use case dan orchestration bisnis.
- `internal/presentation/` sebagai HTTP boundary: handler, request/response presenter, middleware.
- `internal/infrastructure/` sebagai implementasi teknis: HTTP server wiring, database, repository SQL, config, logger, validator.
- `constant/` sebagai error, permission, dan konstanta lintas layer.
- `database/` sebagai migration dan seeder.
- `docs/` sebagai output Swagger.

Arah dependency utama:

```text
cmd
 └─ infrastructure/runtime + infrastructure/database + infrastructure/api
      └─ infrastructure/api/routes
           ├─ presentation/handler + presentation/middleware
           └─ application/usecase
                ├─ domain/contract
                ├─ domain/model
                └─ infrastructure/repository melalui factory di usecase
                     └─ infrastructure/database.Query
```

Rule penting: domain tidak boleh bergantung ke infrastructure. Presentation boleh memanggil usecase melalui interface. Repository mengakses database melalui interface query (`db.Query`) agar bisa memakai `*sql.DB` atau `*sql.Tx`.

## Struktur Folder

```text
.
├── cmd/
│   ├── server/                  # Entry point REST API server
│   └── seeder/                  # Entry point database seeder
├── constant/                    # Error, permission, menu key, dan konstanta global
├── database/
│   ├── migrations/              # SQL migration up/down
│   └── seeders/                 # Seeder data awal memakai goseeder
├── docs/                        # Generated Swagger docs: docs.go, swagger.json, swagger.yaml
├── internal/
│   ├── application/             # Business use case, DTO internal, mapper, helper aplikasi
│   ├── domain/                  # Model domain dan kontrak interface
│   ├── infrastructure/          # Adapter teknis: DB, repo SQL, server, config, logger, validator
│   ├── presentation/            # HTTP layer: handler, presenter, middleware, response
│   └── test/                    # Mock repository/usecase/external untuk test
├── scripts/                     # Script runtime/container
├── Dockerfile
├── docker-compose.yaml
├── go.mod
└── README.md
```

## Entry Point (`cmd/`)

### `cmd/server/main.go`

Tanggung jawab:

1. Load `.env` saat `APP_ENV` kosong.
2. Set timezone default ke `Asia/Jakarta`.
3. Init logger.
4. Buat runtime context untuk graceful shutdown.
5. Load config runtime.
6. Init database.
7. Init validator.
8. Buat dependency container.
9. Jalankan Fiber server via `api.RunFiberServer`.

Pattern:

- `main` hanya wiring dan bootstrap. Jangan letakkan business logic di sini.
- Error fatal di bootstrap boleh memakai logger fatal.
- Dependency runtime masuk ke `container.NewContainer(dbConn, log.Raw(), validatorEngine)`.

### `cmd/seeder/main.go`

Tanggung jawab:

- Load env.
- Init logger dan database.
- Jalankan seeders melalui `goseeder.WithSeeder`.

Pattern:

- Seeder memakai koneksi database yang sama dari `internal/infrastructure/database`.
- Seeder package diregister lewat blank import `be-dashboard-nba/database/seeders`.

## Layer Domain (`internal/domain/`)

Domain menyimpan bentuk data inti dan kontrak yang dipakai layer lain.

```text
internal/domain/
├── contract/
│   ├── repository/              # Interface repository per fitur
│   ├── usecase/                 # Interface use case per fitur
│   └── external/                # Placeholder kontrak service eksternal
└── model/                       # Struct domain: User, Role, Menu, Session, dll.
```

### `domain/model`

Contoh: `internal/domain/model/user.go`.

Pattern:

- Model merepresentasikan data domain yang dibaca/ditulis antar layer.
- Field database nullable memakai `sql.NullString`, `sql.NullTime`, dll.
- Response pagination domain membungkus data domain + DTO pagination bersama, misal `UserPaginationResponse`.
- Jangan taruh tag validasi HTTP di model domain. Validasi request milik presenter.
- Jangan taruh query SQL atau logic Fiber di model.

### `domain/contract/usecase`

Contoh: `UserUseCase` mendefinisikan operasi user:

- `ReadDetailUserUseCase`
- `UpdateUserUseCase`
- `ReadUsersUseCase`
- `CreateUserUseCase`
- `DeleteUserUseCase`
- `ReadUserProfileUseCase`

Pattern:

- Interface ini dipakai presentation/handler agar handler tidak bergantung ke concrete usecase.
- Method selalu menerima `context.Context` sebagai argumen pertama.
- Request sering memakai presenter request saat codebase sekarang belum memisahkan input boundary sepenuhnya. Jika menambah fitur baru, ikuti pola existing kecuali refactor besar disetujui.
- Return gunakan model domain atau error.

### `domain/contract/repository`

Contoh: `UserRepository` berisi method query user:

- `CreateUserQuery`
- `ReadUsersQuery`
- `ReadUserByIDQuery`
- `IsUserEmailExistsQuery`
- dll.

Pattern:

- Interface repository mendeskripsikan operasi persistence, bukan SQL detail.
- Input query memakai DTO application (`internal/application/<feature>/dto`) sesuai pola repo ini.
- Output query memakai `domain/model`.
- Jangan menerima `*fiber.Ctx` di repository. Pakai `context.Context`.

## Layer Application (`internal/application/`)

Application layer menjalankan business use case: validasi bisnis, transaksi, panggil repository, mapping request ke parameter internal, hashing password, JWT generation, dan komposisi hasil.

```text
internal/application/
├── auth/
│   ├── dto/
│   └── usecase/
├── jwt/                         # Token access/refresh helpers
├── menu/
│   ├── dto/
│   ├── mapper/
│   ├── menu-permission/
│   └── usecase/
├── role/
│   ├── dto/
│   ├── mapper/
│   └── usecase/
├── shared/dto/                  # DTO umum, contoh pagination
├── user/
│   ├── dto/
│   ├── mapper/
│   └── usecase/
└── utils/                       # Helper aplikasi: password, mock payload, string
```

### Use Case Pattern

Contoh: `internal/application/user/usecase/usecase.go`.

```go
type useCase struct {
    db db.DB

    newUserRepo func(q db.Query) contractRepo.UserRepository
    newRoleRepo func(q db.Query) contractRepo.RoleRepository
}

func NewUseCase(db db.DB) contract.UserUseCase {
    return &useCase{
        db:          db,
        newUserRepo: userRepo.NewRepository,
        newRoleRepo: roleRepo.NewRepository,
    }
}
```

Pattern:

- Struct concrete bernama `useCase`, tidak diekspor.
- Constructor diekspor: `NewUseCase`.
- Constructor return interface dari `domain/contract/usecase`.
- Usecase menyimpan `db db.DB` untuk transaksi.
- Repository dibuat lewat factory `newXRepo func(q db.Query) ...` agar test bisa mengganti factory.
- File usecase per operasi: `create_user_use_case.go`, `read_user_use_case.go`, dst.
- Test berdampingan dengan file usecase: `*_use_case_test.go`.
- Logger usecase biasanya dibungkus helper `logger.go` di package usecase.

### Transaction Pattern

Ada dua pola transaksi di codebase:

1. Manual `BeginTx` + deferred rollback + commit.
2. Helper `db.WithTransaction(ctx, db, func(tx db.Query) error { ... })`.

Pola manual existing pada `CreateUserUseCase`:

- Begin transaction.
- Defer rollback jika `err != nil`.
- Buat repository dengan `tx`, bukan `s.db`.
- Commit di akhir.

Rule:

- Jika operasi menulis lebih dari satu tabel, gunakan transaction.
- Repository menerima `db.Query`; karena `*sql.Tx` dan `*sql.DB` sama-sama memenuhi interface, repository tidak perlu tahu sedang transaction atau bukan.
- Jangan commit sebelum semua side effect database sukses.
- Rollback error dilog dan dibungkus `constant.ErrUnknownSource` sesuai pola existing.

### DTO Pattern (`application/<feature>/dto`)

DTO application adalah parameter internal untuk repository/usecase.

Contoh `CreateUserParams`:

```go
type CreateUserParams struct {
    Name      string
    FullName  string
    Email     string
    Password  string
    RoleID    int
    Active    bool
    Phone     sql.NullString
    CreatedBy string
}
```

Pattern:

- DTO application tidak memakai tag JSON/validate.
- Nullable database memakai `sql.Null*`.
- DTO berisi data siap query, bukan raw request.

### Mapper Pattern (`application/<feature>/mapper`)

Mapper mengubah presenter request menjadi DTO application.

Contoh `ToCreateUserParams`:

- Copy field request.
- Set default `Active = true` jika pointer nil.
- Convert `*string` ke `sql.NullString`.
- Tambahkan data hasil proses usecase, misal hashed password atau `createdBy`.

Rule:

- Handler tidak mapping ke DTO repository langsung.
- Repository tidak tahu presenter request.
- Mapper boleh menerima presenter request karena pola existing melakukan itu.
- Jangan taruh query SQL atau response HTTP di mapper.

### Utils Pattern

`internal/application/utils` berisi helper yang reusable di application layer:

- password hashing (`crypt.go`)
- payload helper
- string helper
- mock helper

Rule:

- Utility harus stateless.
- Jangan jadikan utils tempat business logic besar. Jika logic milik fitur tertentu, taruh di usecase fitur tersebut.

### JWT Pattern

`internal/application/jwt` menangani access token, refresh token, dan klaim token.

Rule:

- Presentation/middleware boleh memanggil helper JWT untuk validasi token.
- Auth usecase bertanggung jawab terhadap session dan authorization flow, bukan handler.

## Layer Presentation (`internal/presentation/`)

Presentation adalah HTTP boundary. Semua hal spesifik Fiber, parsing request, response JSON, middleware, Swagger annotation, dan request validation ada di sini.

```text
internal/presentation/
├── auth/
│   ├── handler/
│   └── presenter/
├── menu/
│   ├── handler/
│   ├── presenter/
│   └── menu-permission/
├── middleware/
├── request/                     # Request helper umum, contoh pagination
├── response/                    # Response envelope dan error response
├── role/
│   ├── handler/
│   └── presenter/
├── user/
│   ├── handler/
│   └── presenter/
└── validator/                   # Formatting error validasi presentation
```

### Handler Pattern

Contoh `CreateUser` handler:

```go
func CreateUser(svc contract.UserUseCase, validate *validator.Validator) fiber.Handler {
    return func(c *fiber.Ctx) (err error) {
        var request presenter.CreateUserRequest
        if err = c.BodyParser(&request); err != nil { ... }
        if err := validate.Validate(request); err != nil { ... }
        ah, err := authInternal.GetAuth(c)
        userID := ah.GetClaims().UserID
        err = svc.CreateUserUseCase(c.UserContext(), request, userID)
        ...
        return response.Data(c, response.DataPayload{...})
    }
}
```

Pattern:

- Handler constructor menerima interface usecase dan dependency kecil lain, lalu return `fiber.Handler`.
- Handler tidak membuat usecase sendiri; route yang melakukan wiring.
- Handler parse request dengan `c.BodyParser`.
- Handler validasi request dengan `validator.Validator`.
- Handler ambil context melalui `c.UserContext()`.
- Handler ambil auth claims dari `presentation/auth` setelah middleware token jalan.
- Handler mapping error domain/application ke HTTP response.
- Handler return response lewat `presentation/response`.
- Swagger annotation ditempatkan di atas handler.

Jangan lakukan:

- Query database langsung dari handler.
- Hash password di handler.
- Commit transaction di handler.
- Return raw `fiber.Map` untuk API bisnis jika envelope response sudah tersedia.

### Presenter Pattern

Presenter berisi request/response struct untuk HTTP API.

Request example:

```go
type CreateUserRequest struct {
    Name     string  `json:"name" validate:"required"`
    FullName string  `json:"full_name" validate:"required"`
    Email    string  `json:"email" validate:"required,email"`
    Password string  `json:"password" validate:"required,min=8"`
    RoleID   int     `json:"role_id" validate:"required"`
    Phone    *string `json:"phone"`
    Active   *bool   `json:"active" validate:"required"`
}
```

Pattern:

- Request presenter memakai tag `json` dan `validate`.
- Optional nullable dari client biasanya pointer (`*string`, `*bool`) agar bisa bedakan null/tidak dikirim/default.
- Response presenter memakai tag `json` dan hanya field yang aman dikirim ke client.
- Jangan expose password hash di presenter response.

### Middleware Pattern

`internal/presentation/middleware` berisi middleware Fiber:

- `ValidateToken` untuk Bearer token.
- `Authorize` untuk cek role/permission terhadap menu.
- CORS.
- Logger.
- Recover.
- Rate limiter.
- Timeout.

Pattern auth:

- Header wajib `Authorization: Bearer <token>`.
- Token diparse dan divalidasi oleh JWT helper.
- Auth/session data disimpan di Fiber context via package `presentation/auth`.
- Authorization menerima `AuthUseCase`, `constant.MenuKey`, dan `constant.PermissionCode`.

Rule:

- Middleware boleh bergantung ke usecase contract jika butuh authorization.
- Middleware tidak menjalankan business operation selain guard/access control.
- Error auth gunakan konstanta dari `constant/constant_error.go`.

### Response Pattern

`internal/presentation/response` menyediakan envelope response:

- `DataPayload` untuk response non-pagination.
- `PaginatePayload` untuk response pagination.
- `response.Data(...)` untuk response sukses.
- `response.Paginate(...)` untuk response list.
- `response.Error(...)` dan `response.ErrorValidate(...)` untuk error.

Pattern:

- Handler harus memakai helper response agar format konsisten.
- Pagination menghitung `total_page` dari `total_data / per_page`.
- Error validation memakai message `constant.ErrMsgValidate` dan detail field dari validator.

### Request Helper Pattern

`internal/presentation/request/pagination.go` menangani parsing pagination dari query.

Rule:

- Handler list endpoint harus menggunakan helper pagination/request existing.
- Jangan parse pagination manual berulang jika helper sudah ada.

## Layer Infrastructure (`internal/infrastructure/`)

Infrastructure menyimpan adapter teknis dan implementasi kontrak.

```text
internal/infrastructure/
├── api/
│   ├── routes/                  # Route registration per fitur
│   ├── error_handler.go
│   └── server.go
├── database/                    # DB open, option, keep alive, tx abstraction
├── logger/                      # Zerolog setup dan context logger
├── repository/                  # SQL repository implementations
├── runtime/                     # Config, env, container
└── validator/                   # Validator engine wrapper
```

### API Server Pattern (`infrastructure/api`)

`RunFiberServer` bertanggung jawab:

- Membuat `fiber.App`.
- Set global `ErrorHandler`.
- Register middleware global berurutan:
  1. Timeout
  2. CORS
  3. Recover
  4. RateLimiter
  5. Logger
- Register health/root endpoint `/`.
- Register Swagger `/docs/*` jika enabled.
- Register API routes.
- Start server async.
- Graceful shutdown saat context done.
- Close database.

Rule:

- Route bisnis tidak ditaruh langsung di `server.go`; tambahkan di `internal/infrastructure/api/routes`.
- Global middleware ditambahkan di server setup.
- Route group base adalah `/api/v1`.

### Route Wiring Pattern (`infrastructure/api/routes`)

Contoh `UserRouter`:

```go
func UserRouter(http fiber.Router, c *container.Container) {
    svc := usecase.NewUseCase(c.GetDB())
    mdw := middleware.NewEnsureToken(c.GetDB())

    routes := http.Group("/users")
    routes.Use(mdw.ValidateToken())

    routes.Get("/", handlers.ReadUsers(svc))
    routes.Post("/", handlers.CreateUser(svc, c.GetValidator()))
}
```

Pattern:

- Router per fitur membuat usecase concrete.
- Router membuat middleware yang butuh dependency.
- Router group memakai plural noun: `/users`, `/roles`, `/menus`.
- Router memasang auth middleware pada group protected.
- Router memanggil handler constructor dan inject dependency.
- `routes.Routes` mendaftarkan semua feature router di `/api/v1`.

Rule:

- Jika menambah fitur baru, buat file route baru dan panggil dari `routes.Routes`.
- Jangan import repository langsung di route kecuali pola existing membutuhkan usecase wiring tertentu; normalnya route -> usecase -> repository.

### Runtime Config Pattern (`infrastructure/runtime`)

Tanggung jawab:

- Load env/config aplikasi.
- Database config.
- Swagger config.
- Address dan duration shutdown.
- Runtime context untuk signal shutdown.

Rule:

- Jangan baca env langsung dari usecase/handler. Tambahkan ke config runtime jika config dipakai aplikasi.
- Env loader ada di runtime/env.

### Container Pattern (`infrastructure/runtime/container`)

`Container` menyimpan dependency runtime yang dibutuhkan route/server:

- `*sql.DB`
- `*zerolog.Logger`
- `*validator.Validator`

Pattern:

- Getter: `GetDB`, `GetLog`, `GetValidator`.
- Container tidak berisi business state.
- Container tidak menjalankan query atau usecase.

### Database Pattern (`infrastructure/database`)

Abstraction penting:

```go
type DB interface {
    BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
    Query
}

type Query interface {
    ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
    QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
    QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
```

Pattern:

- Repository menerima `db.Query`.
- Usecase menerima `db.DB` agar bisa mulai transaction.
- `*sql.DB` dipakai untuk query non-transaction atau begin transaction.
- `*sql.Tx` dipakai untuk query dalam transaction.
- `WithTransaction` tersedia untuk membungkus begin/rollback/commit.

### Repository Pattern (`infrastructure/repository`)

Struktur per fitur:

```text
internal/infrastructure/repository/user/
├── repository.go       # struct + NewRepository
├── user_query.go       # insert/update/delete/write query
├── user_select_query.go# read/select query
└── qry.go              # query helper/fragment jika ada
```

Pattern:

- Package repository per fitur biasanya bernama `repository` meski folder berbeda.
- Concrete struct tidak diekspor:

```go
type repository struct {
    db db.Query
}
```

- Constructor return contract interface:

```go
func NewRepository(db db.Query) contractRepo.UserRepository
```

- SQL statement memakai `const statement = \`...\`` dalam method.
- Query write dan read dipisah di file berbeda jika fitur besar.
- Method menerima `context.Context`.
- Method return named value sesuai pola existing.
- Method tidak mapping HTTP error; return error database asli ke usecase.

Rule:

- Jangan masukkan `*sql.DB` concrete ke repository struct; pakai `db.Query`.
- Jangan import Fiber/presentation di repository.
- Jangan menelan `sql.ErrNoRows`; usecase yang memutuskan error domain.
- Untuk PostgreSQL placeholder gunakan `$1`, `$2`, dst sesuai query existing.

### Logger Pattern (`infrastructure/logger`)

Pattern:

- Logger global di-init saat bootstrap.
- Handler/usecase mengambil logger dari context atau helper package logger.
- Log error teknis di layer tempat error diketahui, lalu return error domain/application yang sesuai.
- Jangan log data sensitif seperti password/token raw.

### Validator Pattern (`infrastructure/validator` + `presentation/validator`)

- `infrastructure/validator` membuat engine validator.
- `presentation/validator` format error validasi menjadi output yang bisa dikirim ke client.

Rule:

- Request validation dilakukan di handler sebelum usecase dipanggil.
- Business validation tetap di usecase walaupun request sudah valid.

## Constants (`constant/`)

Isi utama:

- `constant_error.go`: error HTTP Fiber dan error domain sederhana.
- `constant_permission.go`: permission code.
- `permission_hierarchy.go`: struktur/hierarchy permission.
- `constant.go`: konstanta umum.

Pattern:

- Error reusable ditempatkan di constant.
- Handler map error ke HTTP response jika perlu message spesifik.
- Usecase return error constant untuk kondisi bisnis yang bisa diprediksi, contoh `ErrRoleIdNotFound`.
- Error teknis tak terduga dibungkus `errors.WithStack(constant.ErrUnknownSource)`.

## Database (`database/`)

### Migrations

`database/migrations` berisi file `.up.sql` dan `.down.sql` timestamped.

Pattern:

```text
YYYYMMDDHHMMSS_create_<table>_table.up.sql
YYYYMMDDHHMMSS_create_<table>_table.down.sql
```

Rule:

- Setiap migration up harus punya down.
- Perubahan schema harus lewat migration, bukan manual query di code.
- Nama tabel existing memakai prefix `app_`, contoh `app_user`, `app_role`, `app_menu`.

### Seeders

`database/seeders` berisi seeder awal:

- menu
- permission
- role
- role access
- user
- user role

Pattern:

- Seeder diregister melalui package init.
- Seeder dijalankan dari `cmd/seeder`.
- Seeder harus idempotent jika mungkin agar aman dijalankan ulang.

## Test (`internal/test/` dan `*_test.go`)

Struktur:

```text
internal/test/mock/
├── repository/                 # Mock kontrak repository
├── usecase/                    # Placeholder mock usecase
└── external/                   # Placeholder mock external service
```

Pattern:

- Unit test usecase berada dekat source: `internal/application/<feature>/usecase/*_test.go`.
- Mock repository dipakai untuk isolasi business logic dari database.
- Usecase struct punya factory repository agar test bisa inject mock.
- Test harus fokus behavior: error mapping, transaction path, branch bisnis, edge cases.

Rule:

- Jangan pakai database real untuk unit test usecase jika repository bisa dimock.
- Jangan mock logic yang sedang diuji.
- Jangan membuat test hanya untuk default string/config tanpa behavior.

## Feature Flow End-to-End

Contoh flow create user:

```text
HTTP POST /api/v1/users
 -> routes.UserRouter
 -> middleware.ValidateToken
 -> handler.CreateUser
 -> presenter.CreateUserRequest + validator
 -> auth.GetAuth(c) untuk userID pembuat
 -> usecase.CreateUserUseCase
 -> mapper.ToCreateUserParams
 -> role repository cek role
 -> user repository insert user
 -> user repository insert user role
 -> transaction commit
 -> response.Data 201
```

Batas tanggung jawab:

- Handler: parsing, validation, auth claims, HTTP response.
- Usecase: transaction, hash password, cek role, orchestration create user + role.
- Mapper: request -> params.
- Repository: SQL insert/select.
- Domain contract: interface yang mengikat handler/usecase/repository.

## Cara Menambah Endpoint/Fitur Baru

Ikuti urutan ini agar konsisten dengan codebase:

1. Tambah/ubah model domain jika data domain baru dibutuhkan.
2. Tambah contract repository di `internal/domain/contract/repository`.
3. Tambah contract usecase di `internal/domain/contract/usecase`.
4. Tambah DTO application di `internal/application/<feature>/dto`.
5. Tambah mapper di `internal/application/<feature>/mapper` jika input dari presenter perlu diubah.
6. Tambah usecase concrete di `internal/application/<feature>/usecase`.
7. Tambah repository implementation di `internal/infrastructure/repository/<feature>`.
8. Tambah presenter request/response di `internal/presentation/<feature>/presenter`.
9. Tambah handler di `internal/presentation/<feature>/handler`.
10. Tambah route di `internal/infrastructure/api/routes/<feature>.go`.
11. Register route baru di `routes.Routes`.
12. Tambah/ubah migration jika schema berubah.
13. Tambah/update test usecase.
14. Regenerate Swagger docs jika annotation berubah.

## Naming Convention

Pattern file existing:

- Handler: `<action>_<feature>_handlers.go`
- Usecase: `<action>_<feature>_use_case.go`
- Usecase test: `<action>_<feature>_use_case_test.go`
- Presenter request: `req_<action>_<feature>.go`
- Presenter response: `res_<action>_<feature>.go`
- DTO params: `<action>_<feature>_params.go`
- Mapper: sama dengan DTO target, contoh `create_user_params.go`
- Repository write query: `<feature>_query.go`
- Repository select query: `<feature>_select_query.go`
- Migration: timestamp + action + table + `.up.sql/.down.sql`

Package naming existing:

- Folder handler memakai package `handlers`.
- Folder presenter memakai package `presenter`.
- Folder usecase per fitur memakai nama fitur, contoh `package user`.
- Folder repository per fitur memakai package `repository`.

## Error Handling Pattern

Usecase:

- `sql.ErrNoRows` diubah menjadi error domain/constant yang spesifik.
- Error database tak dikenal dilog lalu dibungkus `constant.ErrUnknownSource`.
- Error bisnis dikembalikan apa adanya agar handler bisa map status/message.

Handler:

- Parse error -> 400.
- Validation error -> `response.ErrorValidate`.
- Auth error -> return error atau response sesuai middleware/helper.
- Error bisnis known -> status spesifik, contoh role not found -> 404.
- Unknown error -> 500 dengan message generik.

Repository:

- Return error asli dari `database/sql`.
- Tidak log kecuali ada konteks teknis kuat; logging utama ada di usecase.
- Tidak mengubah error menjadi HTTP error.

## Security dan Auth Pattern

- Protected routes wajib memakai `ValidateToken`.
- Permission-sensitive routes pakai `Authorize` dengan menu key dan permission code yang tepat.
- Password hanya diproses di usecase dan di-hash memakai utility existing.
- Jangan log password, token, refresh token, atau credential database.
- Jangan expose password di response presenter/model output ke client.
- Authorization bukan validasi UI; tetap enforce di backend middleware/usecase.

## Pagination Pattern

- Request pagination diparse di presentation request helper.
- Usecase menerima parameter pagination melalui presenter/request lalu mapper ke DTO application.
- Repository menyediakan dua query: data list dan count.
- Response list memakai `response.Paginate` agar format sama.

## Swagger Pattern

- Swagger annotation berada di handler.
- `docs/` adalah generated output.
- Server mengaktifkan `/docs/*` hanya jika config Swagger enabled.
- Jika menambah endpoint atau mengubah request/response, update annotation dan regenerate docs.

## Do and Don't untuk Agent

Do:

- Ikuti alur layer existing; jangan buat parallel architecture.
- Pakai interface contract yang sudah ada.
- Tambahkan method ke contract sebelum implementasi concrete jika fitur butuh operasi baru.
- Pakai `context.Context` dari boundary sampai repository.
- Pakai transaction untuk multi-write.
- Tambahkan test usecase untuk branch bisnis baru.
- Jalankan test spesifik setelah mengubah behavior.

Don't:

- Jangan query database dari handler.
- Jangan import infrastructure ke domain model.
- Jangan taruh HTTP status di repository.
- Jangan buat global state baru untuk business logic.
- Jangan return raw error database ke client.
- Jangan menambahkan abstraction baru jika pola factory/interface existing cukup.
- Jangan membuat mock/no-op fallback untuk menyembunyikan missing dependency.

## Checklist Perubahan Cepat

Sebelum commit perubahan fitur:

- Contract usecase/repository sudah sinkron dengan implementation.
- Handler hanya urus HTTP boundary.
- Usecase berisi business orchestration dan transaction.
- Repository hanya SQL dan mapping row ke model.
- Presenter request punya tag `json` dan `validate`.
- Response memakai helper `presentation/response`.
- Error known dimap ke status HTTP tepat.
- Test usecase cover success dan failure penting.
- Swagger docs diperbarui jika endpoint berubah.
