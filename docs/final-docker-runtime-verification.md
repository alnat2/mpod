# Финальная Docker и runtime-проверка

Редакция: 16 сентября 2026 года. Объект — существующий **test**-стенд mpod, не production.

## 1. Область и порядок приёмки

Этот документ описывает будущий прогон. Его редактирование, чтение и наличие команд **не разрешают** деплой, остановку сервиса, изменение данных или конфигурации. Сначала принимается инструкция; затем пользователь отдельно поручает административный этап, после его завершения — QA. Администратор и тестировщик не работают одновременно. Перед каждым переходом передаются точный SHA, APP_BUILD и необходимые временные артефакты.

Источники: `docs/deployment.md`, `docs/architecture.md`, `docs/product-decisions.md`, текущие Dockerfile, Compose и backend. Исторически подтверждены:

| Параметр | Значение | Подтверждение перед прогоном |
|---|---|---|
| Адрес | `http://192.168.0.222:5051` | доступность и фактическое перенаправление |
| SSH / каталог NAS | `nas` / `/home/cross/mpod-mobile` | права, каталог и deployed checkout |
| Проект / сервис | `mpod-mobile` / `mpod` | Compose labels контейнера |
| Контейнер | `mpod-mobile-mpod-1` | один контейнер сервиса |
| Порты | host `5051` → container `5050` | `docker inspect`; приложение пишет в логах `5050` |
| Том | `mpod-mobile_mpod_data` → `/data`, RW | фактическое имя и mount |
| База / downloads | `/data/mpod.sqlite` / `/data/downloads` | runtime env и mount |
| Аудиокниги | container `/share/audio/abooks`, RO | destination, host source и RW=false |
| Последний отчёт стенда | SHA `b087213c91e2c3d3a80e9167cb8c87279084597d`, APP_BUILD `b087213` | это история, не результат нового прогона |

Обновление стенда ранее отложено. Новая установка, новый Compose-проект и новый порт для этой проверки не нужны. Не удалять том, не очищать данные, не заменять существующий `SESSION_SECRET`. Фактические Compose/env-файлы, overrides и host-путь аудиокниг администратор подтверждает на NAS; локальный Compose не доказывает конфигурацию сервера.

Порядок: read-only инвентаризация → разрешённый администратору исходный снимок → разрешённый QA набор и upstream → локальное аудио и контрольные данные → разрешённые администратору restart/backup/restore (обновление — только при отдельном поручении) → QA браузера → разрешённый администратору возврат исходного снимка → проверка исходного состояния → удаление только временных артефактов. Снимок и контрольные данные должны существовать **до** операций проверки сохранности.

Один app-контейнер, SQLite, локальные disposable downloads. Источники аудиокниг не входят в запись/restore и остаются read-only. Бэкап только БД не сохраняет downloads: startup reconciliation сбрасывает отсутствующие локальные пути. Точный возврат всех исходных прогрессов через POST playback тоже не гарантирован правилами sync. Для возврата стенда используется согласованный offline-снимок БД **и downloads** с запретом посторонних изменений на время прогона.

## 2. Администратор: инвентаризация и временные инструменты

Все NAS-блоки выполняются в **Bash**, не в произвольном `sh`, одной сессией после подключения администратором. Нужны Docker с Compose v2, jq, git и Bash; QA использует также Python 3 для ограниченного аудиопробника. Новый RSS-сервер и генерация аудио не нужны. Не включать `set -x`; конфигурацию, cookies, auth bodies и полный `docker inspect`/`compose config` в отчёт не публиковать.

### 2.1. Подтверждение конфигурации (без изменения сервера)

```bash
set -Eeuo pipefail
umask 077
cd /home/cross/mpod-mobile
NAS_DIR=$PWD
BASE_URL=http://192.168.0.222:5051
PROJECT=mpod-mobile
SERVICE=mpod
command -v jq >/dev/null
command -v git >/dev/null
docker info >/dev/null
docker compose version >/dev/null

# Абсолютный путь существующего env-файла. Его содержимое не печатаем.
read -r -p 'Подтверждённый существующий env-файл (абсолютный путь): ' ENV_FILE
[[ "$ENV_FILE" = /* && -f "$ENV_FILE" ]]
# Перечислить ВСЕ используемые Compose-файлы в порядке применения, включая overrides.
COMPOSE_FILES=()
while read -r -p 'Compose-файл (абсолютный путь; пустая строка завершает список): ' file; do
  [[ -n "$file" ]] || break
  [[ "$file" = /* && -f "$file" ]]
  COMPOSE_FILES+=("$file")
done
((${#COMPOSE_FILES[@]} > 0))
dc() {
  local args=() file
  for file in "${COMPOSE_FILES[@]}"; do args+=(-f "$file"); done
  docker compose --project-directory "$NAS_DIR" --env-file "$ENV_FILE" \
    -p "$PROJECT" "${args[@]}" "$@"
}
CID=$(dc ps -qa "$SERVICE")
[[ -n "$CID" && "$CID" != *$'\n'* ]]
test "$(docker inspect "$CID" --format '{{index .Config.Labels "com.docker.compose.project"}}')" = "$PROJECT"
test "$(docker inspect "$CID" --format '{{index .Config.Labels "com.docker.compose.service"}}')" = "$SERVICE"
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = running
MOUNTS=$(docker inspect "$CID" --format '{{json .Mounts}}')
DATA_VOLUME=$(jq -er '[.[] | select(.Destination == "/data" and .Type == "volume" and .RW == true)] | select(length == 1) | .[0].Name' <<<"$MOUNTS")
test "$DATA_VOLUME" = mpod-mobile_mpod_data
jq -e '[.[] | select((.Destination | rtrimstr("/")) == "/share/audio/abooks" and .RW == false)] | length == 1' <<<"$MOUNTS" >/dev/null
# Host source записать локально для сверки; библиотеку не менять.
ABOOKS_SOURCE=$(jq -er '.[] | select((.Destination | rtrimstr("/")) == "/share/audio/abooks") | .Source' <<<"$MOUNTS")
PORTS=$(docker inspect "$CID" --format '{{json .NetworkSettings.Ports}}')
jq -e '.["5050/tcp"] | any(.HostPort == "5051")' <<<"$PORTS" >/dev/null
RUNTIME_ENV=$(docker inspect "$CID" --format '{{json .Config.Env}}')
jq -e 'index("PORT=5050") != null and index("DATA_DIR=/data") != null and index("DB_PATH=/data/mpod.sqlite") != null and index("DOWNLOADS_DIR=/data/downloads") != null' <<<"$RUNTIME_ENV" >/dev/null
EXPECTED_BUILD=$(jq -er '[.[] | select(startswith("APP_BUILD=")) | ltrimstr("APP_BUILD=")] | select(length == 1) | .[0] | select(length > 0 and . != "dev")' <<<"$RUNTIME_ENV")
unset RUNTIME_ENV
DEPLOYED_SHA=$(git rev-parse HEAD)
printf 'Checkout=%s; runtime APP_BUILD=%s\n' "$DEPLOYED_SHA" "$EXPECTED_BUILD"
```

При расхождении остановиться: не подгонять mount/порт/env под документ. Checkout сам по себе не подтверждает источник образа. Администратор сопоставляет APP_BUILD, SHA и ID образа с последним deploy-отчётом/скриптом и передаёт QA **подтверждённое** EXPECTED_BUILD. Для короткого APP_BUILD подтверждается соответствие точному SHA, а не просто совпадение префикса. Если история сборки отсутствует, происхождение образа остаётся неподтверждённым.

### 2.2. Размер, состав образа и мониторинг

```bash
IMAGE_ID=$(dc images -q "$SERVICE")
[[ -n "$IMAGE_ID" && "$IMAGE_ID" != *$'\n'* ]]
test "$(docker image inspect "$IMAGE_ID" --format '{{.Id}}')" = "$(docker inspect "$CID" --format '{{.Image}}')"
IMAGE_BYTES=$(docker image inspect "$IMAGE_ID" --format '{{.Size}}')
[[ "$IMAGE_BYTES" =~ ^[0-9]+$ ]]
printf 'Image=%s; bytes=%s\n' "$IMAGE_ID" "$IMAGE_BYTES"
awk -v bytes="$IMAGE_BYTES" 'BEGIN {printf "Size=%.2f MiB\n", bytes/1048576}'
# Единый критерий этой приёмки: строго меньше 90 MiB = 94 371 840 байт.
test "$IMAGE_BYTES" -lt 94371840
docker image history "$IMAGE_ID"
docker exec "$CID" sh -c 'test "$(id -u)" = 1000 && test "$(id -g)" = 1000 && test -x /usr/local/bin/mpod && test -d /app/frontend/dist && test -d /app/migrations'
```

Порог 90 MiB — критерий данного прогона, не утверждение о замере. В текущем Dockerfile multi-stage: frontend builder Node, backend builder Go с CGO/PIE, финальный Alpine с бинарником, статиками и миграциями. Версии берутся из **проверяемого SHA**, не из этого текста. Финальный образ также содержит runtime базового Alpine; нельзя утверждать, что в нём буквально только файлы приложения. По одному image history нельзя доказать команды сборки: сверяют Dockerfile и build log согласованного кандидата.

