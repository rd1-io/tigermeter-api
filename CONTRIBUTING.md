# Contributing Guide

Welcome! This document explains how to propose changes safely and keep API, docs, and tools in sync.

## 1. Sources of Truth (Priority)
1. `swagger.ru.yaml` — Formal API contract (paths, schemas, security)
2. Runtime implementation under `node-api/src/routes/*`
3. Documentation in `docs/*.md` (overview, claim-flow, errors)
4. Postman collection `postman/TigerMeter.collection.json`
5. README / diagrams

Always update (1) *before or together with* (2). After code changes, reconcile (3) and (4).

## 2. Workflow for API Changes
| Step | Action |
| ---- | ------ |
| 1 | Open an issue describing change + rationale + backward compatibility plan |
| 2 | Update `swagger.ru.yaml` (add path / modify schema). Increment `info.version` if breaking. |
| 3 | Implement route handler(s) in `node-api/src/routes` (minimal, focused diff). |
| 4 | Update or add Zod schemas / validation as needed. |
| 5 | Update Postman collection (new request, pre-request scripts, tests). |
| 6 | Add or adjust docs in `docs/` (link new flow or error). |
| 7 | (If DB) Create Prisma migration. |
| 8 | Smoke test locally (`make dev` or `npm run dev` inside `node-api`). |
| 9 | Open PR referencing issue; include checklist (below). |

### PR Checklist
- [ ] Swagger path/method/schema updated
- [ ] Route(s) implemented & lint passes
- [ ] Postman request updated/added
- [ ] Docs updated (`overview.md` / `claim-flow.md` / `errors.md` if needed)
- [ ] Prisma migration (if schema touched) + generated client
- [ ] Backward compatibility notes (deprecations, sunset dates)
- [ ] Example request/response added to description or tests

## 3. Coding Guidelines
- TypeScript ESM, no default namespace imports unless required.
- Avoid large multi‑concern commits; one logical unit per commit.
- Maintain existing stylistic patterns (e.g. early returns for errors).
- Use Zod for request validation near route definition.
- Prefer descriptive variable names; avoid single letters except indices.
- Avoid silent catch; log or propagate via Fastify error helpers.

## 4. Device Claim & Secret Rules (Sensitive Logic)
- One‑time secret issuance: Do not leak plaintext more than once.
- Any change to secret lifecycle must update: `docs/claim-flow.md`, `errors.md`, Postman poll & refresh scripts.
- Rate limits for claim & poll should remain conservative; update `device-claims.ts` config blocks if adjusting.

## 5. Hashing Rules
- Current algorithm: top‑level key sort + JSON stringify → SHA‑256 hex with `sha256:` prefix.
- Changing canonicalization is a **breaking change**; coordinate with firmware schedule.
- When changed: update `src/utils/crypto.ts`, Postman pre-request scripts (display requests), docs (overview hash section), and add migration announcement.

## 6. Database Changes (Prisma)
1. Edit `prisma/schema.prisma`.
2. Run migration:
```bash
cd node-api
npx prisma migrate dev --name <short_change_name>
```
3. Regenerate client:
```bash
npx prisma generate
```
4. If adding optional columns: ensure code tolerates `null` until backfilled.
5. Document new fields in relevant schema objects in Swagger and any device/portal JSON.

### Backfilling Example (Ad Hoc)
```bash
node-api/scripts/backfill-led-brightness.ts (create if needed)
```
Include idempotent guards (only fill where null).

## 7. Error Response Consistency
- Standard error body: `{ "message": "..." }`
- Do not add bespoke fields unless justified; update `docs/errors.md` when you do.
- For new 4xx/5xx conditions, prefer existing statuses; avoid 422 unless validating complex nested constraints.

## 8. Rate Limiting
- Global defaults set in `src/plugins/rate-limit.ts`.
- Per-route overrides in route config `config.rateLimit`.
- If adjusting limits, update: Postman request description + `docs/claim-flow.md` (poll/issue table) + `docs/errors.md` (429 examples if semantics changed).

## 9. Security Considerations
- Secrets: Never log plaintext device secrets or claim codes.
- HMAC (future) enforcement plan: add verification in `device-claims.ts` prior to claim creation; mismatch → 400.
- Use timing-safe comparisons for secrets (bcrypt compare already mitigates side-channels).
- Validate user/device ownership before returning resource details.

## 10. Testing / Verification (Lightweight)
Even without a formal test suite yet, run manual checks:
```bash
# Start API
make dev
# Issue claim
curl -X POST localhost:3001/api/device-claims -H 'Content-Type: application/json' \
  -d '{"mac":"AA:BB:CC:DD:EE:FF","firmwareVersion":"1.0.0"}'
```
Then proceed with attach → poll → heartbeat via Postman or curl. Add simple scripts under `node-api/scripts/` for repetitive flows.

## 11. Postman Collection Updates
- Keep variable names stable (`claimCode`, `deviceSecret`, `deviceId`, `displayHash`).
- Pre-request scripts must remain deterministic; avoid network fetch inside scripts.
- When adding new endpoints: supply at least one test script capturing relevant IDs into environment.

## 12. Localization
- Swagger currently in Russian (`x-language: ru`). For English additions ensure bilingual consistency if added (avoid partial translation drift).

## 13. Deprecation Process
1. Mark route in Swagger with `deprecated: true`.
2. Leave handler returning normal responses for ≥1 version window.
3. Announce in `README.md` and commit message.
4. Remove after grace period, bump minor/major as appropriate.

## 14. Commit Message Style
Format:
```
<scope>: <concise summary>

Optional body with rationale / migration notes.
```
Examples:
```
routes: add display pre-request hash generation
prisma: add ledBrightness column and persist on display update
postman: add admin filter examples & rate limit notes
```

## 15. Review Guidelines
Reviewers check:
- Contract parity (Swagger ↔ code ↔ Postman)
- Security regression (secret leakage, auth bypass)
- Performance (unbounded queries, missing indexes)
- Consistency (naming, error shapes)

## 16. Getting Help
Open a GitHub issue or start a discussion thread referencing concrete file paths and observed vs expected behavior.

Happy building!
