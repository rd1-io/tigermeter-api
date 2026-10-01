# Ошибки и типовые ответы (v5)

Каталог типичных non-2xx ответов API v5.

## Общий формат
```json
{ "message": "Краткое описание для человека" }
```
Все эндпоинты под префиксом `/api/v5/`. Для прошивки ≤ v36 те же `POST /device-claims`, `GET /device-claims/{code}/poll` и `POST /devices/{id}/heartbeat` доступны и под старым префиксом `/api/` (только эти три).

## Ошибки аутентификации (v5 — только service tokens)
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| Любой (service) | 401 | Нет `Authorization: Bearer` | `{ "message": "Missing service token" }` |
| Любой (service) | 401 | Неизвестный token | `{ "message": "Invalid service token" }` |
| Любой (manage) | 403 | Неверный scope | `{ "message": "Scope 'manage' required, got 'ops'" }` |
| Любой (ops) | 403 | Неверный scope | `{ "message": "Forbidden" }` |

## Ошибки жизненного цикла claim
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| POST /api/v5/device-claims | 400 | Нет mac | `{ "message": "mac required" }` |
| POST /api/v5/device-claims | 400 | Неверный MAC | `{ "message": "invalid mac format" }` |
| POST /api/v5/device-claims | 401 | Неверный HMAC | `{ "message": "invalid hmac" }` |
| POST /api/v5/device-claims | 401 | timestamp не число | `{ "message": "invalid timestamp" }` |
| POST /api/v5/device-claims | 401 | timestamp вне окна ±5 мин | `{ "message": "timestamp out of allowed window" }` |
| POST /api/v5/device-claims | 401 | Время с момента включения при `ALLOW_LEGACY_CLAIM_TIMESTAMPS=false` | `{ "message": "timestamp must be unix time in milliseconds" }` |
| POST /api/v5/device-claims | 401 | Повтор того же запроса | `{ "message": "hmac already used" }` |
| POST /api/v5/device-claims | 503 | Не удалось подобрать свободный код | `{ "message": "Could not allocate claim code, retry later" }` |
| POST /api/v5/device-claims | 404 | Устройство не найдено | `{ "message": "device not found" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Неверный код | `{ "message": "Invalid code" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Истёкший код | `{ "message": "Expired code" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Токен тенанта `staging` (зарезервирован) | `{ "message": "Tenant is reserved" }` |
| POST /api/v5/device-claims/{code}/attach | 409 | Уже привязан | `{ "message": "Already claimed" }` |
| POST /api/v5/device-claims/{code}/attach | 429 | Rate limit (120/мин на token) | `{ "message": "Too Many Requests" }` |
| POST /api/v5/admin/device-claims/{code}/attach | 400/409/429 | Те же, что у attach выше (общий код) | `Invalid code` / `Expired code` / `Already claimed` |
| POST /api/v5/admin/device-claims/{code}/attach | 400 | `tenantId` = `staging` или тенант только с ops-токенами (например, `ops`) | `{ "message": "Tenant is reserved" }` |
| POST /api/v5/admin/device-claims/{code}/attach | 400 | `tenantId` нет среди тенантов `SERVICE_TOKENS` | `{ "message": "Unknown tenant" }` |
| POST /api/v5/admin/device-claims/{code}/attach | 400 | Нет `tenantId` | `{ "message": "tenantId: Required" }` |
| GET /api/v5/device-claims/{code}/poll | 202 | Pending | `{ "status": "pending" }` |
| GET /api/v5/device-claims/{code}/poll | 404 | Уже выдан / не найден | `{ "message": "Not found" }` |
| GET /api/v5/device-claims/{code}/poll | 410 | Истёк | `{ "message": "Expired" }` |
| GET /api/v5/device-claims/{code}/poll | 429 | С IP пришло >30 неизвестных кодов за минуту | `{ "message": "Too many unknown claim codes, retry later" }` |
| POST /api/v5/device-claims | 429 | >30 запросов за минуту с одного MAC | `{ "message": "Rate limit exceeded, retry later" }` |

## Ошибки кадров display (v5)
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| PUT /api/v5/devices/{id}/display | 400 | Нет frames | `{ "message": "frames must be an array of 1-8 items" }` |
| PUT /api/v5/devices/{id}/display | 400 | Неверный bitmap | `{ "message": "bitmap must be valid base64 of exactly 8064 bytes (384x168 1-bit packed)" }` |
| PUT /api/v5/devices/{id}/display | 400 | durationSec вне диапазона | `{ "message": "durationSec: out of range 1..86400" }` |
| PUT /api/v5/devices/{id}/display | 400 | refreshInterval вне диапазона | `{ "message": "refreshInterval: out of range 10..3600" }` |
| PUT /api/v5/devices/{id}/display | 400 | Неизвестный ключ | `{ "message": "Unrecognized key(s) in object: '...'" }` |
| PUT /api/v5/devices/{id}/display | 404 | Устройство не найдено / чужой tenant | `{ "message": "Not found" }` |
| PUT /api/v5/admin/devices/{id}/display | 400 | Те же ошибки валидации, что у PUT /devices/{id}/display | — |
| PUT /api/v5/admin/devices/{id}/display | 409 | Устройство не `active` или без тенанта | `{ "message": "Device is not attached to a tenant" }` |
| PUT /api/v5/admin/devices/{id}/display | 409 | Устройство на тенанте `staging` (OTA) | `{ "message": "Device is on the staging tenant for OTA" }` |
| GET /api/v5/devices/{id}/display | 404 | Чужой tenant или кадров нет | `{ "message": "Not found" }` / `{ "message": "No frames" }` |

## Ошибки auth устройства
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| Любой /devices/* (device auth) | 401 | Нет/неверный/истёкший секрет | `{ "message": "Invalid or expired secret" }` |
| POST /api/v5/devices/{id}/heartbeat | 404 | Устройство не найдено | `{ "message": "Device not found" }` |
| POST /api/v5/devices/{id}/heartbeat | 401 | Устройство на тенанте `staging` обновилось до `LATEST_FIRMWARE_VERSION`: секрет удалён, нужен новый claim | `{ "message": "Firmware updated, claim the device again" }` |
| GET /api/v5/devices/{id}/display/full | 304 | Hash не изменился | *Без тела* |
| GET /api/v5/devices/{id}/display/full | 404 | Нет кадров | `{ "message": "Not found" }` |

## Ошибки admin
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| POST /api/v5/admin/pending-devices/{id}/approve | 404 | Не найдено | `{ "message": "Not found" }` |
| POST /api/v5/admin/pending-devices/{id}/approve | 409 | Уже обработано | `{ "message": "Already processed" }` |

## Rate limiting
| Эндпоинт | Лимит | Ключ | Окно | Env |
| -------- | ----- | ---- | ---- | --- |
| POST /api/v5/device-claims | 1500 | IP | 1 минута | `CLAIM_RATE_LIMIT_PER_IP_PER_MINUTE` |
| POST /api/v5/device-claims | 30 | MAC | 1 минута | `CLAIM_RATE_LIMIT_PER_MAC_PER_MINUTE` |
| POST /api/v5/device-claims/{code}/attach | 120 | service token | 1 минута | `ATTACH_RATE_LIMIT_PER_MINUTE` |
| POST /api/v5/admin/device-claims/{code}/attach | 120 | service token | 1 минута | `ATTACH_RATE_LIMIT_PER_MINUTE` |
| GET /api/v5/device-claims/{code}/poll | 60 | код | 1 минута | `POLL_RATE_LIMIT_PER_CODE_PER_MINUTE` |
| GET /api/v5/device-claims/{code}/poll | 30 неизвестных кодов | IP | 1 минута | `POLL_UNKNOWN_CODES_PER_IP_PER_MINUTE` |
| POST /api/v5/devices/{id}/heartbeat | 60 | id устройства | 1 минута | `HEARTBEAT_RATE_LIMIT_PER_DEVICE_PER_MINUTE` |
| Остальные (глобально) | 100 | IP | 1 минута | — |

Партия устройств может стоять за одним NAT-IP (склад, офис), поэтому лимиты устройства считаются по коду/id/MAC, а не по IP. Лимит claim по IP рассчитан на ~100 непривязанных устройств, повторяющих запрос каждые ~5 с. Перебор кодов ограничен счётчиком неизвестных кодов на IP: после превышения poll с этого IP получает 429 и для существующих кодов. IP клиента берётся из `X-Forwarded-For` доверенного прокси (см. `TRUST_PROXY`).

Ответ при превышении (всегда `429`, никогда `403` — устройство трактует `403` как отзыв):
```http
429 Too Many Requests
Retry-After: 60
```
```json
{ "message": "Rate limit exceeded, retry in 1 minute" }
```

## Рекомендуемая обработка на клиенте
| HTTP | Действие |
| ---- | -------- |
| 200 | Продолжить / разобрать тело |
| 201 | Сохранить идентификаторы |
| 202 | Backoff и повтор (poll) |
| 304 | Пропустить обновление |
| 400 | Ошибка ввода; не повторять без изменений |
| 401 | Service: исправить token. Устройство: повторный claim |
| 403 | Ошибка scope; проверить права token |
| 404 | Контекст истёк; перезапустить claim или остановиться |
| 409 | Дубликат; остановиться |
| 410 | Перезапустить цикл claim |
| 429 | Backoff по заголовку Retry-After |
| 500 | Временная ошибка, retry с jitter (макс. 3 попытки) |
