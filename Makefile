SHELL := /bin/bash
NODE_API := node-api
PORT ?= 3001

.PHONY: help setup dev start build stop studio migrate db-reset db-push generate health clean fw-dev emulator fw fw-build fw-upload log firmware-release pages-release fly-deploy fly-api fly-emulator fly-logs deploy

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
	@echo "  log        - Read serial logs from device (usage: make log [UPLOAD_PORT=/dev/cu.*])"
	@echo "  prod       - Build+upload production firmware (FW_ENV=esp32api)"
	@echo "  prod-build - Build production firmware only (FW_ENV=esp32api)"
	@echo "  prod-upload- Upload production firmware only (FW_ENV=esp32api)"
	@echo "  firmware-release - Build firmware and deploy to GitHub Pages"
	@echo "  pages-release    - Deploy docs/ changes to GitHub Pages (no firmware build)"
	@echo "  deploy           - Commit and push all changes to GitHub (usage: make deploy [m=\"commit message\"])"
	@echo ""
	@echo "Fly.io deployment:"
	@echo "  fly-deploy   - Deploy both API and Emulator to Fly.io"
	@echo "  fly-api      - Deploy only API to Fly.io"
	@echo "  fly-emulator - Deploy only Emulator to Fly.io"
	@echo "  fly-logs     - Tail API logs from Fly.io"

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

# Get version file based on environment
define get_version_file
$(if $(filter esp32api,$(1)),$(FW_DIR)/version_prod.txt,)
endef

# Read and increment version (returns new version)
define increment_version
$(shell \
	FILE=$(call get_version_file,$(1)); \
	if [ -n "$$FILE" ] && [ -f "$$FILE" ]; then \
		V=$$(cat "$$FILE" | tr -d '[:space:]'); \
		V=$$((V + 1)); \
		echo "$$V" > "$$FILE"; \
		echo "$$V"; \
	else \
		echo "0"; \
	fi \
)
endef

# Read version without incrementing
define read_version
$(shell \
	FILE=$(call get_version_file,$(1)); \
	if [ -n "$$FILE" ] && [ -f "$$FILE" ]; then \
		cat "$$FILE" | tr -d '[:space:]'; \
	else \
		echo "0"; \
	fi \
)
endef

fw:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA=""; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="--upload-port $(UPLOAD_PORT)"; fi; \
	pio run -e $(FW_ENV) -t upload $$EXTRA

fw-build:
	@VERSION_FILE=""; \
	if [ "$(FW_ENV)" = "esp32api" ]; then VERSION_FILE="$(FW_DIR)/version_prod.txt"; fi; \
	if [ -n "$$VERSION_FILE" ] && [ -f "$$VERSION_FILE" ]; then \
		V=$$(cat "$$VERSION_FILE" | tr -d '[:space:]'); \
		V=$$((V + 1)); \
		printf "%d" "$$V" > "$$VERSION_FILE"; \
		echo "==> Building $(FW_ENV) v$$V"; \
	fi; \
	cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	pio run -e $(FW_ENV)

gxepd2-test:
	@FW_ENV=esp32gxepd2test $(MAKE) fw $(if $(UPLOAD_PORT),UPLOAD_PORT=$(UPLOAD_PORT),)

gxepd2-test-build:
	@FW_ENV=esp32gxepd2test $(MAKE) fw-build

fw-upload:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA=""; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="--upload-port $(UPLOAD_PORT)"; fi; \
	pio run -e $(FW_ENV) -t upload $$EXTRA

prod:
	@FW_ENV=esp32api $(MAKE) fw $(if $(UPLOAD_PORT),UPLOAD_PORT=$(UPLOAD_PORT),)

prod-build:
	@FW_ENV=esp32api $(MAKE) fw-build

prod-upload:
	@FW_ENV=esp32api $(MAKE) fw-upload $(if $(UPLOAD_PORT),UPLOAD_PORT=$(UPLOAD_PORT),)

# --- Firmware Web Release (GitHub Pages) ---
firmware-release:
	@echo "==> Building production firmware..."
	@FW_ENV=esp32api $(MAKE) fw-build
	@echo "==> Committing and pushing to GitHub..."
	@git add -A
	@VERSION=$$(cat firmware/version_prod.txt); \
	git commit -m "chore(firmware): release firmware v$$VERSION" || echo "No changes to commit"
	@git push
	@echo "==> Updating Fly.io..."
	@VERSION=$$(cat firmware/version_prod.txt); \
	echo "==> Setting LATEST_FIRMWARE_VERSION=$$VERSION"; \
	fly secrets set LATEST_FIRMWARE_VERSION=$$VERSION -a tigermeter-api
	@VERSION=$$(cat firmware/version_prod.txt); \
	echo ""; \
	echo "==> Done! Firmware v$$VERSION released"; \
	echo "📄 Page URL: https://rd1-io.github.io/tigermeter-api/"

pages-release:
	@echo "==> Committing docs/ and deploying to GitHub Pages..."
	@git add docs/
	@git commit -m "chore(pages): update flash page" || echo "No docs/ changes to commit"
	@git push
	@echo "==> Done! Pages deployed"
	@echo ""
	@echo "📄 Page URL: https://rd1-io.github.io/tigermeter-api/"

deploy:
	@echo "==> Committing and pushing all changes..."
	@git add -A
	@if [ -n "$(m)" ]; then \
		git commit -m "$(m)" || echo "No changes to commit"; \
	else \
		git commit -m "chore: update" || echo "No changes to commit"; \
	fi
	@git push
	@echo "==> Done! Changes pushed to GitHub"

log:
	@cd $(FW_DIR) && \
	if ! command -v pio >/dev/null 2>&1; then \
		echo "PlatformIO (pio) not found. Install with: pipx install platformio   or   brew install platformio" 1>&2; exit 127; \
	fi; \
	EXTRA="--baud 115200"; if [ -n "$(UPLOAD_PORT)" ]; then EXTRA="$$EXTRA --port $(UPLOAD_PORT)"; fi; \
	pio device monitor $$EXTRA

# --- Fly.io Deployment ---
fly-deploy: fly-api fly-emulator
	@echo "==> Both apps deployed to Fly.io!"

fly-api:
	@echo "==> Deploying API to Fly.io..."
	cd $(NODE_API) && fly deploy

fly-emulator:
	@echo "==> Deploying Emulator to Fly.io..."
	cd web-emulator && fly deploy

fly-logs:
	@echo "==> Tailing API logs..."
	fly logs -a tigermeter-api
