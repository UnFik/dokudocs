DOCKER_COMPOSE ?= docker compose

# Which stack the targets below run, and whether observability is added to it.
# Both come from .env (see .env.example), so a VPS sets them once:
#   STACK=dev | prod            dev: docker-compose.dev.yaml, prod: docker-compose.yaml
#   OBSERVABILITY=true | false  adds docker-compose.observability.yaml (docs/observability.md)
# A value on the command line wins: make up STACK=prod OBSERVABILITY=true
env_value = $(shell sed -n 's/^$(1)=//p' .env 2>/dev/null | tail -n 1)
STACK ?= $(or $(call env_value,STACK),dev)
OBSERVABILITY ?= $(or $(call env_value,OBSERVABILITY),false)

ifeq ($(STACK),prod)
COMPOSE_FILES := -f docker-compose.yaml
else ifeq ($(STACK),dev)
COMPOSE_FILES := -f docker-compose.dev.yaml
else
$(error STACK must be dev or prod, not "$(STACK)")
endif
ifneq ($(filter true 1 yes,$(OBSERVABILITY)),)
COMPOSE_FILES += -f docker-compose.observability.yaml
endif
COMPOSE := $(DOCKER_COMPOSE) $(COMPOSE_FILES)

# Starts the stack. Turning observability off removes the alloy container too.
up:
	$(COMPOSE) up --build -d --remove-orphans
ifeq ($(STACK),prod)
	@echo "Site http://127.0.0.1:$(or $(call env_value,FRONTEND_PORT),8088)"
else
	@echo "Frontend http://localhost:5173  API http://localhost:8080  Collab http://localhost:1234"
endif
	@echo "Stack $(STACK), observability $(OBSERVABILITY)"

down:
	$(COMPOSE) down --remove-orphans

restart: down up

rebuild:
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d --remove-orphans

logs:
	$(COMPOSE) logs -f --tail=100 $(SERVICE)

ps:
	$(COMPOSE) ps

# The merged compose configuration, to check what a STACK/OBSERVABILITY pair runs.
config:
	$(COMPOSE) config

# Admin user and mock documents, inside the running api container.
seed-docker:
	$(COMPOSE) exec api seeder

# Stops the stack and deletes its volumes. On prod it asks for CONFIRM=yes.
reset:
	@if [ "$(STACK)" = prod ] && [ "$(CONFIRM)" != yes ]; then \
		echo "This deletes the production database. Run: make reset STACK=prod CONFIRM=yes"; exit 1; \
	fi
	$(COMPOSE) down --volumes --remove-orphans

.PHONY: up down restart rebuild logs ps config seed-docker reset test-collab test-e2e test-e2e-api test-e2e-ui test-e2e-all test-e2e-smoke test-e2e-with-backend test-seed test-backend test-backend-unit test-backend-integration test-backend-load docs

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
		DATABASE_URL="$$database_url" JWT_SECRET=test-secret ALLOWED_ORIGIN=http://127.0.0.1:4173 APP_ADDR="127.0.0.1:$$api_port" COLLAB_SERVICE_SECRET="$$collab_secret" COLLAB_SERVICE_URL="$$collab_url" "$$tmpdir/server" >"$$tmpdir/backend.log" 2>&1 & \
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
