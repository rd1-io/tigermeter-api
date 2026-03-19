SHELL := /bin/bash

# Firmware
FW_DIR := firmware
UPLOAD_PORT ?=
DEVICE_HOST ?=

# GCE
GCE_INSTANCE := instance-2
GCE_ZONE := europe-west1-b
GCE_DEPLOY_DIR := /opt/tigermeter

.PHONY: help deploy firmware-release flash fw-build log

help:
	@echo "Available targets:"
	@echo "  deploy           - Commit, push, build emulator, deploy API+Emulator to GCE"
	@echo "                     Usage: make deploy [m=\"commit message\"]"
	@echo "  firmware-release - Build firmware, push to GitHub, update version on GCE (OTA)"
	@echo "  flash            - Build + upload firmware to device (WiFi first, USB fallback)"
	@echo "                     Usage: make flash [DEVICE_HOST=ip] [UPLOAD_PORT=/dev/cu.*]"
	@echo "  log              - Serial monitor"
	@echo "                     Usage: make log [UPLOAD_PORT=/dev/cu.*]"

deploy:
	@echo "==> Committing and pushing..."
	@git add -A
	@if [ -n "$(m)" ]; then \
		git commit -m "$(m)" || echo "No changes to commit"; \
	else \
		git commit -m "chore: update" || echo "No changes to commit"; \
	fi
	@git push
	@echo "==> Building web emulator..."
	@cd web-emulator && npm install --silent && \
		VITE_API_BASE_URL=https://api-tiger.rd1.io/api \
		VITE_HMAC_KEY=tigermeter-prod-hmac-key-2026 \
		VITE_JWT_SECRET=tigermeter-prod-jwt-secret-2026 \
		npm run build
	@echo "==> Uploading to GCE..."
	@gcloud compute scp --recurse web-emulator/dist/* $(GCE_INSTANCE):$(GCE_DEPLOY_DIR)/emulator/ --zone=$(GCE_ZONE)
	@gcloud compute scp deploy/docker-compose.yml $(GCE_INSTANCE):$(GCE_DEPLOY_DIR)/docker-compose.yml --zone=$(GCE_ZONE)
	@gcloud compute scp deploy/Caddyfile $(GCE_INSTANCE):$(GCE_DEPLOY_DIR)/Caddyfile --zone=$(GCE_ZONE)
	@gcloud compute ssh $(GCE_INSTANCE) --zone=$(GCE_ZONE) --command="rm -rf $(GCE_DEPLOY_DIR)/node-api"
	@gcloud compute scp --recurse node-api $(GCE_INSTANCE):$(GCE_DEPLOY_DIR)/node-api --zone=$(GCE_ZONE)
	@echo "==> Building and starting services..."
	@gcloud compute ssh $(GCE_INSTANCE) --zone=$(GCE_ZONE) --command="\
		cd $(GCE_DEPLOY_DIR) && \
		docker compose build api && \
		docker compose up -d && \
		echo '==> Services started'"
	@echo "==> Checking health..."
	@sleep 3
	@curl -sS https://api-tiger.rd1.io/healthz && echo "" || echo "Health check failed (may need a moment)"

firmware-release:
	@echo "==> Building production firmware..."
	@$(MAKE) fw-build
	@echo "==> Committing and pushing..."
	@git add -A
	@VERSION=$$(cat $(FW_DIR)/version_prod.txt); \
	git commit -m "chore(firmware): release firmware v$$VERSION" || echo "No changes to commit"
	@git push
	@echo "==> Updating LATEST_FIRMWARE_VERSION on GCE..."
	@VERSION=$$(cat $(FW_DIR)/version_prod.txt); \
	gcloud compute ssh $(GCE_INSTANCE) --zone=$(GCE_ZONE) --command="\
		cd $(GCE_DEPLOY_DIR) && \
		sed -i 's/^LATEST_FIRMWARE_VERSION=.*/LATEST_FIRMWARE_VERSION='$$VERSION'/' .env && \
		docker compose restart api"
	@VERSION=$$(cat $(FW_DIR)/version_prod.txt); \
	echo "==> Done! Firmware v$$VERSION released"

flash:
	@$(MAKE) fw-build
	@echo "==> Looking for TigerMeter on WiFi..."
	@DEVICE=$$(DEVICE_HOST="$(DEVICE_HOST)" bash scripts/find-device.sh 2>/dev/null); \
	if [ -n "$$DEVICE" ]; then \
		echo "==> Found device at $$DEVICE, uploading via WiFi..."; \
		BIN="$(FW_DIR)/.pio/build/esp32api/firmware.bin"; \
		if curl -s -f -F "firmware=@$$BIN" "http://$$DEVICE/update" >/dev/null; then \
			echo "==> WiFi upload OK! Device will reboot."; \
		else \
			echo "==> WiFi upload failed, falling back to USB..."; \
			cd $(FW_DIR) && pio run -e esp32api -t upload $(if $(UPLOAD_PORT),--upload-port $(UPLOAD_PORT),); \
		fi; \
	else \
		echo "==> No WiFi device found, using USB..."; \
		cd $(FW_DIR) && pio run -e esp32api -t upload $(if $(UPLOAD_PORT),--upload-port $(UPLOAD_PORT),); \
	fi

fw-build:
	@V=$$(cat $(FW_DIR)/version_prod.txt | tr -d '[:space:]'); \
	V=$$((V + 1)); \
	printf "%d" "$$V" > $(FW_DIR)/version_prod.txt; \
	echo "==> Building esp32api v$$V"; \
	cd $(FW_DIR) && pio run -e esp32api

log:
	@cd $(FW_DIR) && \
	pio device monitor --baud 115200 $(if $(UPLOAD_PORT),--port $(UPLOAD_PORT),)