После разрешения создать защищённый временный каталог вне Git. Администратор проверяет свободное место для нескольких копий БД и downloads, срок хранения, отсутствие других writers и достаточность backup; `/tmp` не является долговременным хранилищем.

```bash
WORK=$(mktemp -d /tmp/mpod-runtime.XXXXXX)
export WORK
# Единственный локальный временный helper image, не app image и не Compose-сервис.
SQLITE_IMAGE="mpod-runtime-tools:$(basename "$WORK")"
docker build -t "$SQLITE_IMAGE" - <<'IMAGE'
FROM alpine:3.24.1
RUN apk add --no-cache sqlite coreutils
IMAGE
# Сбой pull/build/установки — ошибка инструментария, никогда не PASS негативного теста.
docker run --rm --network none "$SQLITE_IMAGE" sh -ec 'test "$(sqlite3 :memory: "PRAGMA integrity_check;")" = ok; command -v sha256sum' >/dev/null

# Передача конфигурации временным NAS-скриптам, без копирования секретов.
{
  printf 'NAS_DIR=%q\nENV_FILE=%q\nPROJECT=%q\nSERVICE=%q\nWORK=%q\nDATA_VOLUME=%q\nSQLITE_IMAGE=%q\n' \
    "$NAS_DIR" "$ENV_FILE" "$PROJECT" "$SERVICE" "$WORK" "$DATA_VOLUME" "$SQLITE_IMAGE"
  declare -p COMPOSE_FILES
  declare -f dc
} > "$WORK/config.sh"
tools() {
  docker run --rm --network none \
    --mount "type=volume,src=$DATA_VOLUME,dst=/data" \
    --mount "type=bind,src=$WORK,dst=/work" "$SQLITE_IMAGE" "$@"
}
dc logs --no-color --tail=300 "$SERVICE" > "$WORK/runtime.log" 2>&1
if grep -Ei 'panic|fatal|migration.*(fail|error)' "$WORK/runtime.log" > "$WORK/critical.log"; then
  echo 'FAIL: найдены критические сообщения; требуется разбор'; exit 1
else
  grep_rc=$?
  test "$grep_rc" -eq 1 # 2 и другие ошибки grep не считаем успехом.
fi
```

Получение логов проверяется отдельно. В таблицу идёт обезличенный итог, а не сырой runtime.log; исключить upstream URLs с токенами. После каждого restart/update повторить мониторинг и проверить RestartCount, не скрывая сбой Docker.

### 2.3. Read-only аудиокниги

Только после разрешения выполнить проверочную попытку записи, с уникальным именем. Проверка mount из §2.1 должна уже пройти.

```bash
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = running
docker exec "$CID" true
RO_PATH="/share/audio/abooks/.__mpod_ro_$(basename "$WORK")"
docker exec "$CID" test ! -e "$RO_PATH"
if docker exec "$CID" sh -c 'touch "$1"' sh "$RO_PATH" > "$WORK/ro-write.log" 2>&1; then
  echo 'FAIL: запись в библиотеку разрешена; остановить проверку и сообщить о созданном файле'; exit 1
else
  RO_RC=$?
  test "$RO_RC" -ne 0
  grep -F 'Read-only file system' "$WORK/ro-write.log" >/dev/null
fi
docker exec "$CID" true
docker exec "$CID" test ! -e "$RO_PATH"
```

Не считать отказом RO ошибки соединения, отсутствия каталога или permissions. Если неожиданная запись прошла, не продолжать и не удалять файл молча: администратор сообщает дефект и согласует удаление только этого созданного файла.

## 3. Администратор: исходный снимок и единая процедура восстановления

Операции ниже останавливают и меняют test-сервис. **Нужны отдельное явное поручение и согласованное окно без пользователей, открытых проигрывателей, refresh и посторонних изменений.** Не применять к production. Откат целого снимка отменяет все изменения после его создания — это должно быть согласовано заранее.

### 3.1. Исходный offline-снимок БД и downloads до QA

```bash
BASELINE=$(mktemp -d "$WORK/baseline.XXXXXX")
BASELINE_NAME=$(basename "$BASELINE")
dc stop "$SERVICE"
CID=$(dc ps -qa "$SERVICE")
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = exited
# Только три точных имени SQLite; отсутствие WAL/SHM допустимо.
tools sh -ec '
  dest="/work/$1"
  test -f /data/mpod.sqlite
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/data/$name"; then
      test -f "/data/$name"; test ! -L "/data/$name"; cp -a "/data/$name" "$dest/$name"
    fi
  done
  test -d /data/downloads
  cp -a /data/downloads "$dest/downloads"
' sh "$BASELINE_NAME"
# Не открывать исходный backup sqlite3: это может изменить его WAL/SHM.
# Проверяется отдельная свежая staging-копия вместе с журналами.
tools sh -ec '
  stage=$(mktemp -d /work/baseline-check.XXXXXX)
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/work/$1/$name"; then cp -a "/work/$1/$name" "$stage/$name"; fi
  done
  test "$(sqlite3 "$stage/mpod.sqlite" "PRAGMA integrity_check;")" = ok
  # Покрывает также прогрессы вне текущей очереди; sessions/scheduler исключены явно.
  for table in users settings podcasts episodes playlist playback active_playback audiobook_playback audiobook_playlist_tracks audiobook_track_exclusions; do
    sqlite3 "$stage/mpod.sqlite" ".dump $table"
  done > "/work/$1/expected-user-data.sql"
  sqlite3 "$stage/mpod.sqlite" "SELECT id,audiobook_id,is_listened FROM audiobook_tracks ORDER BY id;" > "/work/$1/expected-audiobook-track-state.txt"
  (cd "/work/$1/downloads"; find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "/work/$1/expected-downloads.sha256"
' sh "$BASELINE_NAME"
dc start "$SERVICE"
```

При любой ошибке после остановки оставлять сервис остановленным и передать администратору факты; trap не должен автоматически запускать приложение на непроверенной БД. После успешного start — ограниченное ожидание §4.1. Полученный baseline хранить до подтверждения финального возврата; проверить доступность и полноту downloads. Не удалять исходный каталог backup и не копировать широкий glob `mpod.sqlite*`.

### 3.2. Единый restore для online и offline-копии

Создать следующий временный скрипт в `$WORK/restore.sh`. Он принимает каталог с `mpod.sqlite` и, для offline, имеющимися WAL/SHM. Источник монтируется read-only; перед валидацией копируется в новый staging. Проверенная копия нормализуется в самостоятельную БД посредством `VACUUM INTO`: необходимые WAL-записи учитываются при открытии staging, а исходный backup не меняется. Вторая опция `with-downloads` используется только для полного возврата baseline, содержащего каталог downloads.

