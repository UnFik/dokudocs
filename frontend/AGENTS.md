# Repository Instructions

## Project Overview

- This repo is Vite + React 19 admin-style app, customized from `shadcn-admin`.
- UI stack: TanStack Router, TanStack Query, Tailwind CSS v4, Radix/shadcn UI, Zustand, Sonner, Vitest browser tests.
- Many screens are feature-sliced dashboard pages such as dashboard, apps, chats, tasks, users, and settings. Some areas use static or mock-style data sources; inspect feature-local `data/**` before assuming backend integration exists.
- Goal when editing: keep route files thin, keep feature UI inside `src/features/**`, keep shared primitives reusable.

## Commands

- Use `bun`; `bun.lock` is lockfile. CI installs with `bun install --frozen-lockfile`.
- CI uses Node 20, then runs `bun run lint`, `bun run format:check`, `bun run test:browser:install`, `bun run test`, and `bun run build` in that order.
- Local scripts:
  - `bun run dev`
  - `bun run build`
  - `bun run lint`
  - `bun run format:check`
  - `bun run format`
  - `bun run knip`
  - `bun run test`
  - `bun run test:watch`
  - `bun run test:ui`
  - `bun run test:coverage`
- No standalone `typecheck` script; `bun run build` runs `tsc -b && vite build`.
- Tests run in Vitest browser mode with Playwright Chromium. If browser deps are missing, run `bun run test:browser:install` before `bun run test`.
- For focused tests, pass file to Vitest through bun, example: `bun run test src/lib/utils.test.ts`.

## App Startup And Runtime Flow

- Entry point: `src/main.tsx`.
- Provider order in startup:
  1. `QueryClientProvider`
  2. `ThemeProvider`
  3. `FontProvider`
  4. `DirectionProvider`
  5. `RouterProvider`
- Global TanStack Query defaults live in `src/main.tsx`, including retry behavior, stale time, mutation error handling, and query-cache error reactions.
- Auth/session failure handling also lives in `src/main.tsx`: `401` query errors show toast, reset Zustand auth state, then redirect to `/sign-in`.
- Root route lives in `src/routes/__root.tsx`; it renders navigation progress, current route outlet, toaster, root error boundary, not-found UI, and devtools in development.

## Architecture

- Routes are file-based under `src/routes/**` using `createFileRoute` and TanStack Router conventions.
- Do not edit `src/routeTree.gen.ts`; generated file, overwritten by TanStack Router.
- Route groups currently map roughly like this:
  - `src/routes/(auth)/**`: auth-related public screens
  - `src/routes/_authenticated/**`: signed-in app shell and feature pages
  - `src/routes/(errors)/**`: standalone error pages
- Typical routing pattern:
  - route file defines route config
  - route file imports page implementation from `src/features/**`
  - feature folder owns page UI, small subcomponents, and any local demo/static data
- `@/*` alias points to `src/*` in both Vite and TypeScript config.

## Directory Map

- `src/main.tsx` — app bootstrap, providers, query client, router creation
- `src/routes/__root.tsx` — root layout shell, devtools, toaster, root error/not-found behavior
- `src/routes/**` — file-based route definitions
- `src/features/**` — feature/page implementations
- `src/components/layout/**` — shared layout pieces like app shell and navigation
- `src/components/data-table/**` — reusable table helpers/components
- `src/components/ui/**` — customized shadcn/Radix primitives
- `src/context/**` — cross-cutting UI providers such as theme, font, direction
- `src/stores/**` — Zustand client state stores
- `src/lib/**` — shared utilities
- `src/config/**` — app config/constants
- `src/hooks/**` — reusable hooks
- `src/test-utils/**` — browser-test helpers and setup utilities
- `src/assets/**` — static assets and brand icons
- `src/styles/index.css` — global styles and Tailwind v4 entry

## Feature Conventions

- Most features follow this shape:
  - `src/features/<feature>/index.tsx` — page entry
  - `src/features/<feature>/components/**` — feature-local UI parts
  - `src/features/<feature>/data/**` — local data, mock content, or static config
- Keep business logic near feature unless multiple features share it; then move to `src/lib/**`, `src/hooks/**`, or shared component folders.
- Prefer editing feature folders over route files when changing page UI.
- Keep route files small unless route-specific loader/search/guard logic needs to live there.

## State And Data Flow

- Use TanStack Query for server state, async fetching, caching, retries, invalidation.
- Use Zustand for lightweight client state. Auth state currently lives in `src/stores/auth-store`.
- Query error handling is partly centralized in `src/main.tsx`; check global behavior before adding duplicate per-page redirects or toast logic.
- Some feature data folders contain static/demo content. Confirm real source-of-truth before wiring mutations or fetch flows.

## Styling And Components

- Tailwind is configured through CSS in `src/styles/index.css` and Vite Tailwind plugin, not `tailwind.config.*`.
- shadcn config is `components.json`: style `new-york`, base color `slate`, CSS variables on, aliases to `@/components`, `@/components/ui`, `@/lib/utils`, and `@/hooks`.
- `src/components/ui/**` contains customized shadcn/Radix components and is ignored by ESLint, Knip, and coverage.
- README flags some UI primitives as customized or RTL-updated; manually merge upstream shadcn changes instead of overwriting files wholesale.
- Treat `src/components/ui/**` as high-caution area. Small targeted edits good. Bulk regeneration bad.

## Conventions

- Prettier uses no semicolons, single quotes including JSX, 2-space indent, LF endings, sorted imports, and Tailwind class sorting.
- Import ordering is defined in `.prettierrc`; run `bun run format` rather than hand-sorting big import changes.
- ESLint forbids `console` by default, duplicate imports, and non-type imports for TypeScript types.
- Prefix intentionally unused variables, args, or caught errors with `_`.
- TypeScript is strict with `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedSideEffectImports` enabled.

## Testing Guidance

- Tests use `vitest-browser-react` for component rendering and `vitest/browser` user events.
- Reuse helpers from `src/test-utils/**` for cookie cleanup and TanStack Table mocks.
- Prefer targeted verification first:
  1. run focused test file for touched area
  2. run `bun run test` if change affects behavior across feature boundaries
  3. run `bun run build` if change affects routing, types, imports, or app-wide wiring
- If task changes only docs like this file, test run not needed.

## Safe And Unsafe Edits

- Safe common edit zones:
  - `src/features/**`
  - `src/routes/**` except generated files
  - `src/components/layout/**`
  - `src/lib/**`
  - `src/hooks/**`
  - `src/stores/**`
- High-caution zones:
  - `src/components/ui/**` — customized primitives
  - `src/main.tsx` — global providers and query/auth behavior
  - `src/routes/__root.tsx` — root error/not-found/devtools shell
- Never edit `src/routeTree.gen.ts` manually.

## Environment And Optional Areas

- `knip.config.ts` ignores `src/components/ui/**`, `src/components/layout/app-title.tsx`, and `src/tanstack-table.d.ts`; do not treat those ignores as accidental without checking usage.
