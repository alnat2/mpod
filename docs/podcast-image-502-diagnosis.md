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
cache-control: max-age=3600, s-maxage=604800, stale-while-revalidate=604800, stale-if-error=604800
cf-cache-status: DYNAMIC
cf-ray: a3aed63629f3560e-AMS
content-type: text/html
date: Mon, 14 Sep 2026 10:51:29 GMT
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=cm7qXd9XAq1mT16sd51OOa%2BvFw%2BvKohuvuG%2B3KElHrCAhHtscFalqW9xeSVu%2FIe9Vf7dCCYIGWArg3z3C5txW2ztD7njyK8rw3QspKS1Dr9arMxSKjuE2Nnf%2Bwm5sqoG534%3D"}]}
server: Fly/728d0e526 (2026-09-10)
vary: Accept-Encoding
x-varnish: 4236054 3815468
age: 3655
via: 1.1 0801900ad35008 (Varnish/7.7), 1.1 fly.io, 1.1 fly.io
access-control-allow-origin: *
x-request-id: 01M2FW5S2JK1PSVDKTTBSB7SEZ-arn
cache-status: region=ams; origin=assets(localhost:5010),changelog.place; ttl=82744.853; grace=172800.000; keep=604800.000; storage=storage.memory; hit; hits=4
content-length: 27150
connection: keep-alive
fly-request-id: 01M2FW5S2JK1PSVDKTTBSB7SEZ-arn

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="https://www.cloudflare.com/favicon.ico" />
    <title>Not Found</title>
```
*(Размер тела ответа составляет ровно 27 150 байт, MIME-тип `text/html`).*

### 2.4. Реакция бэкенда `mpod`
В кодовой базе `server/internal/http/podcast_handlers.go:130-139`:
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

1. **Причина ошибки 502 для подкаста ID 28:** На момент проверки указанный URL возвращал HTTP 404 с Content-Type: text/html. Причина отсутствия файла на стороне источника неизвестна. Обработчик `handlePodcastImage` строго валидирует HTTP-статус (`resp.StatusCode < 200 || resp.StatusCode >= 300`) и MIME-тип (`!strings.HasPrefix(contentType, "image/")`), правомерно возвращая клиенту `502 PODCAST_IMAGE_LOAD_FAILED` вместо отдачи невалидного HTML браузеру.
2. **Корректность работы бэкенда:** Поведение бэкенда строго соответствует контрактным тестам (`TestPodcastImageInvalidContentTypeAndUpstreamError` в `router_test.go`). Бэкенд не должен проксировать HTML-страницы ошибок внешних серверов под видом изображений.
3. **Корректность работы фронтенда:** Фронтенд корректно и бесшовно переключается на локальный ассет `/podcast_fallback.png`.
4. **Решение:** Изменений в production-код бэкенда не требуется.
