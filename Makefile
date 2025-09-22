SHELL := /bin/bash
NODE_API := node-api
PORT ?= 3001

.PHONY: help setup dev start build stop studio migrate db-reset db-push generate health clean fw-dev emulator fw fw-build fw-upload

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

fw-build:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	pio run -e $(FW_ENV)

fw-upload:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA=""; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="--upload-port $(UPLOAD_PORT)"; fi; \
	pio run -e $(FW_ENV) -t upload $$EXTRA
