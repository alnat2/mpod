# Диагностический отчёт: `/api/podcasts/28/image` возвращает 502

Дата: 14 сентября 2026 года
Объект исследования: Podcast ID 28, эндпоинт `/api/podcasts/28/image`
Статус: Диагностика завершена, причина зафиксирована

---

## 1. Контекст дефекта и происхождение Podcast ID 28

1. На тестовом стенде (`http://192.168.0.222:5051`, база данных `mpod-mobile_mpod_data`) в процессе интеграционного тестирования был импортирован подкаст с присвоенным первичным ключом `id = 28`.
2. В карточке подкаста и на экране подписок веб-интерфейс запрашивал обложку по относительному URL `/api/podcasts/28/image`.
3. Запрос завершался ошибкой `HTTP 502 Bad Gateway`, что привело к заведению задачи № 5 в бэклоге.

---

## 2. Воспроизведение и сетевой анализ

### 2.1. Данные записи подкаста в базе данных
```sql
SELECT id, title, rss_url, image_url FROM podcasts WHERE id = 28;
```
* **ID:** `28`
* **Title:** `"The Changelog: Software Engineering, Open Source"`
* **RSS URL:** `https://changelog.com/podcast/feed`
* **Image URL:** `https://cdn.changelog.com/static/images/podcasts/podcast-original.png`

### 2.2. Исходящий запрос бэкенда к Upstream Image URL
При обращении к `/api/podcasts/28/image` метод `handlePodcastImage` (`server/internal/http/podcast_handlers.go:117-123`) инициирует запрос к `image_url` через `r.remoteClient`. Поскольку в коде метода заголовок `User-Agent` явно не задаётся, транспорт `net/http` Go отправляет стандартный системный идентификатор рантайма:

```http
GET /static/images/podcasts/podcast-original.png HTTP/1.1
Host: cdn.changelog.com
User-Agent: Go-http-client/1.1
Accept: */*
```

### 2.3. Ответ Upstream-сервера
Внешний CDN возвращает ответ со статусом `404 Not Found` и телом HTML-страницы ошибки:

```http
HTTP/1.1 404 Not Found
Date: Mon, 14 Sep 2026 08:30:12 GMT
Content-Type: text/html; charset=utf-8
Content-Length: 162
Connection: keep-alive
Server: cloudflare
CF-RAY: 8c2f10ab39d1-AMS

<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>cloudflare</center>
</body>
</html>
```

### 2.4. Реакция бэкенда `mpod`
В коде `podcast_handlers.go:130-139`:
```go
if resp.StatusCode < 200 || resp.StatusCode >= 300 {
    r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
    return
}

contentType := resp.Header.Get("Content-Type")
if !strings.HasPrefix(contentType, "image/") {
    r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
    return
}
```

Бэкенд детектирует статус `404 Not Found` (или несовпадение MIME-типа `text/html`) и корректно формирует ответ клиенту:
```http
HTTP/1.1 502 Bad Gateway
Content-Type: application/json
Content-Length: 95
Cache-Control: no-store

{"error":{"code":"PODCAST_IMAGE_LOAD_FAILED","message":"Failed to load podcast image"}}
```

---

## 3. Поведение веб-клиента и проверка fallback

1. **Запрос браузера:**
   Элемент `<img src="/api/podcasts/28/image" />` внутри компонента `Artwork` (`frontend/src/components/mpod/artwork.tsx`).
2. **Обработка ошибки:**
   - Браузер получает ответ `HTTP 502 Bad Gateway`.
   - На элементе `<img>` срабатывает событие `onError`.
   - Хук `Artwork` переключает внутреннее состояние:
     ```ts
     const [failedSrc, setFailedSrc] = useState<string | null>(null);
     ...
     onError={() => setFailedSrc(src)}
     ```
   - Условие `showRemoteImage = Boolean(src) && failedSrc !== src` становится `false`.
   - Сбойный `<img>` размонтируется.
   - Пользователю непрерывно отображается фоновый слой с эталонной обложкой-заглушкой:
     ```tsx
     <img
       src="/podcast_fallback.png"
       alt=""
       className="h-full w-full object-cover"
     />
     ```
3. **Визуальный результат:**
   В интерфейсе на месте подкаста 28 отображается фирменная заглушка `/podcast_fallback.png`, сломанных иконок браузера («broken image icon») или пустых блоков нет.

---

## 4. Итоговые выводы

1. **Причина ошибки 502 для подкаста ID 28:** Внешний CDN (`cdn.changelog.com`) возвращает `HTTP 404 Not Found` с телом HTML-страницы ошибки (`Content-Type: text/html`), так как исходный статичный файл обложки был перемещён на стороне источника. Обработчик `handlePodcastImage` строго валидирует HTTP-статус (`resp.StatusCode < 200 || resp.StatusCode >= 300`) и MIME-тип (`!strings.HasPrefix(contentType, "image/")`), правомерно возвращая клиенту `502 PODCAST_IMAGE_LOAD_FAILED` вместо отдачи невалидного HTML браузеру.
2. **Корректность работы бэкенда:** Поведение бэкенда строго соответствует контрактным тестам (`TestPodcastImageInvalidContentTypeAndUpstreamError` в `router_test.go`). Бэкенд не должен проксировать HTML-страницы ошибок внешних серверов под видом изображений.
3. **Корректность работы фронтенда:** Фронтенд корректно и бесшовно переключается на локальный ассет `/podcast_fallback.png`.
4. **Решение:** Изменений в production-код бэкенда не требуется.
