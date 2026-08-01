# Документация TigerMeter Cloud API

Эта папка дополняет основной `README.md` (концепции и диаграммы) и `swagger.ru.yaml` (формальная схема). Используйте эти документы при интеграции устройств, бэкенда интегратора или ops-инструментов.

## Содержание
- claim-flow.md — полный цикл провизионинга (issue → attach → poll → heartbeat)
- errors.md — типовые ошибки и примеры ответов
- overview.md — (этот файл) структура и навигация

## Иерархия источников истины
1. `swagger.ru.yaml` — контракты путей/методов и схемы (v5, префикс `/api/v5/`)
2. Поведение рантайма (код в `node-api/src/routes`) — семантика выполнения
3. `/docs/*.md` — пояснительный текст, не является авторитетным контрактом

## Быстрый старт (устройство + интегратор)
1. Устройство: `POST /api/v5/device-claims` → получить код привязки (HMAC)
2. Бэкенд интегратора: `POST /api/v5/device-claims/{code}/attach` (service token, scope=manage) с `{externalUserId}`
3. Устройство опрашивает: `GET /api/v5/device-claims/{code}/poll` до 200 → получить `deviceSecret`
4. Heartbeat устройства: `POST /api/v5/devices/{id}/heartbeat` с Bearer-секретом
5. Интегратор отправляет bitmap-кадры: `PUT /api/v5/devices/{id}/display`
6. Устройство получает новые кадры при следующем heartbeat (несовпадение hash)

Подробнее о таймингах, state machine и одноразовой выдаче секрета — в `claim-flow.md`.

## Формирование display hash (кратко)
- Канонизация: JSON с рекурсивно отсортированными ключами (`displayPayloadHash` в `src/utils/crypto.ts`)
- Формат hash: `sha256:<hex>`
- Hash включает все поля, в том числе `beep`/`flashCount` (логики strip нет)
- Устройство передаёт известный `displayHash` в heartbeat; сервер отдаёт кадры только при несовпадении

## Гарантии стабильности
| Аспект | Гарантия | Примечания |
| ------ | -------- | ---------- |
| TTL кода привязки | ~5 минут | Конфиг: `claimCodeTtlSeconds` |
| TTL секрета устройства | 90 дней | Настраивается; окно перекрытия при refresh ~5 мин |
| Одноразовая выдача секрета | Да | Повторный poll → 404 |
| Неизменность display hash | Стабилен для набора кадров | Новый PUT → новый hash |
| Идемпотентность heartbeat | Да | Тот же `displayHash` → `{ ok: true }` (без кадров) |
| Rate limit attach | 5/мин/IP | Защита от перебора 6-значного кода |

## Дорожная карта безопасности (планируется)
- Метрики rate limit и алерты
- Опциональная пара ключей устройства для forward secrecy
- Защита от replay для окна HMAC timestamp (dedupe mac + minute bucket)
- Аудит-лог refresh секрета

HMAC при выдаче claim-кода включён по умолчанию.

## Связанные файлы
- `prisma/schema.prisma` — модель данных (`Device`, `DeviceClaim`, `PendingDevice`, `Setting`)
- `src/routes/device-claims.ts` — claim-эндпоинты (ленивая выдача секрета, attach тенанта)
- `src/routes/devices.ts` — эндпоинты с auth устройства (heartbeat, display hash/full, refresh)
- `src/routes/portal.ts` — control plane тенанта (scope=manage): CRUD устройств, PUT display
- `src/routes/admin.ts` — ops-плоскость (scope=ops): флот, pending, настройки, factory-reset
