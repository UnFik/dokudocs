.PHONY: docker-up docker-down docker-restart docker-logs docker-ps db-up db-down migrate-create migrate-up migrate-down migrate-status seed test-seed docs test-e2e test-unit test-integration

DOCKER_COMPOSE ?= docker compose
GO_TEST_ARGS ?=
MIGRATION_NAME ?= change_me
MIGRATION_DIR := database/migrations
MIGRATE_CMD := go run ./cmd/migrate

docker-up:
	$(DOCKER_COMPOSE) up -d --build

docker-down:
	$(DOCKER_COMPOSE) down

docker-restart: docker-down docker-up

docker-logs:
	$(DOCKER_COMPOSE) logs -f

docker-ps:
	$(DOCKER_COMPOSE) ps

db-up:
	$(DOCKER_COMPOSE) up -d db

db-down:
	$(DOCKER_COMPOSE) stop db

migrate-create:
	@test "$(MIGRATION_NAME)" != "change_me" || (echo "MIGRATION_NAME is required"; exit 1)
	@ts=$$(date +%Y%m%d%H%M%S); \
		touch $(MIGRATION_DIR)/$${ts}_$(MIGRATION_NAME).up.sql $(MIGRATION_DIR)/$${ts}_$(MIGRATION_NAME).down.sql; \
		echo "created $(MIGRATION_DIR)/$${ts}_$(MIGRATION_NAME).up.sql"; \
		echo "created $(MIGRATION_DIR)/$${ts}_$(MIGRATION_NAME).down.sql"

migrate-up: db-up
	$(DOCKER_COMPOSE) run --rm api $(MIGRATE_CMD) up

migrate-down: db-up
	$(DOCKER_COMPOSE) run --rm api $(MIGRATE_CMD) down

migrate-status: db-up
	$(DOCKER_COMPOSE) run --rm api $(MIGRATE_CMD) status

seed: migrate-up
	$(DOCKER_COMPOSE) run --rm api go run ./cmd/seeder

test-seed:
	go run ./cmd/testseed

test-e2e:
	cd ../e2e && bunx playwright test --project=api

test-unit:
	go test ./...

test-integration:
	@set -eu; \
		project="dokudocs-test-$$$$"; \
		compose="$(DOCKER_COMPOSE) -p $$project -f docker-compose.test.yaml"; \
		cleanup() { $$compose down --volumes --remove-orphans; }; \
		trap cleanup EXIT INT TERM; \
		$$compose up -d --wait db redis; \
		port=$$($$compose port db 5432 | sed 's/.*://'); \
		redis_port=$$($$compose port redis 6379 | sed 's/.*://'); \
		test_database_url="postgres://postgres:postgres@127.0.0.1:$$port/dokudocs_test?sslmode=disable"; \
		test_redis_url="redis://127.0.0.1:$$redis_port"; \
		DATABASE_URL=$$test_database_url $(MIGRATE_CMD) up; \
		TEST_DATABASE_URL=$$test_database_url TEST_REDIS_URL=$$test_redis_url go test -p 1 -tags=integration $(GO_TEST_ARGS) ./...

docs:
	swag init -g cmd/server/main.go -o docs --parseDependency --parseInternal
