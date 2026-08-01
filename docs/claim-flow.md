# Привязка и выдача секрета (v5)

Описание pipeline провизионинга v5: service tokens для attach, без welcome-инструкции.

## Последовательность

1. Устройство включается, нет учётных данных → captive portal для настройки Wi‑Fi
2. Устройство вызывает `POST /api/v5/device-claims` с HMAC (rate limit: 20/мин/IP)
3. Сервер возвращает `{ code, expiresAt }` (6-значный код, TTL 5 минут)
4. Устройство показывает код на e-ink
5. Пользователь вводит код в приложении интегратора
6. Бэкенд интегратора вызывает:
   ```
   POST /api/v5/device-claims/{code}/attach
   Authorization: Bearer <service-token>  (scope=manage)
   Body: { "externalUserId": "внутренний-id-пользователя" }
   ```
7. Сервер валидирует и привязывает устройство:
   - `tenantId` = из service token
   - `externalUserId` = из тела запроса
   - `status` = "active"
   - Welcome-инструкция не создаётся (экран пуст до первого PUT /display)
8. Устройство опрашивает `GET /api/v5/device-claims/{code}/poll` (60/мин/IP):
   - 202 pending (ещё ждёт)
   - 200 secret (первый claimed → одноразовая генерация секрета)
   - 404 после того, как секрет уже выдан
   - 410 истёк
9. Устройство сохраняет секрет, начинает heartbeat, показывает «ожидание контента» до первых кадров

## Attach (изменение в v5)

Attach выполняется **service token** (scope=manage) вместо старого user-JWT flow.

Запрос:
```
POST /api/v5/device-claims/{code}/attach
Authorization: Bearer sk-tigermeter-...
Content-Type: application/json
{"externalUserId": "user-12345"}
```

Rate limit: **5 попыток в минуту на IP** (защита от перебора 6-значного кода).

Ответ (200):
```json
{ "deviceId": "uuid", "message": "Attached", "tenantId": "tigermeter" }
```

## Переходы состояний

| Состояние | Триггер | Следующее | Примечания |
| --------- | ------- | --------- | ---------- |
| awaiting_claim (Device.status) | Устройство создано (pre-provision или auto-provision) | awaiting_claim | До attach |
| pending (Claim.status) | Issue | pending | Обратный отсчёт TTL |
| claimed | Attach (service token) | claimed | tenantId + externalUserId установлены, секрета ещё нет |
| active (Device.status) | Первый успешный poll (секрет выдан) | active | Секрет захеширован и сохранён |

## Одноразовая генерация секрета

- Происходит в обработчике poll, когда `status === claimed` и `secretIssued === false`.
- Секрет устройства: префикс `ds_` + случайные hex-байты.
- Тело ответа (200): `{ deviceId, deviceSecret, displayHash, expiresAt }`.
- Повторный poll того же кода → 404 (защита от replay).

## Примеры ошибок

```jsonc
// Истёкший код
{ "message": "Expired code" }
// Неверный код при attach
{ "message": "Invalid code" }
// Уже привязан при attach
{ "message": "Already claimed" }
// Неверный service token
{ "message": "Missing service token" }
// Неверный scope при attach (нужен manage)
{ "message": "Forbidden" }
// Rate limit
{ "message": "Too Many Requests" }
```
