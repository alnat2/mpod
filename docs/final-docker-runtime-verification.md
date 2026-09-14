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
- **Библиотека аудиокниг:** директория на хосте смонтирована в `/share/audio/abooks` строго с флагом `:ro` (Read-Only).
- **Пользователь процесса:** непривилегированный пользователь `mpod` (UID/GID в Alpine).

---

## 2. Задание администратору стенда / сервера

### 2.1. Чистое развёртывание (Clean Deployment)
1. Подготовить конфигурационный файл и запустить контейнер (выбрать один из двух способов):
   - **Способ А (рекомендуемый, через `.env`):**
     ```bash
     cp .env.example .env
     # Заменить значение APP_BUILD на короткий хэш текущего Git-коммита без дублирования строк:
     sed -i.bak "s/^APP_BUILD=.*/APP_BUILD=$(git rev-parse --short HEAD)/" .env && rm -f .env.bak
     docker compose up -d --build
     ```
   - **Способ Б (через переменную окружения без модификации `.env`):**
     ```bash
     cp .env.example .env
     APP_BUILD="$(git rev-parse --short HEAD)" docker compose up -d --build
     ```
     *Примечание:* В данном варианте переменная `APP_BUILD` передаётся непосредственно процессу Compose из окружения командной строки, переопределяя значение для сборки, а статическое значение `APP_BUILD=dev` внутри `.env` не проверяется как актуальное.

   Убедиться, что в конфигурации заданы рабочие параметры:
   ```ini
   PORT=5050
   APP_ENV=production
   APP_BUILD=<git-commit-hash>
   TZ=UTC
   SESSION_SECRET=<random-strong-secret-key>
   DATA_DIR=/data
   DB_PATH=/data/mpod.sqlite
   DOWNLOADS_DIR=/data/downloads
   AUDIOBOOKS_PATH=/share/audio/abooks
   AUDIOBOOKS_DIR=/share/audio/abooks/
   DAILY_REFRESH_TIME=03:00
   ```

2. Проверить статус контейнера и логи:
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
1. Перед обновлением зафиксировать контрольные данные (используя ephemeral-контейнер с sqlite3, так как в минимальном образе mpod CLI-утилита sqlite3 отсутствует):
   ```bash
   docker compose exec mpod ls -la /data
   docker run --rm --volumes-from $(docker compose ps -q mpod) alpine sh -c \
     "apk add --no-cache sqlite >/dev/null && sqlite3 /data/mpod.sqlite 'SELECT count(*) FROM podcasts; SELECT count(*) FROM playlist;'"
   ```
2. Выполнить сборку нового кандидата и перезапуск:
   ```bash
   docker compose down
   docker compose up -d --build
   ```
3. Проверить целостность базы данных и томов:
   - Файл `/data/mpod.sqlite` сохранён, размер не уменьшился.
   - Записи в таблицах `podcasts`, `episodes`, `playlist` не сброшены.
   - Скачанные файлы в `/data/downloads` сохранены.

### 2.4. Резервное копирование и восстановление (Backup & Restore)
Поскольку финальный контейнер `mpod` построен на базе минимального Alpine без предустановленной CLI-утилиты `sqlite3`, а Compose-манифест содержит единственный сервис `mpod` (команда `docker compose run ... alpine` ошибочно воспримет `alpine` как имя сервиса), для сервисных операций с БД и файловой системой тома используется вспомогательный контейнер через `docker run --volumes-from`:

1. **Онлайн-бэкап базы данных (горячая консистентная копия через `VACUUM INTO`):**
   ```bash
   BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sqlite"
   docker run --rm --volumes-from $(docker compose ps -q mpod) -v "$(pwd)":/backup alpine sh -c \
     "apk add --no-cache sqlite >/dev/null && sqlite3 /data/mpod.sqlite \"VACUUM INTO '/backup/$BACKUP_FILE';\""
   ```
   *Альтернативный оффлайн-бэкап (при остановленном сервисе для сохранения WAL-файлов):*
   ```bash
   docker compose stop mpod
   docker run --rm --volumes-from $(docker compose ps -qa mpod) -v "$(pwd)":/backup alpine sh -c \
     "cp -a /data/mpod.sqlite* /backup/"
   docker compose start mpod
   ```

