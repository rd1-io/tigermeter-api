# Claim Flow & Secret Issuance

This document expands the provisioning pipeline for a TigerMeter device.

## Sequence (High Resolution)
1. Device requests claim code: `POST /api/device-claims` (rate‑limited: 20/min/IP, HMAC required unless disabled)
2. User attaches code: `POST /api/device-claims/{code}/attach` (JWT user)
3. Device polls: `GET /api/device-claims/{code}/poll` (60/min/IP) until:
   - 202 pending
   - 200 secret (first claimed access ⇒ one‑time secret generation + return)
   - 404 after secret already issued
   - 410 expired (code TTL elapsed)
4. Device transitions to authenticated operation (heartbeats & instruction fetch)

## State Transitions
| State | Trigger | Next | Notes |
| ----- | ------- | ---- | ----- |
| awaiting_claim (Device.status) | Device created implicitly | awaiting_claim | Pre‑attach
| pending (Claim.status) | Issue | pending | TTL countdown
| claimed | Attach | claimed | Still no secret
| active (Device.status) | First successful poll (secret issued) | active | Secret hashed & stored
| revoked | Revoke | awaiting_claim (after device reclaims) | Secret invalidated

## One‑Time Secret Generation
- Happens inside poll handler when `status === claimed` and `secretIssued === false`.
- Device secret: prefix `ds_` + hex random bytes (length from config).
- Response body (200): `{ deviceId, deviceSecret, displayHash, expiresAt }`.
- Persistence:
  - `Device.currentSecretHash` (bcrypt) + `currentSecretExpiresAt`
  - `DeviceClaim.secretIssued = true`
- Any subsequent poll of same code → 404 (prevents replay / leakage).

## Polling Guidance
| Scenario | HTTP | Body | Backoff Suggestion |
| -------- | ---- | ---- | ------------------ |
| Not yet attached | 202 | `{"status":"pending"}` | 2s → 3s → 5s linear/backoff |
| Claimed & first poll | 200 | Secret payload | Stop polling |
| Already issued | 404 | `{"message":"Not found"}` | Stop & use secret |
| Expired | 410 | `{"message":"Expired"}` | Restart claim cycle |

## Error Examples
```jsonc
// Expired code
{ "message": "Expired code" }
// Invalid code on attach
{ "message": "Invalid code" }
// Already claimed on attach
{ "message": "Already claimed" }
// Secret already issued poll
{ "message": "Not found" }
```

## Security Considerations
- HMAC (enforced): Device must compute `hmac = HMAC_SHA256(hmacKey, mac:ts)` lowercase MAC and Unix seconds ts; server rejects if drift exceeds `claimHmacDriftSeconds` (default 120) or signature mismatch.
- Disable Flag: Set `DISABLE_CLAIM_HMAC=1` (development only) to auto-create devices without HMAC.
- Brute force mitigation: Rate limits + potential future captcha/attestation for mass claim attempts.
- Replay attack after poll: Eliminated via one‑time secret issuance and subsequent 404.

## Refresh vs Claim
| Feature | Claim Secret | Refresh Secret |
| ------- | ------------ | -------------- |
| Initiator | Device (poll) | Device (POST refresh) |
| Overlap | Not applicable | Yes (old secret valid short overlap) |
| Plaintext Leak | Only once | Only once (refresh response) |

## Future Enhancements
- Signed ephemeral challenge instead of static HMAC
- Optional user approval for refresh events
- Device public key registration for encrypted instruction delivery
