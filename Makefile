DOCKER_COMPOSE ?= docker compose

# make dev    development stack (docker-compose.dev.yaml): hot reload, http://localhost:5173
# make build  production stack (docker-compose.yaml), built and started: http://127.0.0.1:8088
# OBSERVABILITY=true in .env adds docker-compose.observability.yaml to either
# (docs/observability.md). A value on the command line wins: make dev OBSERVABILITY=true
# The other targets act on whichever stack is running.
OBSERVABILITY ?= $(or $(shell sed -n 's/^OBSERVABILITY=//p' .env 2>/dev/null | tail -n 1),false)
observability_files = $(if $(filter true 1 yes,$(OBSERVABILITY)),-f docker-compose.observability.yaml)

# The compose files the running stack was started with, as Docker recorded them.
comma := ,
running_files = $(shell docker ps -a --filter label=com.docker.compose.project=dokudocs --format '{{.Label "com.docker.compose.project.config_files"}}' 2>/dev/null | head -n 1)
RUNNING = $(DOCKER_COMPOSE) $(or $(foreach f,$(subst $(comma), ,$(running_files)),-f $(f)),-f docker-compose.dev.yaml)

# Starting one stack replaces the other (same project) and, with observability
# off, removes the alloy container.
dev:
	$(DOCKER_COMPOSE) -f docker-compose.dev.yaml $(observability_files) up --build -d --remove-orphans
	@echo "Frontend http://localhost:5173  API http://localhost:8080  Collab http://localhost:1234  (observability $(OBSERVABILITY))"

build:
	$(DOCKER_COMPOSE) -f docker-compose.yaml $(observability_files) up --build -d --remove-orphans
	@echo "Site http://127.0.0.1:$(or $(shell sed -n 's/^FRONTEND_PORT=//p' .env 2>/dev/null | tail -n 1),8088)  (observability $(OBSERVABILITY))"

down:
	$(RUNNING) down --remove-orphans

restart:
	$(RUNNING) restart $(SERVICE)

logs:
	$(RUNNING) logs -f --tail=100 $(SERVICE)

ps:
	$(RUNNING) ps

# Admin user and mock documents, inside the running api container.
seed-docker:
	$(RUNNING) exec api seeder

# Stops the running stack and deletes its volumes. On production it asks for CONFIRM=yes.
reset:
	@case "$(running_files)" in *docker-compose.yaml*) \
		if [ "$(CONFIRM)" != yes ]; then echo "The production stack is running; this deletes its database. Run: make reset CONFIRM=yes"; exit 1; fi;; \
	esac
	$(RUNNING) down --volumes --remove-orphans

.PHONY: dev build down restart logs ps seed-docker reset test-collab test-e2e test-e2e-api test-e2e-ui test-e2e-all test-e2e-smoke test-e2e-with-backend test-seed test-backend test-backend-unit test-backend-integration test-backend-load docs

test-e2e: test-e2e-api

test-e2e-api:
	$(MAKE) test-e2e-with-backend E2E_ARGS='--project=api'

test-e2e-ui:
	cd frontend && bun run build
	cd e2e && bunx playwright test --project=ui --grep-invert @live

test-e2e-all:
	$(MAKE) test-e2e-with-backend E2E_ARGS=

test-e2e-smoke:
	$(MAKE) test-e2e-with-backend E2E_ARGS='--project=ui --grep @smoke --workers=1'

