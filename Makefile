SHELL := /bin/bash
NODE_API := node-api
PORT ?= 3001

# --- Release settings (override via env or make vars) ---
SERVER_HOST ?= 89.169.47.121
SERVER_USER ?= root
# Use a writable temp dir to avoid read-only FS issues. Override if desired.
REMOTE_DIR ?= /tmp/tigermeter/tigermeter-api
REMOTE_PLATFORM ?= linux/amd64
API_TAG ?= tigermeter-api:release
EMU_TAG ?= tigermeter-emulator:release
VITE_API_BASE_URL ?= https://api.tigermeter.rd1.io/api
JWT_SECRET ?= change-me
HMAC_KEY ?= dev

.PHONY: help setup dev start build stop studio migrate db-reset db-push generate health clean fw-dev emulator fw fw-build fw-upload release

help:
	@echo "Available targets:"
	@echo "  setup      - Install deps, create .env, generate Prisma client, push DB"
	@echo "  dev        - Start Node API in dev mode (tsx)"
	@echo "  start      - Start built server (node dist)"
	@echo "  build      - Compile TypeScript"
	@echo "  stop       - Kill process listening on PORT=$(PORT)"
	@echo "  studio     - Open Prisma Studio"
	@echo "  migrate    - Create & apply migration (usage: make migrate name=init)"
	@echo "  db-push    - Push schema to DB (no migrations)"
	@echo "  db-reset   - Reset dev database (DANGEROUS)"
	@echo "  generate   - Generate Prisma client"
	@echo "  hmac       - Compute HMAC for claim (usage: make hmac mac=AA:BB:... [fw=1.0.0] [key=dev_hmac_secret_123])"
	@echo "  register   - Register device via API (usage: make register mac=.. key=.. [fw=1.0.0])"
	@echo "  health     - Check health endpoint"
	@echo "  clean      - Remove node_modules and generated client"
	@echo "  emulator   - Start web emulator (Vite dev server)"
	@echo "  fw         - Build and upload firmware (usage: make fw [FW_ENV=esp32dev] [UPLOAD_PORT=/dev/cu.*])"
	@echo "  fw-build   - Build firmware only (usage: make fw-build [FW_ENV=esp32dev])"
	@echo "  fw-upload  - Upload firmware only (usage: make fw-upload [FW_ENV=esp32dev] [UPLOAD_PORT=/dev/cu.*])"
	@echo "  demo       - Build+upload demo firmware (FW_ENV=esp32demo)"
	@echo "  demo-build - Build demo firmware only (FW_ENV=esp32demo)"
	@echo "  demo-upload- Upload demo firmware only (FW_ENV=esp32demo)"
	@echo "  release    - Build images locally and deploy to server (defaults: JWT_SECRET=$(JWT_SECRET), HMAC_KEY=$(HMAC_KEY))"

setup:
	cd $(NODE_API) && \
	npm install && \
	if [ ! -f .env ]; then echo 'DATABASE_URL="file:./dev.db"' > .env; echo 'JWT_SECRET="change-me-dev"' >> .env; fi && \
	npm install date-fns@^3 --save && \
	npx prisma generate && \
	npx prisma db push

dev:
	$(MAKE) stop
	cd $(NODE_API) && npm run dev &

start:
	cd $(NODE_API) && npm run start

build:
	cd $(NODE_API) && npm run build

stop:
	- lsof -ti:$(PORT) | xargs -r kill -9

studio:
	cd $(NODE_API) && npx prisma studio

migrate:
	@if [ -z "$(name)" ]; then echo "Usage: make migrate name=<migration_name>"; exit 2; fi
	cd $(NODE_API) && npx prisma migrate dev --name "$(name)"

db-push:
	cd $(NODE_API) && npx prisma db push

db-reset:
	cd $(NODE_API) && npx prisma migrate reset --force

generate:
	cd $(NODE_API) && npx prisma generate


hmac:
	@MAC=$(mac); FW=$(fw); KEY=$(key); \
	if [ -z "$$MAC" ]; then echo "Usage: make hmac mac=AA:BB:CC:DD:EE:FF [fw=1.0.0] [key=dev_hmac_secret_123]" 1>&2; exit 2; fi; \
	: $${FW:=1.0.0}; : $${KEY:=dev_hmac_secret_123}; \
	MINUTE=$$(date -u +"%Y-%m-%dT%H:%M:00.000Z"); MSG="$$MAC|$$FW|$$MINUTE"; \
	printf "%s" "$$MSG" | openssl dgst -sha256 -hmac "$$KEY" -hex | awk '{print $$2}'

health:
	@curl -sS http://127.0.0.1:$(PORT)/healthz || true

clean:
	rm -rf $(NODE_API)/node_modules $(NODE_API)/generated/prisma

