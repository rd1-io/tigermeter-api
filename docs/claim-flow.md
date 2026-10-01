# Привязка и выдача секрета (v5)

Описание pipeline провизионинга v5: service tokens для attach, без welcome-инструкции.

## Последовательность

1. Устройство включается, нет учётных данных → captive portal для настройки Wi‑Fi
2. Устройство вызывает `POST /api/v5/device-claims` с HMAC (rate limit: 30/мин на MAC и 1500/мин на IP, см. [errors.md](errors.md#rate-limiting))
   - `hmac = HMAC-SHA256(HMAC_KEY, "<MAC>:<firmwareVersion>:<timestamp>")`, `timestamp` — unix ms (время по NTP)
   - Сервер принимает `timestamp` в окне ±5 минут; повтор того же `hmac` → 401 `hmac already used`
   - Прошивка ≤ v36 шлёт время с момента включения (`millis()`); принимается, пока `ALLOW_LEGACY_CLAIM_TIMESTAMPS=true`
3. Сервер возвращает `{ code, expiresAt }` (6-значный код, TTL 5 минут). Предыдущий непривязанный код этого устройства аннулируется (его poll → 404)
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
8. Устройство опрашивает `GET /api/v5/device-claims/{code}/poll` каждые 3 с (60/мин на код):
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

Rate limit: **120 попыток в минуту на service token** (`ATTACH_RATE_LIMIT_PER_MINUTE`). Лимит считается по токену, а не по IP, потому что все attach приходят с одного бэкенда интегратора. Защиту от перебора кода конкретным пользователем (например, 5 попыток в минуту на `externalUserId`) реализует бэкенд интегратора.

Ответ (200):
```json
{ "deviceId": "uuid", "message": "Attached", "tenantId": "tigermeter" }
```

Тенант `staging` зарезервирован для автообновления: attach с токеном этого тенанта получает 400 `Tenant is reserved`.

## Привязка из админки (ops)

Админ обычно входит с ops-токеном, а attach выше привязывает к тенанту самого токена. Поэтому для админки есть отдельный ops-эндпоинт, где тенант выбирается явно:

```
GET  /api/v5/admin/tenants                      → [{ "tenantId": "tigermeter", "scopes": ["manage"] }, ...]
POST /api/v5/admin/device-claims/{code}/attach
Authorization: Bearer sk-ops-...
{"tenantId": "tigermeter", "externalUserId": "qa-1"}   // externalUserId необязателен
```

- `tenantId` — только тенант с manage-токеном в `SERVICE_TOKENS` (список отдаёт `GET /admin/tenants`, токены не раскрываются); `staging` и служебные тенанты только с ops-токенами (например, `ops`) запрещены — 400 `Tenant is reserved`;
- логика общая с tenant attach (`utils/claims.ts`): те же проверки кода и ошибки (`Invalid code`, `Expired code`, `Already claimed`), тот же лимит 120/мин на токен, код помечается использованным атомарно;
- с manage-токеном форма в админке вызывает обычный `POST /device-claims/{code}/attach` и привязывает к своему тенанту.

После привязки ops-админ может слать кадры устройству любого тенанта через `PUT /api/v5/admin/devices/{id}/display` (устройство должно быть `active`, не `staging`) и смотреть доставку через `GET /api/v5/admin/devices/{id}`.

## Переходы состояний

| Состояние | Триггер | Следующее | Примечания |
| --------- | ------- | --------- | ---------- |
| awaiting_claim (Device.status) | Устройство создано (pre-provision или auto-provision) | awaiting_claim | До attach |
| pending (Claim.status) | Issue | pending | Обратный отсчёт TTL |
| claimed | Attach (service token) | claimed | tenantId + externalUserId установлены, секрета ещё нет |
| active (Device.status) | Первый успешный poll (секрет выдан) | active | Секрет захеширован и сохранён |
| awaiting_claim, без тенанта | Issue со старой прошивкой при включённом `autoUpgradeOutdatedDevices` | active, `tenantId=staging` | Claim сразу `claimed` |
| active, `tenantId=staging` | Heartbeat с `firmwareVersion >= LATEST_FIRMWARE_VERSION` | awaiting_claim, без тенанта | Секрет удалён, ответ 401 |

## Автообновление непривязанных устройств (staging)

Устройства со старой прошивкой не обновляются, пока не привязаны: OTA в прошивке ≤ v36 запускается только в состоянии `active`, по данным heartbeat. Чтобы партия непривязанных устройств обновилась сама, в админке есть переключатель `autoUpgradeOutdatedDevices` (таблица `Setting`, по умолчанию выключен; `GET/PATCH /api/v5/admin/settings`).

Прошивка ≤ v36 собрана с `API_BASE_URL=https://api-tiger.rd1.io/api`, поэтому сервер обслуживает её claim, poll и heartbeat также под префиксом `/api/`.

Когда переключатель включён и `POST /device-claims` приходит с `firmwareVersion` (`"v36"` → 36) ниже `LATEST_FIRMWARE_VERSION`, а устройство не принадлежит тенанту (нет `tenantId` или `tenantId = "staging"`):

1. Устройство создаётся, если его нет (даже при выключенном auto-provision); запись в `PendingDevice` помечается `approved`.
2. Claim сразу помечается `claimed`, устройство привязывается к зарезервированному тенанту `staging` (`status=active`, `autoUpdate=true`, `externalUserId=null`, кадры очищены).
3. Первый poll выдаёт секрет, устройство начинает heartbeat и получает `latestFirmwareVersion`, `firmwareDownloadUrl`, `autoUpdate=true`.
4. Через 60 с после загрузки прошивка скачивает `{firmwareDownloadUrl}/firmware-ota.bin` и перезагружается.
5. Новая прошивка шлёт heartbeat со старым секретом и `firmwareVersion >= LATEST_FIRMWARE_VERSION`. Сервер удаляет секрет, ставит `tenantId=null`, `status=awaiting_claim`, очищает кадры и отвечает `401`.
6. Прошивка на `401` удаляет только свои учётные данные (Wi‑Fi остаётся) и запрашивает новый код. Версия уже актуальна, поэтому устройство не привязывается к `staging` повторно, а ждёт обычного attach от клиента.

Выключение переключателя останавливает только новые привязки: устройства, уже стоящие на `staging`, доходят до шага 6. Устройства тенантов (любой `tenantId`, кроме `staging`) не затрагиваются. Переходы пишутся в лог API (`auto-upgrade: ...`).

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