2. **Восстановление базы данных (Restore):**
   - Перед остановкой контейнера обязательно проверяем наличие файла резервной копии:
     ```bash
     RESTORE_FILE="backup_20260914_120000.sqlite"
     test -f "$RESTORE_FILE" || { echo "Файл $RESTORE_FILE не найден"; exit 1; }
     ```
   - Останавливаем сервис и удаляем старые файлы журнала предзаписи WAL/SHM, чтобы транзакции из них случайно не применились к восстанавливаемой базе:
     ```bash
     docker compose stop mpod
     docker run --rm --volumes-from $(docker compose ps -qa mpod) alpine sh -c \
       "rm -f /data/mpod.sqlite-wal /data/mpod.sqlite-shm"
     ```
   - Копируем файл бэкапа на место основной базы и выставляем права пользователя `mpod`:
     ```bash
     docker run --rm --volumes-from $(docker compose ps -qa mpod) -v "$(pwd)":/backup alpine sh -c \
       "cp \"/backup/$RESTORE_FILE\" /data/mpod.sqlite && chown 1000:1000 /data/mpod.sqlite"
     docker compose start mpod
     ```

### 2.5. Проверка защиты директории аудиокниг (Read-Only Enforcement)
1. Убедиться, что том примонтирован с флагом `:ro`:
   ```bash
   docker inspect $(docker compose ps -q mpod) --format '{{json .Mounts}}' | jq '.[] | select(.Destination == "/share/audio/abooks")'
   ```
   *Ожидается:* `"RW": false`.
2. Попытка создания или изменения файла внутри директории аудиокниг:
   ```bash
   docker compose exec mpod touch /share/audio/abooks/__test_ro_violation__.tmp
   ```
   *Ожидается:* `touch: /share/audio/abooks/__test_ro_violation__.tmp: Read-only file system`.

---

## 3. Задание тестировщику (QA Operational Verification)

Для выполнения проверок на тестирующей машине требуются утилиты `curl` и `jq`. Все запросы к API выполняются с флагом `--fail-with-body -sS` для немедленной остановки при получении ошибочного HTTP-статуса.

### 3.1. Smoke-тестирование API и доступности
1. Проверить ответ сервера при обращении к настройкам:
   - **До авторизации (неавторизованный запрос):**
     ```bash
     curl -i http://localhost:5050/api/settings
     ```
     *Фактический результат:* `HTTP/1.1 401 Unauthorized`, JSON с телом ошибки авторизации:
     ```json
     {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}
     ```
   - **После авторизации:**
     ```bash
     curl --fail-with-body -sS -i -b "$COOKIE_JAR" http://localhost:5050/api/settings
     ```
     *Фактический результат:* `HTTP/1.1 200 OK`, JSON с полями настроек и значением `appBuild`.

2. Проверить раздачу фронтенда:
   ```bash
   curl --fail-with-body -sS -i http://localhost:5050/
   ```
   *Ожидается:* `HTTP/1.1 200 OK`, `Content-Type: text/html`, рендеринг SPA приложения.

### 3.2. Проверка работы с базой данных и жизненного цикла

Для изоляции сессии и безопасной очистки создаётся временный cookie jar:
```bash
COOKIE_JAR=$(mktemp)
AUDIO_HEADERS=$(mktemp)
AUDIO_CHUNK=$(mktemp)
trap 'rm -f "$COOKIE_JAR" "$AUDIO_HEADERS" "$AUDIO_CHUNK"' EXIT
```

1. **Авторизоваться в приложении:**
   ```bash
   LOGIN_RESP=$(curl --fail-with-body -sS -c "$COOKIE_JAR" -X POST http://localhost:5050/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"<user>","password":"<pass>"}')
   echo "$LOGIN_RESP" | jq -er '.user.username' >/dev/null
   ```

2. **Задать URL рабочей RSS-ленты подкаста:**
   Использование заглушек вида `example.com` недопустимо, так как они делают сценарий неисполняемым. Переменная `TEST_RSS_URL` обязательна:
   ```bash
   : "${TEST_RSS_URL:?Set TEST_RSS_URL to a valid podcast RSS feed}"
   ```

