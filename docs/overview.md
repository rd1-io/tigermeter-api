# TigerMeter Cloud API Documentation

This folder provides focused, task‑oriented guidance that complements the main `README.md` (concepts + diagrams) and `swagger.ru.yaml` (formal schema). Use these docs when implementing devices, portal integrations, or administrative tooling.

## Contents
- claim-flow.md — End‑to‑end device provisioning (issue → attach → poll → heartbeat)
- errors.md — Canonical error patterns & sample payloads
- overview.md — (this) Structure & navigation

## Source of Truth Hierarchy
1. `swagger.ru.yaml` — Path/method contracts & schemas
2. Runtime behavior (code in `node-api/src/routes`) — Execution semantics
3. `/docs/*.md` — Explanatory, non-authoritative narrative
4. Postman collection — Practical invocation examples

## Quick Start Sequence (Device + Portal)
1. Device: `POST /api/device-claims` → get claim `code`
2. User (Portal): `POST /api/device-claims/{code}/attach` (JWT)
3. Device polls: `GET /api/device-claims/{code}/poll` until 200 → obtain `deviceSecret`
4. Device heartbeats: `POST /api/devices/{id}/heartbeat` with Bearer secret
5. Portal pushes instructions: `PUT /api/devices/{id}/display`
6. Device receives new instruction on next heartbeat (hash mismatch)

See `claim-flow.md` for deeper timing, state machine, and one‑time secret issuance logic.

## Hash Generation (Summary)
- Canonicalization: top‑level key sort only (current implementation)
- Hash format: `sha256:<hex>`
- Mismatch handling: server recomputes; mismatch → HTTP 400 with `{message, expected}`

If hash algorithm changes (e.g., deep sort), update:
- `instructionHash` in `src/utils/crypto.ts`
- Postman pre‑request scripts for display instruction requests.

## Stability Guarantees
| Aspect | Guarantee | Notes |
| ------ | --------- | ----- |
| Claim code TTL | ~5 minutes | Config: `claimCodeTtlSeconds` |
| Device secret TTL | 90 days | Configurable; refresh overlap window ~5 min |
| One‑time secret reveal | Enforced | Subsequent poll → 404 |
| Display hash immutability | Stable per instruction | New instruction → new hash |
| Heartbeat idempotence | Yes | Same `displayHash` → `{ ok: true }` |

## Security Roadmap (Upcoming)
- Rate limit metrics & alerting
- Optional device public key pair bootstrapping for forward secrecy
- Replay guard for HMAC timestamp window (mac + minute bucket dedupe)
- Secret refresh audit ledger

HMAC on claim issuance is now enforced by default (can be disabled via `DISABLE_CLAIM_HMAC=1` for development convenience).

## Related Files
- `prisma/schema.prisma` — Persistent model (`Device`, `DeviceClaim`)
- `src/routes/device-claims.ts` — Claim endpoints (lazy secret generation)
- `src/routes/devices.ts` — Device‑authenticated endpoints
- `src/routes/portal.ts` — User (JWT) endpoints
- `src/routes/admin.ts` — Admin endpoints & filters
