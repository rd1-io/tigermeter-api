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
6. Устройство на каждом heartbeat получает один текущий кадр набора: ротацию по `durationSec` ведёт сервер (минимум 10 с на кадр, точность ± несколько секунд, без связи кадр не меняется; `beep`/`flashCount` — только при первом показе кадра после PUT). Прошивкам ниже v38 кадры не отдаются (см. README, «Ротация кадров»)
7. Проверить доставку: `GET /api/v5/devices/{id}` — `rotation` (текущий кадр по расписанию), `deliveredFrameIndex`/`deliveredDisplayHash` (кадр отдан в heartbeat) и `deviceFrameIndex`/`reportedDisplayHash` (устройство прислало хеш этого кадра на следующем heartbeat, т.е. показывает его; для одного кадра `reportedDisplayHash` = `displayHash`). Если устройство дважды перезагрузилось сразу после получения кадров, не подтвердив их, сервер перестаёт их отдавать (`displayBlocked: true`, предупреждение в логе API) до следующего PUT /display

Подробнее о таймингах, state machine и одноразовой выдаче секрета — в `claim-flow.md`.

## Формирование display hash (кратко)
- Канонизация: JSON с рекурсивно отсортированными ключами (`displayPayloadHash` в `src/utils/crypto.ts`)
- Формат hash: `sha256:<hex>`
- Hash набора включает все поля, в том числе `beep`/`flashCount`/`refreshMode`
- Прошивка v39+ меняет кадр частичным обновлением экрана (без моргания); полное — после системных экранов, каждые 30 частичных или 10 минут, либо при `refreshMode: "full"` (см. README, «Частичное обновление экрана»)
- Каждый отданный кадр имеет свой хеш доставки (для набора из одного кадра = hash набора); устройство передаёт его в heartbeat, и сервер отдаёт кадр, только если текущий по расписанию кадр другой

## Гарантии стабильности
| Аспект | Гарантия | Примечания |
| ------ | -------- | ---------- |
| TTL кода привязки | ~5 минут | Конфиг: `claimCodeTtlSeconds` |
| TTL секрета устройства | 90 дней | Настраивается; окно перекрытия при refresh ~5 мин |
| Одноразовая выдача секрета | Да | Повторный poll → 404 |
| Неизменность display hash | Стабилен для набора кадров | Новый PUT → новый hash |
| Идемпотентность heartbeat | Да | Тот же `displayHash` → `{ ok: true }` (без кадров) |
| Rate limit attach | 120/мин на service token | Перебор кода пользователем ограничивает бэкенд интегратора |
| Свежесть HMAC claim | ±5 минут, без повторов | Для прошивки ≤ v36 — пока `ALLOW_LEGACY_CLAIM_TIMESTAMPS=true` |

## Дорожная карта безопасности (планируется)
- Метрики rate limit и алерты
- Опциональная пара ключей устройства для forward secrecy
- Ключ HMAC на устройство вместо общего (общий ключ извлекается из публичной прошивки)
- Аудит-лог refresh секрета

HMAC при выдаче claim-кода включён по умолчанию; timestamp проверяется на свежесть (±5 минут), повторы одного `hmac` отклоняются.

## Связанные файлы
- `prisma/schema.prisma` — модель данных (`Device`, `DeviceClaim`, `PendingDevice`, `Setting`)
- `src/routes/device-claims.ts` — claim-эндпоинты (ленивая выдача секрета, attach тенанта)
- `src/routes/devices.ts` — эндпоинты с auth устройства (heartbeat, display hash/full, refresh)
- `src/routes/portal.ts` — control plane тенанта (scope=manage): CRUD устройств, PUT display
- `src/routes/admin.ts` — ops-плоскость (scope=ops): флот, pending, настройки, factory-reset, привязка по коду и кадры от имени тенанта
- `src/utils/claims.ts` — общий attach кода к тенанту (tenant attach и admin attach)
- `src/utils/display.ts` — схема кадров, сохранение кадров, DTO состояния устройства