3. **Добавить RSS-ленту подкаста и сохранить `PODCAST_ID`:**
   ```bash
   PODCAST_RESP=$(curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST http://localhost:5050/api/podcasts \
     -H "Content-Type: application/json" \
     -d "{\"rssUrl\":\"${TEST_RSS_URL}\"}")

   PODCAST_ID=$(
     printf '%s' "$PODCAST_RESP" |
       jq -er '.podcast.id'
   )
   test -n "$PODCAST_ID"
   ```

4. **Получить список эпизодов подкаста и сохранить `EPISODE_ID` первого выпуска:**
   ```bash
   EPISODES_RESP=$(curl --fail-with-body -sS -b "$COOKIE_JAR" "http://localhost:5050/api/podcasts/${PODCAST_ID}/episodes")

   EPISODE_ID=$(
     printf '%s' "$EPISODES_RESP" |
       jq -er '.episodes[0].id'
   )
   test -n "$EPISODE_ID"
   ```

5. **Добавить выпуск в плейлист:**
   ```bash
   curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST http://localhost:5050/api/playlist \
     -H "Content-Type: application/json" \
     -d "{\"episodeId\": ${EPISODE_ID}}"
   ```

6. **Назначить выпуск активным для воспроизведения:**
   ```bash
   curl --fail-with-body -sS -b "$COOKIE_JAR" -X PUT http://localhost:5050/api/playback/active \
     -H "Content-Type: application/json" \
     -d "{\"episodeId\": ${EPISODE_ID}}"
   ```

7. **Зафиксировать прогресс воспроизведения:**
   ```bash
   curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST http://localhost:5050/api/playback \
     -H "Content-Type: application/json" \
     -d "{\"episodeId\": ${EPISODE_ID}, \"positionSeconds\": 15}"
   ```

8. **Проверка отдачи медиапотока (Range GET):**
   Запрос выполняется методом `GET` с заголовком `Range: bytes=0-1023`. Ответные заголовки и бинарное тело разделяются, чтобы не выводить бинарный поток в терминал:
   ```bash
   curl --fail-with-body -sS -b "$COOKIE_JAR" \
     -H "Range: bytes=0-1023" \
     -D "$AUDIO_HEADERS" \
     -o "$AUDIO_CHUNK" \
     "http://localhost:5050/api/episodes/${EPISODE_ID}/audio"

   HTTP_STATUS=$(head -n 1 "$AUDIO_HEADERS" | awk '{print $2}')
   CONTENT_TYPE=$(grep -i '^content-type:' "$AUDIO_HEADERS" | tr -d '\r' | awk '{print $2}')
   BYTES_RECEIVED=$(wc -c < "$AUDIO_CHUNK" | tr -d ' ')

   echo "HTTP Status: $HTTP_STATUS"
   echo "Content-Type: $CONTENT_TYPE"
   echo "Bytes received: $BYTES_RECEIVED"
   ```
   *Критерии валидации аудио:*
   - **`HTTP 206 Partial Content`**: Локально скачанный файл либо upstream CDN поддерживает Range-запросы (в тело получены первые 1024 байта).
   - **`HTTP 200 OK`**: Внешний CDN проигнорировал Range-заголовок и отдал аудиопоток с начала (тело успешно получено).
   - **`Content-Type`**: Строго аудиоформат (начинается с `audio/`, например `audio/mpeg`, `audio/mp4`, `audio/aac`).
   - **`401 Unauthorized`**, **`404 Not Found`**, **`500 Internal Server Error`**, **`502 Bad Gateway`**: Являются безусловным **FAIL**.
   - `BYTES_RECEIVED` строго больше 0 (`test "$BYTES_RECEIVED" -gt 0`).

9. **Выполнить Rescan аудиокниг:**
   ```bash
   curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST http://localhost:5050/api/audiobooks/rescan
   ```

10. **Перезагрузить страницу браузера (`F5`)** и убедиться, что позиция воспроизведения, активный трек, очередь и состояние подписок полностью восстановились из базы данных.

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
- [x] Библиотека аудиокниг смонтирована в `/share/audio/abooks` строго с `RW: false` (`:ro`)
- [x] Приложение выполняется под непривилегированным пользователем `mpod`
- [x] Multi-stage build исключает сборочные зависимости Node.js и Go из финального образа
- [ ] Резервное копирование SQLite (`VACUUM INTO`) и восстановление (процедура подготовлена для стендовой проверки)
- [x] Инструкции администратору и тестировщику зафиксированы в документации
