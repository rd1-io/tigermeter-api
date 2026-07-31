SHELL := /bin/bash

# Firmware
FW_DIR := firmware
UPLOAD_PORT ?=
DEVICE_HOST ?=

.PHONY: help deploy firmware-release flash fw-build log

help:
	@echo "Available targets:"
	@echo "  deploy           - Commit + push (deploy to prod is done by GitHub Actions)"
	@echo "                     Usage: make deploy [m=\"commit message\"]"
	@echo "  firmware-release - Build firmware, commit + push (prod version updated by GitHub Actions)"
	@echo "  flash            - Build + upload firmware to device (WiFi first, USB fallback)"
	@echo "                     Usage: make flash [DEVICE_HOST=ip] [UPLOAD_PORT=/dev/cu.*]"
	@echo "  log              - Serial monitor"
	@echo "                     Usage: make log [UPLOAD_PORT=/dev/cu.*]"

deploy:
	@echo "==> Committing and pushing (GitHub Actions will deploy)..."
	@git add -A
	@if [ -n "$(m)" ]; then \
		git commit -m "$(m)" || echo "No changes to commit"; \
	else \
		git commit -m "chore: update" || echo "No changes to commit"; \
	fi
	@git push

firmware-release:
	@echo "==> Building production firmware..."
	@$(MAKE) fw-build
	@echo "==> Committing and pushing (GitHub Actions will update prod version)..."
	@git add -A
	@VERSION=$$(cat $(FW_DIR)/version_prod.txt); \
	git commit -m "chore(firmware): release firmware v$$VERSION" || echo "No changes to commit"
	@git push
	@VERSION=$$(cat $(FW_DIR)/version_prod.txt); \
	echo "==> Done! Firmware v$$VERSION pushed — deploy workflow will update prod"

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
