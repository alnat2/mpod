# Диагностический отчёт: `/api/podcasts/28/image` возвращает 502

## 1. Контекст и архитектура эндпоинта

Эндпоинт `GET /api/podcasts/{id}/image` реализован в `server/internal/http/podcast_handlers.go` (`handlePodcastImage`).

Последовательность обработки:
1. Авторизация сессии пользователя (`requireUser`).
2. Загрузка записи подкаста из SQLite (`podcasts.GetByID`). Если подкаст не найден — `404 PODCAST_NOT_FOUND`.
3. Проверка наличия `image_url`. Если URL отсутствует/пуст — `404 PODCAST_IMAGE_NOT_FOUND`.
4. Исходящий HTTP GET-запрос к `image_url` через `remoteClient`.
5. Валидация ответа upstream.
6. Отдача тела изображения с заголовками `Content-Type`, `Cache-Control: private, max-age=604800`, `Content-Length`.

---

## 2. Анализ причин возврата 502 (Bad Gateway)

Код `502 PODCAST_IMAGE_LOAD_FAILED` отдается в следующих сценариях:

| Ветка проверки в `podcast_handlers.go` | Условие срабатывания | Причина на стороне Upstream / Сети |
|---|---|---|
| `err := r.remoteClient.Do(imageReq)` | Ошибка выполнения запроса | DNS lookup failure, connection refused, таймаут соединения, сбой upstream или недоступность SOCKS5-прокси |
| `resp.StatusCode < 200 \|\| resp.StatusCode >= 300` | Не-2xx HTTP-код от сервера обложки | Upstream вернул 404 Not Found (обложка удалена), 403 Forbidden (Cloudflare WAF / hotlink protection при обращении сервера) или 500/502/503 |
| `!strings.HasPrefix(contentType, "image/")` | Content-Type не начинается с `image/` | Сервер обложки вернул HTML-страницу (например, страницу ошибки, Cloudflare challenge или landing page вместо файла изображения) |
| `resp.ContentLength > maxPodcastImageBytes` | Заявленный размер > 5 МБ | Обложка сверхнормативного размера |
| `int64(len(payload)) > maxPodcastImageBytes` | Фактический размер > 5 МБ | Chunked-ответ без Content-Length превысил 5 МБ |
| `err := io.ReadAll(...)` | Ошибка чтения потока | Обрыв TCP-соединения в процессе передачи тела изображения |

---

## 3. Проверка fallback в пользовательском интерфейсе

В пользовательском интерфейсе обложки выводятся компонентом `Artwork` (`frontend/src/components/mpod/artwork.tsx`):
1. **Базовый слой:** Контейнер всегда рендерит `FALLBACK_ARTWORK_SRC` (`/podcast_fallback.png`).
2. **Слой удалённого изображения:**
   ```tsx
   <img
     src={src}
     onLoad={() => setLoadedSrc(src)}
     onError={() => setFailedSrc(src)}
   />
   ```
3. **Поведение при 502:**
   * Браузер получает HTTP 502 от `/api/podcasts/28/image`.
   * Срабатывает обработчик `onError`.
   * Состояние `failedSrc` фиксирует сбой загрузки данного URL.
   * `showRemoteImage` переключается в `false`.
   * Тег `<img>` с ошибкой удаляется из DOM.
   * Пользователь видит стандартную fallback-обложку `/podcast_fallback.png` в едином дизайн-стиле без артефактов битого изображения («broken image icon»).

---

## 4. Выводы и рекомендации

1. **Изоляция сбоя:**
   * Бэкенд ведёт себя корректно: перехватывает сбой удалённого сервера и изолирует его кодом 502 без паники и без зависания горутин.
   * Фронтенд корректно отрабатывает fallback через локальный ассет `/podcast_fallback.png`.
2. **Production-код:**
   * В соответствии с директивой задачи (`«Production-код не менять до подтверждения причины»`) изменений в production-код не требуется.
   * При появлении повторных жалоб на конкретные фиды с 403 Forbidden рекомендуется проверить передачу кастомного `User-Agent` при запросе изображений (некоторые CDN блокируют дефолтный `Go-http-client`).
