# Claim Flow & Secret Issuance (v5)

This document describes the v5 provisioning pipeline — service tokens for attach, no welcome instruction.

## Sequence

1. Device powers on, no credentials → shows captive portal for WiFi setup
2. Device calls `POST /api/v5/device-claims` with HMAC (rate‑limited: 20/min/IP)
3. Server returns `{ code, expiresAt }` (6-digit code, 5-minute TTL)
4. Device displays the code on e-ink
5. End user enters the code in the customer's app
6. Customer backend calls:
   ```
   POST /api/v5/device-claims/{code}/attach
   Authorization: Bearer <service-token>  (scope=manage)
   Body: { "externalUserId": "their-internal-id" }
   ```
7. Server validates, binds device:
   - `tenantId` = from service token
   - `externalUserId` = from body
   - `status` = "active"
   - No welcome instruction (display stays empty until first PUT /display)
8. Device polls `GET /api/v5/device-claims/{code}/poll` (60/min/IP):
   - 202 pending (still waiting)
   - 200 secret (first claimed access → one‑time secret generation)
   - 404 after secret already issued
   - 410 expired
9. Device stores secret, starts heartbeats, shows "waiting for content" until first frames

## Attach (v5 change)

Attach is performed by **service token** (scope=manage), replacing the old user-JWT flow.

Request:
```
POST /api/v5/device-claims/{code}/attach
Authorization: Bearer sk-tigermeter-...
Content-Type: application/json
{"externalUserId": "user-12345"}
```

Rate limit: **5 attempts per minute per IP** (strict anti-brute-force on 6-digit code).

## State Transitions

| State | Trigger | Next | Notes |
| ----- | ------- | ---- | ----- |
| awaiting_claim (Device.status) | Device created (pre-provision or auto-provision) | awaiting_claim | Pre-attach |
| pending (Claim.status) | Issue | pending | TTL countdown |
| claimed | Attach (service token) | claimed | tenantId + externalUserId set, no secret yet |
| active (Device.status) | First successful poll (secret issued) | active | Secret hashed & stored |

## One‑Time Secret Generation

- Happens inside poll handler when `status === claimed` and `secretIssued === false`.
- Device secret: prefix `ds_` + hex random bytes.
- Response body (200): `{ deviceId, deviceSecret, displayHash, expiresAt }`.
- Subsequent poll of same code → 404 (prevents replay).

## Error Examples

```jsonc
// Expired code
{ "message": "Expired code" }
// Invalid code on attach
{ "message": "Invalid code" }
// Already claimed on attach
{ "message": "Already claimed" }
// Invalid service token
{ "message": "Missing service token" }
// Wrong scope on attach (manage required)
{ "message": "Forbidden" }
// Rate limited
{ "message": "Too Many Requests" }
```