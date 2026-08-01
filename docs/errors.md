# Ошибки и типовые ответы (v5)

Каталог типичных non-2xx ответов API v5.

## Общий формат
```json
{ "message": "Краткое описание для человека" }
```
Все эндпоинты под префиксом `/api/v5/`.

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
| POST /api/v5/device-claims | 404 | Устройство не найдено | `{ "message": "device not found" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Неверный код | `{ "message": "Invalid code" }` |
| POST /api/v5/device-claims/{code}/attach | 400 | Истёкший код | `{ "message": "Expired code" }` |
| POST /api/v5/device-claims/{code}/attach | 409 | Уже привязан | `{ "message": "Already claimed" }` |
| POST /api/v5/device-claims/{code}/attach | 429 | Rate limit (5/мин) | `{ "message": "Too Many Requests" }` |
| GET /api/v5/device-claims/{code}/poll | 202 | Pending | `{ "status": "pending" }` |
| GET /api/v5/device-claims/{code}/poll | 404 | Уже выдан / не найден | `{ "message": "Not found" }` |
| GET /api/v5/device-claims/{code}/poll | 410 | Истёк | `{ "message": "Expired" }` |

## Ошибки кадров display (v5)
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| PUT /api/v5/devices/{id}/display | 400 | Нет frames | `{ "message": "frames must be an array of 1-8 items" }` |
| PUT /api/v5/devices/{id}/display | 400 | Неверный bitmap | `{ "message": "bitmap must be valid base64 of exactly 8064 bytes (384x168 1-bit packed)" }` |
| PUT /api/v5/devices/{id}/display | 400 | durationSec вне диапазона | `{ "message": "durationSec: out of range 1..86400" }` |
| PUT /api/v5/devices/{id}/display | 400 | refreshInterval вне диапазона | `{ "message": "refreshInterval: out of range 10..3600" }` |
| PUT /api/v5/devices/{id}/display | 400 | Неизвестный ключ | `{ "message": "Unrecognized key(s) in object: '...'" }` |
| PUT /api/v5/devices/{id}/display | 404 | Устройство не найдено / чужой tenant | `{ "message": "Not found" }` |

## Ошибки auth устройства
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| Любой /devices/* (device auth) | 401 | Нет/неверный/истёкший секрет | `{ "message": "Invalid or expired secret" }` |
| POST /api/v5/devices/{id}/heartbeat | 404 | Устройство не найдено | `{ "message": "Device not found" }` |
| GET /api/v5/devices/{id}/display/full | 304 | Hash не изменился | *Без тела* |
| GET /api/v5/devices/{id}/display/full | 404 | Нет кадров | `{ "message": "Not found" }` |

## Ошибки admin
| Эндпоинт | HTTP | Условие | Тело |
| -------- | ---- | ------- | ---- |
| POST /api/v5/admin/pending-devices/{id}/approve | 404 | Не найдено | `{ "message": "Not found" }` |
| POST /api/v5/admin/pending-devices/{id}/approve | 409 | Уже обработано | `{ "message": "Already processed" }` |

## Rate limiting
| Эндпоинт | Лимит | Окно |
| -------- | ----- | ---- |
| POST /api/v5/device-claims | 20 | 1 минута |
| POST /api/v5/device-claims/{code}/attach | 5 | 1 минута |
| GET /api/v5/device-claims/{code}/poll | 60 | 1 минута |
| Остальные (глобально) | 100 | 1 минута |

Ответ при превышении:
```http
429 Too Many Requests
Retry-After: 60
```
```json
{ "error": "Too Many Requests", "message": "Rate limit exceeded, retry in 60 seconds", "statusCode": 429 }
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
