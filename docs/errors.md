# Error & Response Patterns

This document catalogs typical non‑2xx responses so client/device logic can react deterministically.

## General Format
```json
{ "message": "Human readable short description" }
```
No error codes are embedded inside the JSON (HTTP status + message suffice). Add an `code` field later if localization / programmatic branching becomes complex.

## Claim Lifecycle Errors
| Endpoint | HTTP | Condition | Body Example |
| -------- | ---- | --------- | ------------ |
| POST /api/device-claims | 400 | Missing mac | `{ "message": "mac required" }` |
| POST /api/device-claims | 400 | Missing ts | `{ "message": "ts required" }` |
| POST /api/device-claims | 400 | Timestamp drift | `{ "message": "timestamp drift" }` |
| POST /api/device-claims | 400 | Missing hmac (when enforced) | `{ "message": "hmac required" }` |
| POST /api/device-claims | 401 | Invalid hmac | `{ "message": "invalid hmac" }` |
| POST /api/device-claims | 404 | Unknown device (when HMAC enforced) | `{ "message": "unknown device" }` |
| POST /api/device-claims | 409 | Device missing hmacKey | `{ "message": "device missing hmacKey" }` |
| POST /api/device-claims | 500 | Internal error | (generic) |
| POST /api/device-claims/{code}/attach | 400 | Invalid code | `{ "message": "Invalid code" }` |
| POST /api/device-claims/{code}/attach | 400 | Expired code | `{ "message": "Expired code" }` |
| POST /api/device-claims/{code}/attach | 409 | Already claimed | `{ "message": "Already claimed" }` |
| GET /api/device-claims/{code}/poll | 202 | Pending | `{ "status": "pending" }` |
| GET /api/device-claims/{code}/poll | 404 | Already issued / unknown code | `{ "message": "Not found" }` |
| GET /api/device-claims/{code}/poll | 410 | Expired | `{ "message": "Expired" }` |

## Device Auth Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| Any /devices/* (device auth) | 401 | Missing/invalid/expired secret | `{ "message": "Invalid or expired secret" }` |
| POST /devices/{id}/heartbeat | 404 | Device missing | `{ "message": "Device not found" }` |
| GET /devices/{id}/display/full | 304 | Hash unchanged | *No body* |
| GET /devices/{id}/display/full | 404 | No instruction | `{ "message": "Not found" }` |

## Portal/User Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| GET /api/devices/{id} | 403 | Foreign device | `{ "message": "Forbidden" }` |
| POST /api/devices/{id}/revoke | 404 | Unknown device | `{ "message": "Not found" }` |
| PUT /api/devices/{id}/display | 400 | Hash mismatch | `{ "message": "Hash mismatch", "expected": "sha256:..." }` |

## Admin Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| GET /api/admin/device-claims/{code} | 404 | Unknown code | `{ "message": "Not found" }` |
| POST /api/admin/devices/{id}/revoke | 404 | Unknown device | `{ "message": "Not found" }` |

## Rate Limiting
If exceeded (configured via `@fastify/rate-limit`):
```http
429 Too Many Requests
```
Headers may include:
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
Retry-After: 60
```
Body (default Fastify):
```json
{ "error": "Too Many Requests", "message": "Rate limit exceeded, retry in 60 seconds", "statusCode": 429 }
```
Clients SHOULD implement exponential or capped linear backoff.

## Recommended Client Handling Matrix
| HTTP | Suggested Action |
| ---- | ---------------- |
| 200 | Proceed / parse body |
| 201 | Store identifiers (claim code) |
| 202 | Backoff & retry (poll) |
| 304 | Skip update; maintain current state |
| 400 | User/device input bug; do not retry without change |
| 401 | Re-auth or re-claim secret sequence |
| 403 | Stop – permission issue |
| 404 | Context expired or invalid; conditional restart (claim vs fetch) |
| 409 | Show duplicate claim error to user |
| 410 | Restart claim cycle |
| 429 | Backoff per headers |
| 500 | Transient retry with jitter (max few attempts) |
