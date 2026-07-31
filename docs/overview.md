# TigerMeter Cloud API Documentation

This folder provides focused, task‑oriented guidance that complements the main `README.md` (concepts + diagrams) and `swagger.ru.yaml` (formal schema). Use these docs when implementing devices, portal integrations, or administrative tooling.

## Contents
- claim-flow.md — End‑to‑end device provisioning (issue → attach → poll → heartbeat)
- errors.md — Canonical error patterns & sample payloads
- overview.md — (this) Structure & navigation

## Source of Truth Hierarchy
1. `swagger.ru.yaml` — Path/method contracts & schemas (v5, `/api/v5/` prefix)
2. Runtime behavior (code in `node-api/src/routes`) — Execution semantics
3. `/docs/*.md` — Explanatory, non-authoritative narrative

## Quick Start Sequence (Device + Tenant)
1. Device: `POST /api/v5/device-claims` → get claim `code` (HMAC)
2. Tenant backend: `POST /api/v5/device-claims/{code}/attach` (service token, scope=manage) with `{externalUserId}`
3. Device polls: `GET /api/v5/device-claims/{code}/poll` until 200 → obtain `deviceSecret`
4. Device heartbeats: `POST /api/v5/devices/{id}/heartbeat` with Bearer secret
5. Tenant pushes bitmap frames: `PUT /api/v5/devices/{id}/display`
6. Device receives new frames on next heartbeat (hash mismatch)

See `claim-flow.md` for deeper timing, state machine, and one‑time secret issuance logic.

## Display Hash Generation (Summary)
- Canonicalization: recursive sorted-keys JSON (`displayPayloadHash` in `src/utils/crypto.ts`)
- Hash format: `sha256:<hex>`
- Hash covers ALL fields including `beep`/`flashCount` (no strip logic)
- Device sends its known `displayHash` on heartbeat; server returns frames only on mismatch

## Stability Guarantees
| Aspect | Guarantee | Notes |
| ------ | --------- | ----- |
| Claim code TTL | ~5 minutes | Config: `claimCodeTtlSeconds` |
| Device secret TTL | 90 days | Configurable; refresh overlap window ~5 min |
| One‑time secret reveal | Enforced | Subsequent poll → 404 |
| Display hash immutability | Stable per frame set | New PUT → new hash |
| Heartbeat idempotence | Yes | Same `displayHash` → `{ ok: true }` (no frames) |
| Attach rate limit | 5/min/IP | Anti-brute-force on 6-digit code |

## Security Roadmap (Upcoming)
- Rate limit metrics & alerting
- Optional device public key pair bootstrapping for forward secrecy
- Replay guard for HMAC timestamp window (mac + minute bucket dedupe)
- Secret refresh audit ledger

HMAC on claim issuance is enforced by default.

## Related Files
- `prisma/schema.prisma` — Persistent model (`Device`, `DeviceClaim`, `PendingDevice`, `Setting`)
- `src/routes/device-claims.ts` — Claim endpoints (lazy secret generation, tenant attach)
- `src/routes/devices.ts` — Device‑authenticated endpoints (heartbeat, display hash/full, refresh)
- `src/routes/portal.ts` — Tenant control plane (scope=manage): devices CRUD, PUT display
- `src/routes/admin.ts` — Ops plane (scope=ops): fleet, pending, settings, factory-reset
