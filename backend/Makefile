.PHONY: docker-up docker-down docker-restart docker-logs docker-ps db-up db-down migrate-create migrate-up migrate-down migrate-status seed

DOCKER_COMPOSE ?= docker compose
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
