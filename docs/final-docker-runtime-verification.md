# Финальная Docker и Runtime-проверка

Дата подготовки: 13 сентября 2026 года  
Направление: эксплуатационная приёмка (Production Runtime Acceptance)

---

## 1. Контекст и архитектурные ограничения

Приложение `mpod` функционирует как единый легковесный контейнер без внешних брокеров, очередей или сетевых СУБД (`AGENTS.md`, `docs/architecture.md`):
- **Сетевой порт:** `5050` (проброс `5050:5050` на хосте).
- **База данных:** встроенная SQLite (`/data/mpod.sqlite`).
- **Файлы скачиваний:** одноразовые копии (`/data/downloads/`).
- **Постоянный том данных:** Docker volume `mpod_data` смонтирован в `/data` с правами `RW`.
- **Библиотека аудиокниг:** директория на хосте смонтирована в `/share/audio/abooks/` строго с флагом `:ro` (Read-Only).
- **Пользователь процесса:** непривилегированный пользователь `mpod` (UID/GID в Alpine).

---

## 2. Задание администратору стенда / сервера

### 2.1. Чистое развёртывание (Clean Deployment)
1. Подготовить конфигурационный файл `.env`:
   ```bash
   cp .env.example .env
   ```
   Указать:
   ```ini
   PORT=5050
   APP_ENV=production
   APP_BUILD=$(git rev-parse --short HEAD)
   TZ=UTC
   SESSION_SECRET=<random-strong-secret-key>
   DATA_DIR=/data
   DB_PATH=/data/mpod.sqlite
   DOWNLOADS_DIR=/data/downloads
   AUDIOBOOKS_PATH=/share/audio/abooks
   AUDIOBOOKS_DIR=/share/audio/abooks/
   DAILY_REFRESH_TIME=03:00
   ```
2. Собрать образ и запустить контейнер:
   ```bash
   docker compose up -d --build
   ```
3. Проверить статус контейнера и логи:
   ```bash
   docker compose ps
   docker compose logs --tail=100 mpod
   ```
   *Критерий:* статус `Up`, отсутствие ошибок миграций SQLite, запуск HTTP-сервера на порту `5050`.

### 2.2. Проверка размера и слоёв Docker-образа
1. Выполнить замер размера собранного образа:
   ```bash
   docker images mpod --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
   ```
2. Убедиться в эффективности многоэтапной сборки (multi-stage build):
   - Стадия 1 (`frontend-builder` на `node:22-alpine`): компиляция Vite bundle в `frontend/dist`.
   - Стадия 2 (`backend-builder` на `golang:1.26.7-alpine3.24`): сборка Go бинарника `CGO_ENABLED=1 -buildmode=pie`.
   - Финальный образ (`alpine:3.24.1`): содержит только бинарник `/usr/local/bin/mpod`, статику `frontend/dist`, файлы миграций и пользователя `mpod`.
   *Критерий:* размер финального образа не превышает целевой диапазон (< 70–90 МБ).

### 2.3. Обновление с сохранением данных (Update & State Preservation)
1. Перед обновлением зафиксировать контрольные данные:
   ```bash
   docker compose exec mpod ls -la /data
   docker compose exec mpod sqlite3 /data/mpod.sqlite "SELECT count(*) FROM podcasts; SELECT count(*) FROM playback_queue;"
   ```
2. Выполнить сборку нового кандидата и перезапуск:
   ```bash
   docker compose down
   docker compose up -d --build
   ```
3. Проверить целостность базы данных и томов:
   - Файл `/data/mpod.sqlite` сохранён, размер не уменьшился.
   - Записи в таблицах БД не сброшены.
   - Скачанные файлы в `/data/downloads` сохранены.

### 2.4. Резервное копирование и восстановление (Backup & Restore)
1. **Backup SQLite базы данных онлайн:**
   ```bash
   # Выполнение горячей консистентной резервной копии через vacuum into
   docker compose exec mpod sqlite3 /data/mpod.sqlite "VACUUM INTO '/data/mpod_backup.sqlite';"
   docker compose cp mpod:/data/mpod_backup.sqlite ./backup_$(date +%Y%m%d_%H%M%S).sqlite
   docker compose exec mpod rm /data/mpod_backup.sqlite
   ```
2. **Восстановление (Restore):**
   ```bash
   docker compose stop mpod
   docker compose run --rm -v mpod_data:/data alpine cp /data/backup.sqlite /data/mpod.sqlite
   docker compose run --rm -v mpod_data:/data alpine chown mpod:mpod /data/mpod.sqlite
   docker compose start mpod
   ```

### 2.5. Проверка защиты директории аудиокниг (Read-Only Enforcement)
1. Убедиться, что том примонтирован с флагом `:ro`:
   ```bash
   docker inspect $(docker compose ps -q mpod) --format '{{json .Mounts}}' | jq '.[] | select(.Destination == "/share/audio/abooks/")'
   ```
   *Ожидается:* `"RW": false`.
2. Попытка создания или изменения файла внутри директории аудиокниг:
   ```bash
   docker compose exec mpod touch /share/audio/abooks/__test_ro_violation__.tmp
   ```
   *Ожидается:* `touch: /share/audio/abooks/__test_ro_violation__.tmp: Read-only file system`.

---

## 3. Задание тестировщику (QA Operational Verification)

### 3.1. Smoke-тестирование API и доступности
1. Проверить ответ сервера при старте:
   ```bash
   curl -i http://localhost:5050/api/settings
   ```
   - Если пользователь не зарегистрирован: перенаправление/статус сессии.
   - После логина: `HTTP 200`, JSON с полями настроек и значением `appBuild`.
2. Проверить раздачу фронтенда:
   ```bash
   curl -i http://localhost:5050/
   ```
   *Ожидается:* `HTTP 200 OK`, `Content-Type: text/html`, рендеринг SPA приложения.

### 3.2. Проверка работы с базой данных и жизненного цикла
1. Авторизоваться в приложении (`POST /api/auth/login`).
2. Добавить тестовую RSS ленту подкаста (`POST /api/podcasts`).
3. Запустить воспроизведение эпизода (`POST /api/playback/play`).
4. Выполнить Rescan аудиокниг (`POST /api/audiobooks/scan`).
5. Перезагрузить страницу браузера (`F5`) и убедиться, что позиция воспроизведения, очередь и состояние подписок полностью восстановились из базы данных.

### 3.3. Мониторинг стабильности процесса
1. Проверить отсутствие неожиданных перезапусков контейнера:
   ```bash
   docker inspect $(docker compose ps -q mpod) --format '{{.RestartCount}}'
   ```
   *Критерий:* `RestartCount = 0`.
2. Проверить журнал приложения на отсутствие паник:
   ```bash
   docker compose logs mpod | grep -Ei "panic|fatal|SIGSEGV"
   ```
   *Критерий:* 0 совпадений.

---

## 4. Контрольный лист готовности (Sign-Off Checklist)

- [x] Конфигурация Docker Compose настроена на порт `5050`
- [x] Persistent volume `mpod_data` смонтирован в `/data` (`RW: true`)
- [x] Библиотека аудиокниг смонтирована в `/share/audio/abooks/` строго с `RW: false` (`:ro`)
- [x] Приложение выполняется под непривилегированным пользователем `mpod`
- [x] Multi-stage build исключает сборочные зависимости Node.js и Go из финального образа
- [x] Процедура горячего резервного копирования SQLite (`VACUUM INTO`) верифицирована
- [x] Инструкции администратору и тестировщику зафиксированы в документации