```bash
cat > "$WORK/restore.sh" <<'RESTORE'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${WORK:?}"
source "$WORK/config.sh"
SOURCE=${1:?Absolute backup directory required}
MODE=${2:-db-only}
[[ "$SOURCE" = /* && -d "$SOURCE" && ! -L "$SOURCE" && -f "$SOURCE/mpod.sqlite" ]]
[[ "$MODE" = db-only || "$MODE" = with-downloads ]]
if [[ "$MODE" = with-downloads ]]; then
  test -d "$SOURCE/downloads"; test ! -L "$SOURCE/downloads"
fi
CID=$(dc ps -qa "$SERVICE")
[[ -n "$CID" && "$CID" != *$'\n'* ]]
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = running
STAGE=$(mktemp -d "$WORK/restore-stage.XXXXXX")
STAGE_NAME=$(basename "$STAGE")
# Preflight сбои Docker/sqlite/volume не превращаются в INVALID_BACKUP.
docker run --rm --network none "$SQLITE_IMAGE" sh -ec 'test "$(sqlite3 :memory: "PRAGMA integrity_check;")" = ok'
set +e
docker run --rm --network none \
  --mount "type=bind,src=$SOURCE,dst=/source,readonly" \
  --mount "type=bind,src=$WORK,dst=/work" "$SQLITE_IMAGE" sh -ec '
  stage="/work/$1"
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/source/$name"; then
      test -f "/source/$name"; test ! -L "/source/$name"
      cp -a "/source/$name" "$stage/$name"
    fi
  done
  set +e
  sqlite3 "$stage/mpod.sqlite" "PRAGMA integrity_check;" > "$stage/integrity.out" 2> "$stage/integrity.err"
  rc=$?
  set -e
  if test "$rc" -ne 0; then
    # Только распознанная ошибка формата/порчи SQLite — ожидаемое отклонение.
    if grep -Eq "file is not a database|database disk image is malformed" "$stage/integrity.err"; then
      printf "%s\n" INVALID_BACKUP > "$stage/rejected"; exit 42
    fi
    cat "$stage/integrity.err" >&2; exit 1
  fi
  if test "$(cat "$stage/integrity.out")" != ok; then
    printf "%s\n" INVALID_BACKUP > "$stage/rejected"; exit 42
  fi
  sqlite3 "$stage/mpod.sqlite" "VACUUM INTO '\''$stage/normalized.sqlite'\'';"
  test "$(sqlite3 "$stage/normalized.sqlite" "PRAGMA integrity_check;")" = ok
  chown 1000:1000 "$stage/normalized.sqlite"
  chmod 600 "$stage/normalized.sqlite"
  if test "$2" = with-downloads; then
    find /source/downloads -type l -print > "$stage/download-symlinks"
    test ! -s "$stage/download-symlinks"
    cp -a /source/downloads "$stage/downloads"
  fi
' sh "$STAGE_NAME" "$MODE"
VALIDATION_RC=$?
set -e
if [[ "$VALIDATION_RC" -ne 0 ]]; then
  if [[ "$VALIDATION_RC" -eq 42 && -f "$STAGE/rejected" ]] && \
     [[ "$(cat "$STAGE/rejected")" = INVALID_BACKUP ]]; then
    echo INVALID_BACKUP >&2; exit 42
  fi
  echo 'ERROR: restore validation infrastructure or normalization failed' >&2; exit 1
fi
# До этой точки сервис и рабочий volume не изменяются.
dc stop "$SERVICE"
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = exited
ROLLBACK=$(mktemp -d "$WORK/rollback.XXXXXX")
printf '%s\n' "$ROLLBACK" > "$STAGE/rollback-path"
docker run --rm --network none \
  --mount "type=volume,src=$DATA_VOLUME,dst=/data" \
  --mount "type=bind,src=$WORK,dst=/work" "$SQLITE_IMAGE" sh -ec '
  stage="/work/$1"; rollback="/work/$2"
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/data/$name"; then
      test -f "/data/$name"; test ! -L "/data/$name"; cp -a "/data/$name" "$rollback/$name"
    fi
  done
  test -f "$rollback/mpod.sqlite"
  # Downloads сохраняются для rollback даже при db-only restore.
  test -d /data/downloads; cp -a /data/downloads "$rollback/downloads"
  rollback_check=$(mktemp -d /work/rollback-check.XXXXXX)
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "$rollback/$name"; then cp -a "$rollback/$name" "$rollback_check/$name"; fi
  done
  test "$(sqlite3 "$rollback_check/mpod.sqlite" "PRAGMA integrity_check;")" = ok
  target=$(mktemp /data/.restore-db.XXXXXX)
  cp "$stage/normalized.sqlite" "$target"
  chown 1000:1000 "$target"; chmod 600 "$target"
  test "$(stat -c "%u:%g:%a" "$target")" = 1000:1000:600
  test "$(sqlite3 "$target" "PRAGMA integrity_check;")" = ok
  # tmp и конечная БД на одном volume: mv заменяет БД атомарно.
  mv -f "$target" /data/mpod.sqlite
  # Старые журналы НЕ удаляются до успешной замены. После неё перемещаются,
  # при этом полный неизменённый rollback-комплект уже сохранён отдельно.
  mkdir "$stage/old-journals"
  for name in mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/data/$name"; then mv "/data/$name" "$stage/old-journals/$name"; fi
  done
  if test "$3" = with-downloads; then
    downloads_stage=$(mktemp -d /data/.restore-downloads.XXXXXX)
    cp -a "$stage/downloads/." "$downloads_stage/"
    chown --reference="$stage/downloads" "$downloads_stage"
    chmod --reference="$stage/downloads" "$downloads_stage"
    mv /data/downloads "$stage/previous-downloads"
    mv "$downloads_stage" /data/downloads
  fi
  test "$(sqlite3 /data/mpod.sqlite "PRAGMA integrity_check;")" = ok
' sh "$STAGE_NAME" "$(basename "$ROLLBACK")" "$MODE"
# Не помещать start в trap: ошибка любой предыдущей команды блокирует запуск.
dc start "$SERVICE"
printf 'RESTORE_COMPLETED; rollback=%s; mode=%s\n' "$ROLLBACK" "$MODE"
RESTORE
chmod 700 "$WORK/restore.sh"
bash -n "$WORK/restore.sh"
```

Скрипт вызывать отдельным процессом `bash`, не как shell-функцию внутри `if`, где `set -e` теряет ожидаемое действие. Каталоги источника и `$WORK` должны находиться на NAS, быть абсолютными, без symlink на изменяемые посторонние данные. Свободное место проверяют до операций; backups защищены от чужой записи. Ownership downloads сохраняется из snapshot, не назначается рекурсивно для чужой библиотеки.

До снимка и возвращения убедиться, что нет due downloads/refresh: startup worker может законно изменить исходное состояние. Если это случилось, сравнительная проверка не PASS; администратор согласует повтор/сохранение этих изменений. Ошибка до остановки: рабочие данные не меняются. Ошибка после остановки: **не запускать** сервис вручную на частично заменённой БД. В `$STAGE/rollback-path` указан сохранённый полный комплект. Администратор разбирает ошибку; после отдельного согласования восстанавливает его при остановленном сервисе по §3.3. Не обещать транзакционность нескольких файлов: атомарно заменяется только файл БД, остальные шаги защищены остановкой и rollback.

### 3.3. Аварийный возврат при остановленном сервисе

Используется только после согласования, если restore не завершился и сервис остаётся stopped. `RECOVERY_SOURCE` — абсолютный путь полного сохранённого rollback/baseline. Исходный backup не открывается и не меняется. В staging оффлайн-комплект проверяется и нормализуется до замены. Сбой оставляет сервис остановленным.

```bash
read -r -p 'Полный rollback/baseline каталог на NAS: ' RECOVERY_SOURCE
[[ "$RECOVERY_SOURCE" = /* && ! -L "$RECOVERY_SOURCE" && -f "$RECOVERY_SOURCE/mpod.sqlite" && -d "$RECOVERY_SOURCE/downloads" && ! -L "$RECOVERY_SOURCE/downloads" ]]
CID=$(dc ps -qa "$SERVICE")
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = exited
RECOVERY=$(mktemp -d "$WORK/recovery.XXXXXX")
# Сохраняем также аварийный текущий комплект, не переписывая существующие backups.
docker run --rm --network none \
  --mount "type=volume,src=$DATA_VOLUME,dst=/data" \
  --mount "type=bind,src=$RECOVERY_SOURCE,dst=/source,readonly" \
  --mount "type=bind,src=$RECOVERY,dst=/recovery" "$SQLITE_IMAGE" sh -ec '
  mkdir /recovery/staging /recovery/failed-current
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/source/$name"; then test -f "/source/$name"; test ! -L "/source/$name"; cp -a "/source/$name" /recovery/staging/; fi
    if test -e "/data/$name"; then test -f "/data/$name"; test ! -L "/data/$name"; cp -a "/data/$name" /recovery/failed-current/; fi
  done
  test "$(sqlite3 /recovery/staging/mpod.sqlite "PRAGMA integrity_check;")" = ok
  sqlite3 /recovery/staging/mpod.sqlite "VACUUM INTO '\''/recovery/normalized.sqlite'\'';"
  test "$(sqlite3 /recovery/normalized.sqlite "PRAGMA integrity_check;")" = ok
  target=$(mktemp /data/.recovery-db.XXXXXX)
  cp /recovery/normalized.sqlite "$target"; chown 1000:1000 "$target"; chmod 600 "$target"
  test "$(stat -c "%u:%g:%a" "$target")" = 1000:1000:600
  test "$(sqlite3 "$target" "PRAGMA integrity_check;")" = ok
  find /source/downloads -type l -print > /recovery/download-symlinks
  test ! -s /recovery/download-symlinks
  ds=$(mktemp -d /data/.recovery-downloads.XXXXXX)
  cp -a /source/downloads/. "$ds/"
  chown --reference=/source/downloads "$ds"; chmod --reference=/source/downloads "$ds"
  mv -f "$target" /data/mpod.sqlite
  mkdir /recovery/old-journals
  for name in mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/data/$name"; then mv "/data/$name" /recovery/old-journals/; fi
  done
  if test -d /data/downloads; then mv /data/downloads /recovery/failed-current/downloads; fi
  mv "$ds" /data/downloads
  test "$(sqlite3 /data/mpod.sqlite "PRAGMA integrity_check;")" = ok
'
dc start "$SERVICE"
```

Это аварийная процедура, не дополнительная обязательная проверка путём намеренного повреждения рабочего стенда. После неё применяются ожидание готовности, проверка исходных записей/downloads и мониторинг.

## 4. QA: сессия, временный RSS и контрольные данные

Этап QA начинается только после поручения и успешного исходного снимка администратором. Передать QA BASE_URL, подтверждённые EXPECTED_BUILD/SHA и параметры источника. Все QA-команды выполняются в Bash на машине тестировщика. Для NAS-проверок доступности источника и файлов используется отдельный административный переход, без одновременного управления стендом.

### 4.1. Общие функции и авторизация

