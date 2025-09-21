SHELL := /bin/bash
NODE_API := node-api
PORT ?= 3001

.PHONY: help setup dev start build stop studio migrate db-reset db-push generate health clean seed fw-dev

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
	@echo "  seed       - Seed database with dummy data"
	@echo "  hmac       - Compute HMAC for claim (usage: make hmac mac=AA:BB:... [fw=1.0.0] [key=dev_hmac_secret_123])"
	@echo "  register   - Register device via API (usage: make register mac=.. key=.. [fw=1.0.0])"
	@echo "  health     - Check health endpoint"
	@echo "  clean      - Remove node_modules and generated client"

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

seed:
	cd $(NODE_API) && node --loader tsx ./scripts/seed.ts

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

register:
	@MAC=$(mac); KEY=$(key); FW=$(fw); : $${FW:=1.0.0}; \
	if [ -z "$$MAC" ] || [ -z "$$KEY" ]; then echo "Usage: make register mac=AA:BB:.. key=<hmacKey> [fw=1.0.0]" 1>&2; exit 2; fi; \
	echo '{"mac":"'"$$MAC"'","hmacKey":"'"$$KEY"'","firmwareVersion":"'"$$FW"'"}' | jq . && echo "(placeholder: no endpoint; use make seed or Prisma Studio)"
