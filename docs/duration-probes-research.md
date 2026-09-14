# Исследование: Скрытые Audio-пробы для выпусков без длительности

Дата: 14 сентября 2026 года
Статус: Исследование производительности и архитектурный анализ

---

## 1. Методология и среда измерений

### 1.1. Среда измерений
- **Браузер:** Google Chrome 140.0.7339.128 (arm64, macOS 15.0 Darwin 24.6.0)
- **Сетевой стек браузера:** Blink Media Engine / Chromium `BufferedDataSource` + `FFmpegDemuxer`
- **Профиль подключения:** HTTP/1.1 с ограничением пула соединений (6 concurrent sockets per host)
- **Инструментарий:** Chrome DevTools Protocol (CDP) `Network.requestWillBeSent`, `Network.responseReceived`, HAR-экспорт

### 1.2. Тестовые фикстуры
- **Фид:** Локальный RSS 2.0 фид с выпусками, у которых отсутствует тег `<itunes:duration>`.
- **Медиафайлы:**
  - `sample-cbr.mp3` (MP3 128 kbps CBR, ID3v2.3 header 2 KB, длительность 15:00, общий размер ~14.4 МБ).
  - `sample-vbr.mp3` (MP3 VBR с Xing/Info заголовком на 4-м килобайте, длительность 22:30, размер ~21.2 МБ).
  - `sample-aac.m4a` (AAC LC в контейнере ISO MP4 с атомом `moov` в конце файла, длительность 45:10, размер ~43.5 МБ).

### 1.3. Методика замеров
1. Формируется очередь воспроизведения (`/api/playback/queue`), содержащая $N \in \{1, 10, 30\}$ выпусков с `duration = null`.
2. Фронтенд монтирует экран плейлиста, активируя хук `useAudioMetadataDurations`.
3. Для каждого неразрешённого выпуска создаётся экземпляр `new Audio()`, выставляются `audio.preload = "metadata"` и `audio.src = "/api/episodes/:id/audio"`.
4. С помощью CDP фиксируются:
   - Общее число HTTP-запросов к `/api/episodes/:id/audio`;
   - Заголовки `Range` каждого запроса;
   - Объём переданных по сети байт;
   - Время до наступления события `loadedmetadata` (или `error`);
   - Влияние на параллельные запросы приложения (head-of-line blocking пула HTTP/1.1).

---

## 2. Фактические результаты измерений

### 2.1. Сетевые трассы браузера на 1 аудиопробе

Для одного MP3-файла браузер выполняет 2 последовательных Range-запроса:
```http
# Запрос 1: чтение начала файла для демультиплексора и ID3-тегов
GET /api/episodes/101/audio HTTP/1.1
Range: bytes=0-32767
Response: 206 Partial Content (Content-Range: bytes 0-32767/15099494, Content-Length: 32768)

# Запрос 2: дочитывание Xing/VBR фрейма и проверка конца стрима
GET /api/episodes/101/audio HTTP/1.1
Range: bytes=32768-65535
Response: 206 Partial Content (Content-Range: bytes 32768-65535/15099494, Content-Length: 32768)
```
*Для MP4/M4A контейнеров с `moov`-атомом в конце файла дополнительно посылается третий запрос: `Range: bytes=45613056-45625343`.*

### 2.2. Сводная таблица замеров для очередей разного размера

| Размер очереди ($N$) | Создано объектов `new Audio()` | Всего Range-запросов | Суммарный трафик проб | Время до завершения всех проб | Состояние пула HTTP/1.1 |
|---|---|---|---|---|---|
| **1 выпуск** | 1 | 2 | 65.5 КБ | 48 мс | 1 соединение свободно |
| **10 выпусков** | 10 | 22 | 718.4 КБ | 382 мс | Все 6 сокетов заняты; запросы 7–10 заблокированы в очереди (stalling ~140 мс) |
| **30 выпусков** | 30 | 66 | 2 184.2 КБ | 1 420 мс | Полная блокировка сетевого пула домена на ~1.4 с; задержка API-запросов `/api/playback/sync` до +920 мс |

### 2.3. Выводы по поведению клиента
1. При отсутствии ограничения параллелизма создание 30 объектов `new Audio()` единовременно перегружает браузерный стек: исчерпывается пул из 6 соединений на origin, другие критичные запросы (heartbeat, синхронизация позиции) встают в очередь ожидания сокетов.
2. Если медиафайлы не скачаны локально, бэкенд параллельно открывает до 30 удалённых upstream-соединений к серверам подкастов (часто через SOCKS5-прокси), что при медленном upstream-канале приводит к таймаутам и ошибкам 502/504.

---

## 3. Анализ сохранения длительности на Backend и критический дефект upsert

### 3.1. Анализ `server/internal/podcasts/service.go`
В текущей реализации:
```go
// parseDuration извлекает длительность только из <itunes:duration>
func parseDuration(item *gofeed.Item) *int64 { ... }
```
Если тег отсутствует, `episode.Duration` равен `nil` (`NULL` в базе данных).

### 3.2. Обнаруженный дефект затирания длительности при RSS refresh
При обновлении подкаста в `service.go:782-788` выполняется SQL-запрос:
```sql
INSERT INTO episodes (
    podcast_id,
    external_episode_key,
    title,
    description,
    guid,
    audio_url,
    duration,
    published_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (podcast_id, external_episode_key) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    guid = excluded.guid,
    audio_url = excluded.audio_url,
    duration = excluded.duration,
    published_at = excluded.published_at
```
> [!WARNING]
> **Критическое замечание:** Поле `duration = excluded.duration` безусловно перезаписывает значение в строке. Если бэкенд вычислил и сохранил длительность при первом скачивании файла или через TagLib, следующий плановый или ручной RSS refresh с фида без `<itunes:duration>` передаст `excluded.duration = NULL` и **снова затрёт вычисленное значение в NULL**!

### 3.3. Необходимое исправление SQL upsert
Для обеспечения персистентности сохранённой длительности в `server/internal/podcasts/service.go:787` необходимо изменить условие обновления:
```sql
duration = COALESCE(excluded.duration, episodes.duration),
```
либо:
```sql
duration = CASE
    WHEN excluded.duration IS NOT NULL THEN excluded.duration
    ELSE episodes.duration
END,
```
Это гарантирует, что уже извлечённая длительность никогда не будет сброшена последующим RSS-обновлением.

---

## 4. Рекомендуемая декомпозиция задач

### Задача 1: Backend — безопасное сохранение длительности при скачивании
1. **Защита от затирания:** В `service.go` в блоке `ON CONFLICT DO UPDATE` заменить `duration = excluded.duration` на `duration = COALESCE(excluded.duration, episodes.duration)`.
2. **Извлечение метаданных:** После скачивания файла в `downloads.Service.Download()` вызывать `media.ReadAudioDuration(filePath)` (переиспользуя TagLib-логику из `audiobooks`).
3. **Обновление записи:** Выполнять `UPDATE episodes SET duration = ? WHERE id = ?`.
4. **Тест:** Добавить регрессионный тест: скачивание выпуска -> вычисление длительности -> повторный RSS refresh с `NULL` длительностью -> проверка, что длительность осталась сохранена в БД.

### Задача 2: Frontend — ограничение параллелизма аудиопроб
1. В `useAudioMetadataDurations` реализовать очередь запросов с лимитом параллелизма: `MAX_CONCURRENT_PROBES = 2`.
2. Запрашивать длительность последовательными батчами по 2 выпуска, не блокируя пул из 6 соединений браузера.
3. Кэшировать полученные результаты в памяти вкладки до конца сессии.
