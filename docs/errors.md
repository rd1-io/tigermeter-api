# Error & Response Patterns (v5)

This document catalogs typical non‑2xx responses for API v5.

## General Format
```json
{ "message": "Human readable short description" }
```
All endpoints are under `/api/v5/` prefix.

## Auth Errors (v5 — service tokens only)
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| Any (service) | 401 | Missing `Authorization: Bearer` | `{ "message": "Missing service token" }` |
| Any (service) | 401 | Unknown token | `{ "message": "Invalid service token" }` |
| Any (manage) | 403 | Wrong scope | `{ "message": "Scope 'manage' required, got 'ops'" }` |
| Any (ops) | 403 | Wrong scope | `{ "message": "Forbidden" }` |

## Claim Lifecycle Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| POST /api/v5/device-claims | 400 | Missing mac | `{ "message": "mac required" }` |
| POST /api/v5/device-claims | 400 | Invalid MAC | `{ "message": "invalid mac format" }` |
| POST /api/v5/device-claims | 401 | Invalid HMAC | `{ "message": "invalid hmac" }` |
| POST /api/v5/device-claims | 404 | Unknown device | `{ "message": "device not found" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Invalid code | `{ "message": "Invalid code" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Expired code | `{ "message": "Expired code" }` |
| POST /api/v5/device-claims/{code}/attach | 409 | Already claimed | `{ "message": "Already claimed" }` |
| POST /api/v5/device-claims/{code}/attach | 429 | Rate limited (5/min) | `{ "message": "Too Many Requests" }` |
| GET /api/v5/device-claims/{code}/poll | 202 | Pending | `{ "status": "pending" }` |
| GET /api/v5/device-claims/{code}/poll | 404 | Already issued / unknown | `{ "message": "Not found" }` |
| GET /api/v5/device-claims/{code}/poll | 410 | Expired | `{ "message": "Expired" }` |

## Display Frames Errors (v5)
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| PUT /api/v5/devices/{id}/display | 400 | Missing frames | `{ "message": "frames must be an array of 1-8 items" }` |
| PUT /api/v5/devices/{id}/display | 400 | Invalid bitmap | `{ "message": "bitmap must be valid base64 of exactly 8064 bytes (384x168 1-bit packed)" }` |
| PUT /api/v5/devices/{id}/display | 400 | durationSec out of range | `{ "message": "durationSec: out of range 1..86400" }` |
| PUT /api/v5/devices/{id}/display | 400 | refreshInterval out of range | `{ "message": "refreshInterval: out of range 10..3600" }` |
| PUT /api/v5/devices/{id}/display | 400 | Unknown key | `{ "message": "Unrecognized key(s) in object: '...'" }` |
| PUT /api/v5/devices/{id}/display | 404 | Device not found / wrong tenant | `{ "message": "Not found" }` |

## Device Auth Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| Any /devices/* (device auth) | 401 | Missing/invalid/expired secret | `{ "message": "Invalid or expired secret" }` |
| POST /api/v5/devices/{id}/heartbeat | 404 | Device missing | `{ "message": "Device not found" }` |
| GET /api/v5/devices/{id}/display/full | 304 | Hash unchanged | *No body* |
| GET /api/v5/devices/{id}/display/full | 404 | No frames | `{ "message": "Not found" }` |

## Admin Errors
| Endpoint | HTTP | Condition | Body |
| -------- | ---- | --------- | ---- |
| POST /api/v5/admin/pending-devices/{id}/approve | 404 | Not found | `{ "message": "Not found" }` |
| POST /api/v5/admin/pending-devices/{id}/approve | 409 | Already processed | `{ "message": "Already processed" }` |

## Rate Limiting
| Endpoint | Rate | Window |
| -------- | ---- | ------ |
| POST /api/v5/device-claims | 20 | 1 minute |
| POST /api/v5/device-claims/{code}/attach | 5 | 1 minute |
| GET /api/v5/device-claims/{code}/poll | 60 | 1 minute |
| All others (global) | 100 | 1 minute |

Response on exceed:
```http
429 Too Many Requests
Retry-After: 60
```
```json
{ "error": "Too Many Requests", "message": "Rate limit exceeded, retry in 60 seconds", "statusCode": 429 }
```

## Recommended Client Handling
| HTTP | Action |
| ---- | ------ |
| 200 | Proceed / parse body |
| 201 | Store identifiers |
| 202 | Backoff & retry (poll) |
| 304 | Skip update |
| 400 | Input error; do not retry without change |
| 401 | Service: fix token. Device: re-claim |
| 403 | Scope error; check token permissions |
| 404 | Context expired; restart claim or stop |
| 409 | Duplicate; stop |
| 410 | Restart claim cycle |
| 429 | Backoff per Retry-After header |
| 500 | Transient retry with jitter (max 3 attempts) |