emulator:
	- lsof -ti:5175 | xargs -r kill -9
	cd web-emulator && npm install && npm run dev

register:
	@MAC=$(mac); KEY=$(key); FW=$(fw); : $${FW:=1.0.0}; \
	if [ -z "$$MAC" ] || [ -z "$$KEY" ]; then echo "Usage: make register mac=AA:BB:.. key=<hmacKey> [fw=1.0.0]" 1>&2; exit 2; fi; \
	echo '{"mac":"'"$$MAC"'","hmacKey":"'"$$KEY"'","firmwareVersion":"'"$$FW"'"}' | jq . && echo "(placeholder: no endpoint; use make seed or Prisma Studio)"

# --- Firmware (PlatformIO) ---
FW_DIR := firmware
FW_ENV ?= esp32dev
UPLOAD_PORT ?=

fw:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA=""; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="--upload-port $(UPLOAD_PORT)"; fi; \
	pio run -e $(FW_ENV) -t upload $$EXTRA

demo:
	@FW_ENV=esp32demo $(MAKE) fw $(if $(UPLOAD_PORT),UPLOAD_PORT=$(UPLOAD_PORT),)

# --- Release: build local images, upload, load & start on remote ---
release:
	@echo "Using JWT_SECRET=$(JWT_SECRET) HMAC_KEY=$(HMAC_KEY)"
	@echo "==> Committing and pushing local changes (if any)"
		@set -e; \
		if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		  git add -A; \
		  git reset -- tigermeter-images.tar >/dev/null 2>&1 || true; \
		  if git diff --cached --quiet; then \
		    echo "No local changes to commit."; \
		  else \
		    ts=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
		    n=$$(git diff --cached --name-only | wc -l | tr -d " \t"); \
		    summary=$$(git diff --cached --name-status | awk '{print $$1}' | sed -E 's/ //g' | sort | uniq -c | awk '{print $$2 ":" $$1}' | paste -sd ', ' -); \
		    msg="chore(release): deploy $$n file(s) @ $$ts [$$summary]"; \
		    echo "Commit: $$msg"; \
		    git commit -m "$$msg"; \
		    git push; \
		  fi; \
		else \
		  echo "Not a git repository; skipping commit."; \
		fi
	@echo "==> Building API image: $(API_TAG)"
	docker build --platform=$(REMOTE_PLATFORM) -t "$(API_TAG)" -f node-api/Dockerfile node-api
	@echo "==> Building Emulator image: $(EMU_TAG)"
	docker build --platform=$(REMOTE_PLATFORM) -t "$(EMU_TAG)" -f web-emulator/Dockerfile \
		--build-arg VITE_API_BASE_URL="$(VITE_API_BASE_URL)" \
		--build-arg VITE_HMAC_KEY="$(HMAC_KEY)" \
		web-emulator
	@echo "==> Saving images to tar"
	docker save -o tigermeter-images.tar "$(API_TAG)" "$(EMU_TAG)"
	@echo "==> Creating remote dir $(REMOTE_DIR)"
	ssh -o StrictHostKeyChecking=no $(SERVER_USER)@$(SERVER_HOST) "mkdir -p '$(REMOTE_DIR)' || true"
	@echo "==> Uploading bundle and compose files"
	scp -o StrictHostKeyChecking=no tigermeter-images.tar docker-compose.yml Caddyfile $(SERVER_USER)@$(SERVER_HOST):$(REMOTE_DIR)/
	@echo "==> Loading images and starting stack on remote"
	ssh -o StrictHostKeyChecking=no $(SERVER_USER)@$(SERVER_HOST) "set -euo pipefail; mkdir -p '$(REMOTE_DIR)'; cd '$(REMOTE_DIR)'; if ! command -v docker >/dev/null 2>&1; then echo 'Docker not found. Installing...'; curl -fsSL https://get.docker.com | sh; systemctl enable --now docker; fi; docker load -i tigermeter-images.tar; printf '%s\n' 'JWT_SECRET=$(JWT_SECRET)' 'HMAC_KEY=$(HMAC_KEY)' 'API_IMAGE=$(API_TAG)' 'EMULATOR_IMAGE=$(EMU_TAG)' > .env; docker compose -f docker-compose.yml up -d --remove-orphans; echo '=== docker ps ==='; docker ps"

fw-build:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	pio run -e $(FW_ENV)

demo-build:
	@FW_ENV=esp32demo $(MAKE) fw-build

fw-upload:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA=""; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="--upload-port $(UPLOAD_PORT)"; fi; \
	pio run -e $(FW_ENV) -t upload $$EXTRA

demo-upload:
	@FW_ENV=esp32demo $(MAKE) fw-upload $(if $(UPLOAD_PORT),UPLOAD_PORT=$(UPLOAD_PORT),)