test-e2e-with-backend:
	@set -eu; \
		project="dokudocs-test-e2e-$$$$"; \
		compose="$(DOCKER_COMPOSE) -p $$project -f backend/docker-compose.test.yaml"; \
		tmpdir=$$(mktemp -d); \
		backend_pid=""; \
		collab_pid=""; \
		cleanup() { \
			if [ -n "$$collab_pid" ]; then kill "$$collab_pid" 2>/dev/null || true; wait "$$collab_pid" 2>/dev/null || true; fi; \
			if [ -n "$$backend_pid" ]; then kill "$$backend_pid" 2>/dev/null || true; wait "$$backend_pid" 2>/dev/null || true; fi; \
			$$compose down --volumes --remove-orphans >/dev/null 2>&1 || true; \
			rm -rf "$$tmpdir"; \
		}; \
		trap cleanup EXIT INT TERM; \
		$$compose up -d --wait db; \
		db_port=$$($$compose port db 5432 | sed 's/.*://'); \
		database_url="postgres://postgres:postgres@127.0.0.1:$$db_port/dokudocs_test?sslmode=disable"; \
		(cd backend && DATABASE_URL="$$database_url" go run ./cmd/migrate up && TEST_DATABASE_URL="$$database_url" go run ./cmd/testseed); \
		api_port=$$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'); \
		api_url="http://127.0.0.1:$$api_port"; \
		collab_port=$$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'); \
		collab_url="http://127.0.0.1:$$collab_port"; \
		collab_secret=test-collab-secret; \
		(cd backend && go build -o "$$tmpdir/server" ./cmd/server); \
		DATABASE_URL="$$database_url" JWT_SECRET=test-secret ALLOWED_ORIGIN=http://127.0.0.1:4173 PUBLIC_APP_URL=http://127.0.0.1:4173 RATE_LIMIT_LOGIN_PER_MIN=0 RATE_LIMIT_GOOGLE_START_PER_MIN=0 RATE_LIMIT_GOOGLE_CALLBACK_PER_MIN=0 GOOGLE_CLIENT_ID=e2e-client GOOGLE_CLIENT_SECRET=e2e-secret GOOGLE_AUTH_URL=http://127.0.0.1:4399/auth GOOGLE_TOKEN_URL=http://127.0.0.1:4399/token GOOGLE_JWKS_URL=http://127.0.0.1:4399/certs APP_ADDR="127.0.0.1:$$api_port" COLLAB_SERVICE_SECRET="$$collab_secret" COLLAB_SERVICE_URL="$$collab_url" "$$tmpdir/server" >"$$tmpdir/backend.log" 2>&1 & \
		backend_pid=$$!; \
		ready=0; \
		for attempt in $$(seq 1 60); do \
			if curl -fsS "$$api_url/api/v1/health" >/dev/null; then ready=1; break; fi; \
			sleep 1; \
		done; \
		if [ "$$ready" -ne 1 ]; then cat "$$tmpdir/backend.log"; exit 1; fi; \
		(cd collab && [ -d node_modules ] || npm ci); \
		(cd collab && COLLAB_BACKEND_URL="$$api_url" COLLAB_SERVICE_SECRET="$$collab_secret" COLLAB_PORT="$$collab_port" COLLAB_DEBOUNCE_MS=300 COLLAB_MAX_DEBOUNCE_MS=1500 ./node_modules/.bin/tsx --tsconfig tsconfig.run.json src/main.ts >"$$tmpdir/collab.log" 2>&1 & echo $$! >"$$tmpdir/collab.pid"); \
		collab_pid=$$(cat "$$tmpdir/collab.pid"); \
		ready=0; \
		for attempt in $$(seq 1 60); do \
			if curl -fsS "$$collab_url/health" >/dev/null; then ready=1; break; fi; \
			sleep 1; \
		done; \
		if [ "$$ready" -ne 1 ]; then cat "$$tmpdir/collab.log"; exit 1; fi; \
		(cd frontend && bun run build); \
		(cd e2e && API_URL="$$api_url" API_PROXY_TARGET="$$api_url" COLLAB_PROXY_TARGET="$$collab_url" CI=1 bunx playwright test $$E2E_ARGS)

# Includes the two-instance Redis test, with a throwaway Redis.
test-collab:
	@set -eu; \
		name="collab-redis-test-$$$$"; \
		trap 'docker stop "$$name" >/dev/null 2>&1 || true' EXIT INT TERM; \
		docker run -d --rm --name "$$name" -p 127.0.0.1::6379 redis:7-alpine >/dev/null; \
		port=$$(docker port "$$name" 6379 | head -n 1 | sed 's/.*://'); \
		sleep 2; \
		cd collab && TEST_REDIS_URL="redis://127.0.0.1:$$port" npm test

test-backend-unit:
	cd backend && $(MAKE) test-unit

test-backend-integration:
	cd backend && $(MAKE) test-integration

test-backend-load:
	cd backend && $(MAKE) test-load

test-seed:
	cd backend && go run ./cmd/testseed

test-backend: test-backend-unit test-backend-integration


docs:
	cd backend && swag init -g cmd/server/main.go -o docs --parseDependency --parseInternal

backup-workspace:
	bun run scripts/backup-workspace.ts

seed:
	cd backend && $(MAKE) seed

seed-sql:
	docker exec -i dokudocs-postgres psql -U postgres -d dokudocs < backups/seed_from_backup.sql