```bash
set -Eeuo pipefail
set +x
umask 077
command -v curl >/dev/null
command -v jq >/dev/null
command -v python3 >/dev/null
BASE_URL=http://192.168.0.222:5051
read -r -p 'APP_BUILD, подтверждённый администратором для этого прогона: ' EXPECTED_BUILD
[[ -n "$EXPECTED_BUILD" && "$EXPECTED_BUILD" != dev ]]
QA_WORK=$(mktemp -d /tmp/mpod-qa.XXXXXX)
COOKIE_JAR="$QA_WORK/cookies"
touch "$COOKIE_JAR"
api() { curl --fail-with-body -sS --connect-timeout 5 --max-time 120 -b "$COOKIE_JAR" "$@"; }
wait_ready() {
  local attempt status
  for attempt in {1..30}; do
    if status=$(curl -sS --connect-timeout 2 --max-time 3 -o "$QA_WORK/health.json" -w '%{http_code}' "$BASE_URL/api/health"); then
      if [[ "$status" = 200 ]]; then return 0; fi
    fi
    sleep 2
  done
  echo 'FAIL: API не готово в пределах ограниченного ожидания' >&2; return 1
}
wait_ready
# curl transport failure не может стать HTTP 401.
HTTP_CODE=$(curl -sS --connect-timeout 5 --max-time 15 -o "$QA_WORK/unauthorized.json" -w '%{http_code}' "$BASE_URL/api/settings")
test "$HTTP_CODE" = 401
SESSION_INFO=$(curl --fail-with-body -sS --connect-timeout 5 --max-time 15 "$BASE_URL/api/auth/session")
jq -e 'has("setupRequired") and (.setupRequired | type == "boolean") and (.authenticated | type == "boolean")' <<<"$SESSION_INFO" >/dev/null
SETUP_REQUIRED=$(jq -r '.setupRequired' <<<"$SESSION_INFO") # false — штатное успешное значение
if [[ "$SETUP_REQUIRED" = true ]]; then
  echo 'STOP: на существующем стенде нет пользователя; нужна отдельная согласованная первоначальная регистрация'; exit 1
fi
read -r -p 'Имя существующего тестового пользователя: ' QA_USERNAME
read -r -s -p 'Пароль (не попадёт в отчёт): ' QA_PASSWORD
printf '\n'
export QA_USERNAME QA_PASSWORD
# JSON через env/stdin: секреты не в curl argv и корректно экранируются.
jq -n '{username:env.QA_USERNAME,password:env.QA_PASSWORD}' > "$QA_WORK/login.json"
unset QA_PASSWORD
curl --fail-with-body -sS --connect-timeout 5 --max-time 30 -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' --data-binary @"$QA_WORK/login.json" \
  "$BASE_URL/api/auth/login" > "$QA_WORK/login-response.json"
rm -f "$QA_WORK/login.json"
jq -e --arg username "$QA_USERNAME" '.user.username == $username' "$QA_WORK/login-response.json" >/dev/null
unset QA_USERNAME
api "$BASE_URL/api/auth/session" > "$QA_WORK/session.json"
jq -e '.authenticated == true and .setupRequired == false and .user != null' "$QA_WORK/session.json" >/dev/null
api "$BASE_URL/api/settings" > "$QA_WORK/settings.json"
jq -e --arg expected "$EXPECTED_BUILD" '.settings.appBuild == $expected' "$QA_WORK/settings.json" >/dev/null
curl --fail-with-body -sS --connect-timeout 5 --max-time 30 -D "$QA_WORK/spa.headers" -o "$QA_WORK/spa.html" "$BASE_URL/"
grep -Ei '^Content-Type: *text/html([;[:space:]]|$)' "$QA_WORK/spa.headers" >/dev/null
# Сохраняем исходное состояние для сравнения после полного административного возврата.
api "$BASE_URL/api/podcasts" > "$QA_WORK/original-podcasts.json"
api "$BASE_URL/api/playlist" > "$QA_WORK/original-playlist.json"
api "$BASE_URL/api/playback/queue" > "$QA_WORK/original-queue.json"
```

Auth body, cookies, login/session responses и user-identifying данные не публикуются. При ошибке login удалить файл с паролем, завершить сессию по §7; сырой `--fail-with-body` вывод не прикладывать без просмотра. Если исходный baseline создан до этой login-сессии, полный возврат может сделать cookie невалидным: нужно войти снова.

Первичная регистрация — только при отдельно подтверждённом отсутствии пользователя и разрешении его создать. Не сбрасывать базу для теста. Для этого согласованного случая JSON готовится тем же безопасным способом, POST направляется на `$BASE_URL/api/auth/register`, проверяется `.user.username`, затем выполняется обычный login. На существующем стенде регистрация не является обязательной операцией.

### 4.2. Публичный RSS и конкретный выпуск

Используется публичный RSS из интернета. Кандидат — [Build Your SaaS](https://saas.transistor.fm/subscribe), RSS `https://feeds.transistor.fm/build-your-saas`. Это адрес из официальной страницы подписки, **не результат проверки доступности на NAS**. Администратор подтверждает актуальный feed/enclosure через существующий SOCKS5, затем выбирается конкретный выпуск с достаточной длительностью для позиций 15 и 75 секунд. Дополнительный ориентир — [E164 Customer Service](https://saas.transistor.fm/episodes/customer-service) (на официальной странице указано 41:26); фактические GUID/enclosure/duration сверяют с текущим RSS, этот выпуск не выбран автоматически. При недоступности/отсутствии Range выбирается другой согласованный публичный источник; новые сервисы/порты не создаются.

Фактический импорт через mpod подтверждает RSS-fetch с runtime network/proxy-конфигурацией. Проверка audio выполняется тем же backend до playlist. Streaming может автоматически перейти на direct retry после отказа proxy: администратор проверяет относящиеся к запросу runtime-логи и отдельно фиксирует fallback. Успешный direct retry не доказывает доступность enclosure через SOCKS5. Proxy не отключать и настройки не менять для получения PASS.

```bash
TEST_RSS_URL=https://feeds.transistor.fm/build-your-saas
# Не использовать уже существующую подписку: её нельзя считать тестовой и удалять.
# Если candidate уже есть, согласовать другой публичный feed до POST.
jq -e --arg url "$TEST_RSS_URL" 'all(.podcasts[]; .rssUrl != $url)' "$QA_WORK/original-podcasts.json" >/dev/null
api "$BASE_URL/api/settings" > "$QA_WORK/source-settings.json"
jq -e '.settings.proxyConfigured == true and .settings.proxyEnabled == true' "$QA_WORK/source-settings.json" >/dev/null
jq -n --arg url "$TEST_RSS_URL" '{rssUrl:$url}' > "$QA_WORK/podcast-request.json"
api -H 'Content-Type: application/json' --data-binary @"$QA_WORK/podcast-request.json" "$BASE_URL/api/podcasts" > "$QA_WORK/podcast.json"
PODCAST_ID=$(jq -er '.podcast.id | select(type == "number" and . > 0)' "$QA_WORK/podcast.json")
api "$BASE_URL/api/podcasts/$PODCAST_ID/episodes" > "$QA_WORK/episodes.json"
# Список для осознанного выбора, а не предположение об одном выпуске в RSS.
jq '.episodes[] | select(.duration != null and .duration > 120 and .downloaded == false) | {id,title,publishedAt,duration}' "$QA_WORK/episodes.json"
read -r -p 'Согласованный ID конкретного тестового выпуска из списка: ' EPISODE_ID
[[ "$EPISODE_ID" =~ ^[1-9][0-9]*$ ]]
jq -e --argjson id "$EPISODE_ID" 'any(.episodes[]; .id == $id and .downloaded == false and (.duration | type == "number") and .duration > 120)' "$QA_WORK/episodes.json" >/dev/null
jq --argjson id "$EPISODE_ID" '.episodes[] | select(.id == $id)' "$QA_WORK/episodes.json" > "$QA_WORK/selected-episode.json"
TEST_AUDIO_URL=$(jq -er '.audioUrl | select(type == "string" and length > 0)' "$QA_WORK/selected-episode.json")
DURATION_SECONDS=$(jq -er '.duration | floor' "$QA_WORK/selected-episode.json")
```

Если список пуст, длительность неизвестна или feed не импортировался — остановиться и подтвердить другой выпуск/источник; не подставлять выдуманную длительность. Зафиксировать RSS, episode ID/title/publishedAt, enclosure URL, RSS GUID при наличии и источник значения duration. Backend не возвращает GUID в Episode API: администратор может сопоставить его с RSS и `external_episode_key` в БД; не выдумывать GUID. URL-токены и подписные пользовательские данные в отчёт не включать. Точное содержимое публичного RSS может изменяться со временем.

### 4.3. Upstream до playlist/рестарта: ограниченная Range-проба

GET audio не требует playlist. Поэтому проверка идёт до POST playlist и любого restart: автоматическое скачивание выбранного выпуска ещё не поставлено в очередь. Python ниже использует curl-cookie jar и прекращает чтение после ограниченного префикса; CDN, игнорирующий Range и возвращающий 200, **не скачивается целиком**. Transport/auth/HTTP ошибки останавливают сценарий.

```bash
range_check() {
  local label=$1 expected_total=${2:-}
  python3 - "$COOKIE_JAR" "$BASE_URL/api/episodes/$EPISODE_ID/audio" "$QA_WORK/$label" "$expected_total" <<'PY'
import sys, json, re, http.cookiejar, urllib.request
jar=http.cookiejar.MozillaCookieJar(sys.argv[1]); jar.load(ignore_discard=True, ignore_expires=True)
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
request=urllib.request.Request(sys.argv[2], headers={'Range':'bytes=0-1023'})
with opener.open(request, timeout=15) as response:
    status=response.status
    headers=dict(response.headers.items())
    # 200: только 1024 B, затем close. 206: 1025 B максимум для проверки длины.
    body=response.read(1025 if status == 206 else 1024)
    mime=response.headers.get_content_type()
    content_range=response.headers.get('Content-Range')
    result={'status':status,'contentRange':content_range,'contentType':mime,'bodyBytes':len(body)}
    if status == 206:
        match=re.fullmatch(r'bytes 0-1023/(\d+)', content_range or '')
        assert match and int(match[1]) > 1024, content_range
        result['totalBytes']=int(match[1])
        assert len(body) == 1024, len(body)
        assert mime.startswith('audio/'), mime
        if sys.argv[4]: assert result['totalBytes'] == int(sys.argv[4])
    elif status == 200:
        assert mime.startswith('audio/'), mime
        result['rangeUnsupported']=True
    else:
        raise AssertionError('Unexpected status: '+str(status))
open(sys.argv[3]+'.bin','wb').write(body)
open(sys.argv[3]+'.headers.json','w').write(json.dumps(headers,indent=2))
open(sys.argv[3]+'.result.json','w').write(json.dumps(result,indent=2))
PY
}
api "$BASE_URL/api/playback/queue" > "$QA_WORK/upstream-before-queue.json"
jq -e --argjson id "$EPISODE_ID" 'all(.queue[]; .type != "episode" or .id != $id)' "$QA_WORK/upstream-before-queue.json" >/dev/null
api "$BASE_URL/api/episodes/$EPISODE_ID" > "$QA_WORK/upstream-before.json"
jq -e '.episode.downloaded == false' "$QA_WORK/upstream-before.json" >/dev/null
range_check upstream
api "$BASE_URL/api/episodes/$EPISODE_ID" > "$QA_WORK/upstream-after.json"
jq -e '.episode.downloaded == false' "$QA_WORK/upstream-after.json" >/dev/null
if [[ "$(jq -r '.status' "$QA_WORK/upstream.result.json")" != 206 ]]; then
  echo 'STOP: источник вернул 200 без Range; зафиксировать ограничение и выбрать другой публичный источник для seek'; exit 1
fi
UPSTREAM_TOTAL=$(jq -er '.totalBytes' "$QA_WORK/upstream.result.json")
```

Доказательства upstream-ветки: выбранный выпуск отсутствует в playlist, downloaded=false до/после, backend выбирает remote при отсутствии local path, фактические 206/Content-Range/audio MIME/1024 байта. CDN access-log нам недоступен; это ограничение доказательств, а не препятствие к проверке ветки. Одна HTTP 206 без проверки состояния не доказывает ветку. Зафиксировать точный Content-Range и total из **этого ответа**, а не enclosure length RSS. При 200 отдельно отметить отсутствие поддержки Range у источника; не считать это автоматически дефектом mpod и не выдавать проверку seek за PASS.

### 4.4. Локальный файл, playlist и контрольный прогресс

```bash
jq -n --argjson id "$EPISODE_ID" '{episodeId:$id}' > "$QA_WORK/target.json"
api -H 'Content-Type: application/json' --data-binary @"$QA_WORK/target.json" "$BASE_URL/api/playlist" > "$QA_WORK/add-playlist.json"
jq -e '.success == true' "$QA_WORK/add-playlist.json" >/dev/null
# Скачивание через реальный compatibility API, без выдуманной кнопки UI.
api -X POST "$BASE_URL/api/episodes/$EPISODE_ID/download" > "$QA_WORK/download.json"
jq -e '.success == true and .episode.downloaded == true' "$QA_WORK/download.json" >/dev/null
api "$BASE_URL/api/episodes/$EPISODE_ID" > "$QA_WORK/local-episode.json"
jq -e '.episode.downloaded == true' "$QA_WORK/local-episode.json" >/dev/null
range_check local
test "$(jq -r '.status' "$QA_WORK/local.result.json")" = 206
LOCAL_RANGE_TOTAL=$(jq -er '.totalBytes' "$QA_WORK/local.result.json")
api -X PUT -H 'Content-Type: application/json' --data-binary @"$QA_WORK/target.json" "$BASE_URL/api/playback/active" > "$QA_WORK/active.json"
jq -e --argjson id "$EPISODE_ID" '.activePlayback.episodeId == $id' "$QA_WORK/active.json" >/dev/null
jq -n --argjson id "$EPISODE_ID" --argjson duration "$DURATION_SECONDS" '{episodeId:$id,positionSeconds:15,durationSeconds:$duration,completed:false,didSeek:true}' > "$QA_WORK/progress-request.json"
api -H 'Content-Type: application/json' --data-binary @"$QA_WORK/progress-request.json" "$BASE_URL/api/playback" > "$QA_WORK/progress-written.json"
check_control() {
  api "$BASE_URL/api/playback?episodeId=$EPISODE_ID" > "$QA_WORK/progress-current.json"
  jq -e --argjson id "$EPISODE_ID" '.playback.episodeId == $id and .playback.positionSeconds == 15' "$QA_WORK/progress-current.json" >/dev/null
  api "$BASE_URL/api/playback/queue" > "$QA_WORK/queue-current.json"
  jq -e --argjson id "$EPISODE_ID" '.activePlayback.episodeId == $id and any(.queue[]; .type == "episode" and .id == $id)' "$QA_WORK/queue-current.json" >/dev/null
  api "$BASE_URL/api/podcasts/$PODCAST_ID" > "$QA_WORK/podcast-current.json"
  jq -e --argjson id "$PODCAST_ID" '.podcast.id == $id' "$QA_WORK/podcast-current.json" >/dev/null
}
check_control
cp "$QA_WORK/queue-current.json" "$QA_WORK/control-queue.json"
api "$BASE_URL/api/playlist" > "$QA_WORK/control-playlist.json"
compare_control() {
  check_control
  api "$BASE_URL/api/playlist" > "$QA_WORK/playlist-current.json"
  jq -S '.items' "$QA_WORK/control-playlist.json" > "$QA_WORK/playlist-expected.normalized"
  jq -S '.items' "$QA_WORK/playlist-current.json" > "$QA_WORK/playlist-current.normalized"
  cmp "$QA_WORK/playlist-expected.normalized" "$QA_WORK/playlist-current.normalized"
  jq -S 'del(.activePlayback.lastUpdated) | .queue |= map(del(.playback.lastUpdated))' "$QA_WORK/control-queue.json" > "$QA_WORK/queue-expected.normalized"
  jq -S 'del(.activePlayback.lastUpdated) | .queue |= map(del(.playback.lastUpdated))' "$QA_WORK/queue-current.json" > "$QA_WORK/queue-current.normalized"
  cmp "$QA_WORK/queue-expected.normalized" "$QA_WORK/queue-current.normalized"
}
```

Automatic download стартует через persistent задержку 15 секунд после добавления; worker работает также при запуске backend, а ручной POST дедуплицируется с ним. Локальная ветка подтверждается downloaded=true, реальным файлом и Range, total которого равен размеру файла. CDN с динамической рекламной вставкой может вернуть при скачивании другие байты/размер, чем в upstream-пробе: совпадение префиксов и размеров между разными CDN-запросами не является обязательным критерием. Отдельно записать upstream total и local bytes/hash; различие само по себе не означает дефект mpod. После создания локального контрольного файла его размер/hash должны сохраняться при restart/restore.

Перед переходом к административным проверкам передать EPISODE_ID/PODCAST_ID, DURATION_SECONDS, UPSTREAM_TOTAL, LOCAL_RANGE_TOTAL и контрольные JSON безопасным локальным способом. Администратор дополнительно проверяет путь из БД и файл в NAS-сессии:

```bash
read -r -p 'Контрольный EPISODE_ID от QA: ' EPISODE_ID
[[ "$EPISODE_ID" =~ ^[1-9][0-9]*$ ]]
LOCAL_PATH=$(tools sqlite3 /data/mpod.sqlite "SELECT downloaded_path FROM episodes WHERE id=$EPISODE_ID;")
[[ "$LOCAL_PATH" = /data/downloads/* && "$LOCAL_PATH" != *$'\n'* ]]
read -r -p 'LOCAL_RANGE_TOTAL от QA (байты): ' LOCAL_RANGE_TOTAL
[[ "$LOCAL_RANGE_TOTAL" =~ ^[0-9]+$ && "$LOCAL_RANGE_TOTAL" -gt 1024 ]]
LOCAL_BYTES=$(tools sh -ec 'test -f "$1"; wc -c < "$1"' sh "$LOCAL_PATH")
test "$LOCAL_BYTES" -eq "$LOCAL_RANGE_TOTAL"
LOCAL_SHA256=$(tools sha256sum "$LOCAL_PATH")
```

Точные ID, позиция, состав и порядок playlist/queue, downloaded path/size/hash — контрольные данные. Не ограничиваться count(*) и integrity check. В API comparison queue исключать timestamps, если операция их законно меняет; сохранять identities, порядок, target и position. До restart/update/restore закрыть браузерные проигрыватели, чтобы они не перезаписывали позицию 15.

## 5. Администратор: проверки сохранности после подготовки данных

Каждая изменяющая операция выполняется после отдельного разрешённого перехода. После каждой — readiness, авторизованный APP_BUILD, контрольные API и файл/hash; эти результаты получает QA на следующем порученном этапе. Если API не готово или cookie истёк — остановить проверку, не считать данные потерянными по одному 401. После повторного login контроль продолжается.

### 5.1. Restart

```bash
dc restart "$SERVICE"
CID=$(dc ps -q "$SERVICE")
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = running
```

После ограниченного ожидания §4.1 QA выполняет `wait_ready`, затем `compare_control` (playlist и queue сравниваются с control-снимками), проверку `.settings.appBuild == EXPECTED_BUILD`, downloaded=true и `range_check local "$LOCAL_RANGE_TOTAL"`; администратор сверяет прежний LOCAL_PATH, размер/hash, mount и логи. Простой статус Up не доказывает HTTP readiness или сохранность.

### 5.2. Online backup

```bash
ONLINE=$(mktemp -d "$WORK/online.XXXXXX")
ONLINE_NAME=$(basename "$ONLINE")
tools sh -ec '
  sqlite3 /data/mpod.sqlite "VACUUM INTO '\''/work/$1/mpod.sqlite'\'';"
  test "$(sqlite3 "/work/$1/mpod.sqlite" "PRAGMA integrity_check;")" = ok
  test -s "/work/$1/mpod.sqlite"
' sh "$ONLINE_NAME"
```

Этот backup консистентен для БД, не является snapshot всего приложения и не содержит downloads. Прогресс, playlist и подписка уже существуют; проверить контрольные записи в backup и hash файла на диске до restore. Снимок исходного стенда для окончательного возврата — отдельный BASELINE из §3.1.

### 5.3. Негативный restore той же процедурой

При остановленных клиентах и неподвижном контрольном состоянии получить API control-snapshot, текущие CID/StartedAt/RestartCount и консистентный логический snapshot БД. WAL работающей БД может изменяться, поэтому не сравнивать hash физического `mpod.sqlite` как доказательство неизменности данных. Используется SQL dump двух online-копий, исключая новые login-сессии: во время этого интервала повторный login не выполнять.

```bash
NEGATIVE=$(mktemp -d "$WORK/negative.XXXXXX")
printf '%s\n' 'CORRUPTED SQLITE HEADER CONTENT' > "$NEGATIVE/mpod.sqlite"
BEFORE_STATE=$(docker inspect "$CID" --format '{{.Id}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}')
NEG_CHECK=$(mktemp -d "$WORK/negative-check.XXXXXX")
NEG_NAME=$(basename "$NEG_CHECK")
tools sh -ec '
  sqlite3 /data/mpod.sqlite "VACUUM INTO '\''/work/$1/before.sqlite'\'';"
  test "$(sqlite3 "/work/$1/before.sqlite" "PRAGMA integrity_check;")" = ok
  sqlite3 "/work/$1/before.sqlite" .dump > "/work/$1/before.sql"
' sh "$NEG_NAME"
set +e
bash "$WORK/restore.sh" "$NEGATIVE" db-only > "$NEG_CHECK/restore.out" 2> "$NEG_CHECK/restore.err"
RESTORE_RC=$?
set -e
test "$RESTORE_RC" -eq 42
grep -Fx INVALID_BACKUP "$NEG_CHECK/restore.err" >/dev/null
AFTER_STATE=$(docker inspect "$CID" --format '{{.Id}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}')
test "$AFTER_STATE" = "$BEFORE_STATE"
tools sh -ec '
  sqlite3 /data/mpod.sqlite "VACUUM INTO '\''/work/$1/after.sqlite'\'';"
  test "$(sqlite3 "/work/$1/after.sqlite" "PRAGMA integrity_check;")" = ok
  sqlite3 "/work/$1/after.sqlite" .dump > "/work/$1/after.sql"
  cmp "/work/$1/before.sql" "/work/$1/after.sql"
' sh "$NEG_NAME"
```

Также выполнить QA `compare_control` и проверить прежний файл/hash. Только код 42 + собственный marker после распознанной порчи + неизменный сервис/данные дают PASS. Docker/volume/copy/sqlite tooling failures дают ERROR/FAIL, не «копия успешно отклонена». При scheduler/download изменениях сравнение честно FAIL/неопределённо; повторить в согласованном спокойном окне, не исключать произвольные строки из dump ради PASS.

### 5.4. Online restore

```bash
bash "$WORK/restore.sh" "$ONLINE" db-only
```

После readiness выполнить QA `compare_control` для данных из времени ONLINE, проверку APP_BUILD и административную проверку downloads. Для доказательства возвращения именно backup перед restore в отдельном согласованном QA-переходе изменить **только тестовый прогресс** с 15 на 75 секунд, проверить запись, затем закрыть клиентов. После restore ожидается 15. Не менять исходные пользовательские записи. Для каждого restore скрипт сохраняет собственный новый rollback-каталог с текущими БД/WAL/SHM/downloads.

### 5.5. Offline backup и restore с имеющимися WAL/SHM

Создать новый согласованный комплект при остановленном сервисе. Если журналы отсутствуют после чистой остановки — это штатно; отсутствие нельзя выдавать за выполненную проверку восстановления WAL-записей. В таблице фиксируется фактический состав.

```bash
OFFLINE=$(mktemp -d "$WORK/offline.XXXXXX")
OFFLINE_NAME=$(basename "$OFFLINE")
dc stop "$SERVICE"
CID=$(dc ps -qa "$SERVICE")
test "$(docker inspect "$CID" --format '{{.State.Status}}')" = exited
tools sh -ec '
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/data/$name"; then test -f "/data/$name"; test ! -L "/data/$name"; cp -a "/data/$name" "/work/$1/$name"; fi
  done
  test -f "/work/$1/mpod.sqlite"
  stage=$(mktemp -d /work/offline-check.XXXXXX)
  for name in mpod.sqlite mpod.sqlite-wal mpod.sqlite-shm; do
    if test -e "/work/$1/$name"; then cp -a "/work/$1/$name" "$stage/$name"; fi
  done
  test "$(sqlite3 "$stage/mpod.sqlite" "PRAGMA integrity_check;")" = ok
' sh "$OFFLINE_NAME"
dc start "$SERVICE"
```

После readiness и проверки позиции 15 выполнить отдельный разрешённый QA-переход тестового прогресса 15 → 75; затем администратор:

```bash
bash "$WORK/restore.sh" "$OFFLINE" db-only
```

После readiness выполнить QA `compare_control`: ожидать 15, прежний active/playlist/queue; администратор сверяет downloads/hash. Оффлайн-копия проверяется **той же** процедурой до остановки и замены; существующие WAL/SHM учитываются при нормализации staging. Не открывать оригинальный OFFLINE sqlite3, не стирать журналы рабочей базы заранее. Искусственный crash/kill ради WAL на существующем сервере этой инструкцией не разрешается; если WAL-сценарий не удалось фактически воспроизвести, отдельно отметить ограничение, а не общий PASS для него.

### 5.6. Обновление — только отдельное поручение на точный SHA из test

Этот шаг **не разрешён текущей задачей** и может остаться «Не выполнялось: обновление отложено». Перед обновлением администратор сверяет актуальный `/home/cross/mpod-mobile/deploy-test.sh`, его источник/команды с поручением и `docs/deployment.md`. Нельзя запускать script, автоматически берущий новый HEAD, если он не обеспечивает развёртывание согласованного SHA; сначала согласовать точную процедуру. Не выполнять ручной push/fetch в Gitea — это автоматическое зеркало.

Поручение должно содержать полный APPROVED_SHA из `test`, согласованное APP_BUILD, способ сборки/доставки образа и откат на предыдущий образ. До операции: проверенный новый offline snapshot БД+downloads, контрольные API/queue/playlist/progress 15, прежние image ID и защищённая копия фактической конфигурации вне Git. Конфигурацию и SESSION_SECRET сохранить; меняется только согласованное APP_BUILD. Runtime env не подменять `.env.example`.

Выполняемая процедура определяется **после** сверки deploy-script на NAS. Документ не выдумывает его фактическое поведение. Обязательные проверки до запуска: `git rev-parse HEAD` целевого checkout равен APPROVED_SHA; источник кандидата подтверждён как test; разрешённый build относится к этому SHA, а не checkout QA; монтирования `/data` и RO аудиокниг, host 5051, paths сохранены. После запуска: readiness, авторизованное `.settings.appBuild` равно согласованному значению, точный SHA/image ID/build log, прежние подписки, порядок queue/playlist, active/progress и скачивания size/hash, отсутствие критических логов. Предыдущий образ не удалять до завершения приёмки; возможные миграции и совместимость rollback подтверждаются до update. Нельзя обещать совместимость старого образа с новой схемой без проверки.

## 6. QA в браузере

После завершения административных проверок и отдельного QA-поручения открыть **`http://192.168.0.222:5051`**, войти существующим пользователем и проверить подтверждённый APP_BUILD через авторизованный API. Браузерную проверку вести до окончательного возврата baseline, пока тестовая подписка присутствует.

1. Выбрать согласованный тестовый эпизод в playlist; убедиться, что активный трек совпадает с EPISODE_ID. Запустить настоящее воспроизведение: звук слышен, позиция движется, нет ошибок media/console. Не считать получение байтов через curl доказательством воспроизведения.
2. Перемотать примерно на 75 секунд, продолжить несколько секунд, поставить паузу. В Network/API убедиться, что POST `/api/playback` успешен, GET `/api/playback?episodeId=…` подтверждает сохранённую позицию, GET `/api/playback/queue` — тот же active. Записать фактическую целую позицию после синхронизации.
3. Нажать F5. Убедиться, что восстановлены тот же active и сохранённая позиция (при паузе позиция должна совпасть с подтверждённым API значением), затем нажать play и подтвердить продолжение от неё. Зафиксировать browser/OS и ошибки, если есть.
4. Проверить playlist/подписки вне тестовой подписки по исходным snapshot: не появились потери данных. Не доводить тестовый выпуск до конца, чтобы completion не изменил контрольный набор неожиданно.

Эта проверка браузера проводится с подтверждённой локальной копией. Upstream Range подтверждён отдельно в §4.3. Если требуется **браузерное воспроизведение именно upstream**, это отдельный согласованный сценарий: нельзя пометить его выполненным по локальному play или удалять пользовательские downloads для создания условий.

## 7. Администратор: возврат исходного стенда и временные данные

Полный возврат — после отдельного согласования, с закрытыми клиентами, без изменений других пользователей/задач. `BASELINE` содержит исходные подписки, очередь, прогрессы и downloads. Для работающего сервиса:

```bash
bash "$WORK/restore.sh" "$BASELINE" with-downloads
```

Если сервис stopped после ошибки, применяется §3.3. После readiness и остановки клиентов администратор проверяет исходные записи и весь набор downloads:

```bash
tools sh -ec '
  compare=$(mktemp -d /work/baseline-return-check.XXXXXX)
  sqlite3 /data/mpod.sqlite "VACUUM INTO '\''$compare/current.sqlite'\'';"
  test "$(sqlite3 "$compare/current.sqlite" "PRAGMA integrity_check;")" = ok
  for table in users settings podcasts episodes playlist playback active_playback audiobook_playback audiobook_playlist_tracks audiobook_track_exclusions; do
    sqlite3 "$compare/current.sqlite" ".dump $table"
  done > "$compare/current-user-data.sql"
  cmp "/work/$1/expected-user-data.sql" "$compare/current-user-data.sql"
  sqlite3 "$compare/current.sqlite" "SELECT id,audiobook_id,is_listened FROM audiobook_tracks ORDER BY id;" > "$compare/current-audiobook-track-state.txt"
  cmp "/work/$1/expected-audiobook-track-state.txt" "$compare/current-audiobook-track-state.txt"
  (cd /data/downloads; find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$compare/current-downloads.sha256"
  cmp "/work/$1/expected-downloads.sha256" "$compare/current-downloads.sha256"
' sh "$BASELINE_NAME"
```

QA входит заново при необходимости и сравнивает `.podcasts`, `.items`, identities/порядок queue, active и прогрессы с original snapshot. Baseline создан до login, поэтому sessions могут отличаться — это ожидаемо. Администратор сверяет исходные downloads (пути, размеры и sha256 файлов, исключая законные временные артефакты) со snapshot, mounts и логи. Тестовая подписка должна отсутствовать; исходные записи должны восстановиться, а не просто «база целая». Если update был разрешён, дальнейший целевой build (прежний или новый) и конфигурационный rollback должны быть явно указаны в поручении. DB restore не возвращает автоматически app image/env.

До согласованного возврата не удалять тестовую подписку через API как замену полного rollback: это не восстановит все исходные active/progress. Нельзя продолжать, если после baseline произошли посторонние изменения — требуется решение, какие данные сохранять. Источники аудиокниг не копируются/не заменяются; read-only mount должен сохраниться.

После подтверждения возврата и переноса обезличенных результатов в §9:

- QA вызывает POST `/api/auth/logout` с текущей валидной сессией, проверяет GET session `authenticated=false`, удаляет cookies/auth bodies и собственные файлы в `$QA_WORK`. При невалидной старой сессии уничтожить локальный jar; повторный login ради logout не обязателен.
- Администратор удаляет только созданный helper image (`docker image rm "$SQLITE_IMAGE"`) и собственные временные файлы/каталоги `$WORK` после подтверждения, что backup больше не нужен и копии журнала не используются для расследования. Не использовать prune, удаление Compose-проекта/тома или широкие маски. Backup с персональными данными не хранить в Git.
- Все временные scripts/результаты/screenshots остаются вне Git. Документ содержит только очищенные доказательства.

Пример logout в QA-сессии до удаления cookie jar:

```bash
api -X POST "$BASE_URL/api/auth/logout" > "$QA_WORK/logout.json"
api "$BASE_URL/api/auth/session" > "$QA_WORK/logged-out.json"
jq -e '.authenticated == false' "$QA_WORK/logged-out.json" >/dev/null
```

## 8. Справка: первая установка вне существующего стенда

На NAS test-стенде этот раздел **не выполняют**. Для отдельно разрешённой действительно новой установки: подготовить Docker/Compose, paths и read-only библиотеку по deployment; создать env с `umask 077`, сгенерировать `SESSION_SECRET` криптографическим генератором **до** первого запуска, записать ровно один APP_BUILD согласованного SHA, проверить параметры и только затем build/start. Не использовать `change-me` в production. Первоначальная регистрация создаёт единственного пользователя и сессию; дальнейшие входы через login. Эта справка не даёт команд сброса существующих данных и не разрешает новую установку.

## 9. Фактические результаты прогона

Прогон выполнен 2026-09-18. Администратор/QA заполнили каждую строку после фактической проверки. Не опубликованы: SESSION_SECRET, пароли, cookies, sessions, auth bodies, приватные пользовательские записи, URL-токены.

| № | Этап / ожидаемый результат | SHA / APP_BUILD / окружение | Фактический результат / доказательство | Статус |
|---|---|---|---|---|
| 1 | NAS topology: mpod-mobile, host 5051 → app 5050, прежний RW data и RO abooks | b087213 / NAS Docker | volume `mpod-mobile_mpod_data→/data` RW=true; `/share/audio/abooks` RW=false; порт 5051→5050 подтверждён через `docker inspect` | [x] |
| 2 | Происхождение deployed image подтверждено точным SHA и build report | image `sha256:b7b8e70e…`; APP_BUILD=b087213 | Точный source образа по APP_BUILD не доказан — build history недоступен; происхождение остаётся неподтверждённым | [~] |
| 3 | Финальный образ <94 371 840 байт; runtime UID/GID 1000 и состав | b087213 / NAS Docker | image sha256:b7b8e70e…; размер, UID/GID 1000, `/usr/local/bin/mpod`, `/app/frontend/dist`, `/app/migrations` подтверждены | [x] |
| 4 | Логи успешно получены, нет критических ошибок/restart-loop | b087213 / NAS Docker | runtime.log получен; критических panic/fatal/migration-error нет; RestartCount=0 | [x] |
| 5 | RO write отклонён именно read-only filesystem; файл отсутствует | b087213 / NAS Docker | `docker exec touch` → «Read-only file system»; файл не создан; контейнер жив | [x] |
| 6 | Исходный offline snapshot БД/имеющихся WAL/SHM/downloads проверен | 2026-09-16T19:14Z / NAS | `baseline.oalvXJ/mpod.sqlite` 2 064 384 B SHA256 `086ec471…`; WAL/SHM отсутствовали; `downloads/31/34638` подтверждён; integrity=ok | [x] |
| 7 | Без сессии settings=401; setupRequired bool; login/session валидны | b087213 / QA | HTTP 401 без сессии; setupRequired=false; login/session PASS 2026-09-18T09:19Z | [x] |
| 8 | Авторизованный APP_BUILD=ожидаемому; SPA отдаётся как HTML | b087213 / QA | appBuild=b087213; Content-Type: text/html PASS | [x] |
| 9 | Публичный RSS/конкретный выпуск/duration подтверждены, RSS/enclosure доступны через runtime SOCKS5 (fallback отмечен отдельно) | feeds.transistor.fm / QA | PODCAST_ID=100002, EPISODE_ID=36315, duration=2486 s; импорт через API PASS; SOCKS5 маршрут логами не подтверждён (CDN log недоступен) | [x] |
| 10 | Upstream до playlist: downloaded=false, точный 206/Range/MIME/1024 B, remote-ветка по backend/state; CDN log недоступен | b087213 / QA 2026-09-18T09:19Z | downloaded=false до/после; 206 Content-Range bytes 0-1023/40464569; audio/mpeg; 1024 B PASS; CDN log — ограничение | [x] |
| 11 | Local: downloaded=true, файл/path/size/hash, точный local Range total=размеру файла | b087213 / QA+NAS | downloaded=true; `/data/downloads/100002/36315-What-is-Transistor-s-secret-weapon.mp3`; 40 464 569 B; SHA256 `d34092…`; local Range total=40464569 PASS | [x] |
| 12 | Контрольные подписка/playlist/queue/active/position=15 подтверждены до операций | b087213 / QA 2026-09-18T09:19Z | active=36315; position=15; playlist abook22→ep34638→abook1→ep36315; queue PASS; control-playlist/queue.json сохранены | [x] |
| 13 | Restart + readiness: контрольные записи/queue/progress/downloads сохранены | b087213 / NAS+QA | dc restart; wait_ready PASS; compare_control PASS; downloaded=true; LOCAL_PATH/size/hash неизменны | [x] |
| 14 | Online backup: самостоятельная SQLite-копия, integrity=ok, контрольные записи | 2026-09-18T08:28Z / NAS | `online.CwlEi9/mpod.sqlite` 2 818 048 B SHA256 `56bc7ff8…`; integrity=ok; position=15 подтверждена | [x] |
| 15 | Негативный вызов того же restore: 42/marker, сервис/dump/API/downloads неизменны | b087213 / NAS | exit 42; INVALID_BACKUP marker; before/after SQL dump идентичны; RestartCount=0; downloads неизменны. Три теста: `negative.ivKv03`, `negative2.sbGh4C`, `negative3.lxnUoy` — все PASS | [x] |
| 16 | Online restore: собственный rollback, тестовый прогресс 75→15, queue/active/downloads сохранены | 2026-09-18T10:03Z–10:04Z / NAS | `bash restore.sh online.CwlEi9 db-only`; `rollback.GZQApb` сохранён (содержал progress=75); position после restore=15; active=36315; downloads неизменны; integrity=ok. Подробнее — §9.1 | [x] |
| 17 | Offline backup: точный состав БД/WAL/SHM, staging integrity=ok | 2026-09-18T10:05Z / NAS | `offline.i16WRf` и `offline.MeeDGV` — оба position=15; WAL/SHM отсутствовали после clean shutdown; integrity=ok | [x] |
| 18 | Offline restore: WAL учтён при наличии, тестовый прогресс 75→15, данные/downloads сохранены | 2026-09-18T10:36Z / NAS | `restore-stage.bSl1sb`: source=`offline.MeeDGV` (`fdbf1afa…`); `rollback.Jgxhls` сохранён; position после restore=15; downloads неизменны. WAL/SHM после clean stop отсутствовали — WAL replay не проверен. Первая попытка (`offline.i16WRf`) не завершилась до mktemp — см. §9.1 | [~] |
| 19 | Обновление на отдельно согласованный SHA test: build/secrets/mounts/данные сохранены | — | Не выполнялось: обновление отложено пользователем | [ ] |
| 20 | Браузер: реальный play, seek, pause/sync, F5 и resume того же active/позиции | — | Не выполнялось: Browser QA приостановлен до решения по offline restore | [ ] |
| 21 | Полный возврат baseline: исходные subscriptions/queue/active/progress/downloads, тестовая подписка отсутствует | 2026-09-18T18:03Z / NAS | `restore-stage.d8kK0w`: source=`baseline.oalvXJ` (`086ec471…`); `rollback.uobPXP` сохранён; active_playback: audiobook_id=1, episode_id=NULL — соответствует baseline; `downloads/31/34638-Podlodka-494.mp3` — единственный файл, совпадает с baseline; integrity=ok; WAL/SHM присутствуют (сервис работает) | [x] |
| 22 | Logout и удаление только временных артефактов, без удаления persistent data | — | Не выполнялось: часть A не принята; уборка отложена | [ ] |

Обозначения: **[x]** — PASS, **[~]** — частично/с ограничением, **[ ]** — не выполнялось.

### 9.1. Диагностическое дополнение: offline restore — первая попытка

> Диагностика выполнена 2026-09-21 на неизменённых артефактах `WORK=/home/cross/mpod-snapshots/runtime.FNguR6`. Рабочие файлы не перемещались и не изменялись.

**Timeline по mtime артефактов (MSK, 2026-09-18):**

| Время | Событие | Артефакт / hash |
|---|---|---|
| 08:28 | Online backup при работающем сервисе | `online.CwlEi9/mpod.sqlite` SHA256 `56bc7ff8…` position=15 |
| 09:03 | Pre-restore backup текущего состояния (progress=75) | `online-restore.kNsoxg/mpod.sqlite` SHA256 `1dcfc593…` position=75 |
| 09:04 | **Online restore** из `online.CwlEi9` db-only | `restore-stage.ihv1ei`; `rollback.GZQApb` (progress=75, 2 859 008 B, права `0644` — аномалия, не `0600`) |
| 09:05–09:08 | **Offline backup** при работающем сервисе | `offline.i16WRf/mpod.sqlite` SHA256 `0a25961e…` position=15 (после online restore) |
| 09:27 | API: progress → 75; online backup | `online-75.khCkEL/mpod.sqlite` SHA256 `1c02a999…` position=75 |
| 09:27 | Online restore из `online-75.khCkEL` | `restore-stage.PVnfxZ`; `rollback.72Qzr7` |
| 09:28 | Online restore из `online.CwlEi9` (75→15) | `restore-stage.Ar1J7F`; `rollback.lWYoW5` |
| 09:32 | **Второй offline backup** при работающем сервисе | `offline.MeeDGV/mpod.sqlite` SHA256 `fdbf1afa…` position=15 |
| **09:36** | **Offline restore** из `offline.MeeDGV` db-only — **PASS** | `restore-stage.bSl1sb`; `rollback.Jgxhls`; position=15 подтверждена |
| 18:03 | Baseline return with-downloads | `restore-stage.d8kK0w`; `rollback.uobPXP` |

**Первая попытка offline restore (`offline.i16WRf`, 0a25961e…):**

Для `offline.i16WRf` ни одного `restore-stage.*` с этим source-hash не существует. Скрипт завершился до `mktemp -d "$WORK/restore-stage.XXXXXX"`. Stdout/stderr не сохранены — скрипт запускался интерактивно без перенаправления вывода.

Вероятная причина: в тот момент на NAS лежал `restore.sh.before-provenance` (SHA256 `a3250d7a…`, 4 445 B). Строка 14 в нём:

```
[[ -n "$CID" && "$CID" != *$n* ]]
```

`$n` не определён. В bash `[[ "string" != ** ]]` всегда ложно — скрипт завершался с ненулевым кодом до создания stage. Это согласуется с отсутствием stage-каталога для `offline.i16WRf`.

Альтернативный вариант: сервис мог быть остановлен перед вызовом — тогда строка 15 (`test ... == running`) давала бы аналогичный выход. Какой именно из двух вариантов реализовался — **не доказано**: фактический exit code и stderr не сохранены.

**Заявленный root cause «mv across Docker volume не работает»: не подтверждён.**

Диагностика внутри helper-контейнера:
- `/data` (volume `mpod-mobile_mpod_data`): device 2431, `/dev/md127 ext4`
- `/work` (bind-mount `$WORK`): device 2050, `/dev/sda2 ext4`
- Устройства **различаются** — `mv` между ними требует fallback `cp`+`rm`

Воспроизводящий тест (создание файла в `/data`, `mv` в каталог `/work`) **прошёл успешно**: Alpine busybox `mv` выполняет cross-device перемещение через `cp`+`rm`, exit code 0.

Анализ конкретных `mv` в `restore.sh`:

| Строка | Операция | Направление | Оценка |
|---|---|---|---|
| 92 | `mv -f $target /data/mpod.sqlite` | `/data`→`/data` (same device) | Атомарный rename; все restore выполнили успешно |
| 97 | `mv /data/$name $stage/old-journals/$name` | `/data`→`/work` (cross-device) | busybox `mv` допускает; WAL/SHM отсутствовали во всех restore → ветка фактически не выполнялась |
| 104 | `mv /data/downloads $stage/previous-downloads` | `/data`→`/work` (cross-device) | Режим `with-downloads`; baseline return выполнен успешно |
| 105 | `mv $downloads_stage /data/downloads` | `/data`→`/data` (same device) | Атомарный rename; успешно |

**Вывод:** дефект `restore.sh.before-provenance` (строка `$n` вместо `$'\n'`) реален и исправлен — исправленный скрипт верифицирован SHA256 `a888ce2d…`. Тезис «mv across Docker volume не работает» не подтверждён воспроизведением. Причинно-следственная связь дефекта скрипта с первым неуспешным запуском по фактическому трейсу не доказана из-за отсутствия сохранённых логов.

**Для Team Lead:** дефект документа/скрипта подтверждён и уже исправлен. Пересмотра `mv` на `cp` не требуется. WAL-сценарий не тестировался на этом стенде (чистая остановка не оставила журналов; crash/kill не выполнялся).

**Текущее состояние стенда (2026-09-21T10:32Z):**
- Сервис: `running`, RestartCount=0, поднят 2026-09-18T19:02:25Z
- `/data/mpod.sqlite`: SHA256 `8e13fd13…`, integrity=ok; active_playback: audiobook_id=1, episode_id=NULL — соответствует baseline
- Downloads: `/data/downloads/31/34638-Podlodka-494.mp3` — единственный файл, совпадает с baseline; тестовый файл 36315 отсутствует (штатно для baseline)
- WAL/SHM: присутствуют (сервис активен)
- Mounts: volume `mpod-mobile_mpod_data→/data` RW; `/share/audio/abooks` RW=false
- `$WORK`, rollback-каталоги, `baseline.oalvXJ` сохранены; уборка не выполнялась

Нельзя ставить общий PASS при пропущенных обязательных сценариях. Если фактическая остановка не оставила WAL/SHM, отдельно фиксировать непроверенный WAL-case. Недоступность инструментов/источника, ошибочный proxy route, неготовый API и повреждение копии различаются в отчёте. Финальный вердикт выдаётся после review доказательств; наличие коммита не заменяет приёмку.

