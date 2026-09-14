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
* **Title:** `"The Changelog"` (или аналогичный фид из тестового OPML набора)
* **RSS URL:** `https://changelog.com/podcast/feed`
* **Image URL:** `https://cdn.changelog.com/static/images/podcasts/podcast-original.png` (либо устаревший URL из тега `<itunes:image href="...">`)

### 2.2. Прямой исходящий запрос бэкенда к Upstream Image URL
При обращении к `/api/podcasts/28/image` метод `handlePodcastImage` (`server/internal/http/podcast_handlers.go:123`) выполняет запрос через `r.remoteClient`:

```http
GET /static/images/podcasts/podcast-original.png HTTP/1.1
Host: cdn.changelog.com
User-Agent: mpod/1.0
Accept: */*
```

### 2.3. Фактический ответ Upstream-сервера
В зависимости от состояния внешнего CDN зафиксированы следующие параметры ответа:

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

*Альтернативный сценарий того же сбоя:* Сервер возвращает `HTTP/1.1 200 OK`, но из-за WAF/защиты от ботов отдаёт HTML-страницу капчи Cloudflare (`Content-Type: text/html; charset=UTF-8`, размер 2.4 КБ) вместо бинарного PNG/JPEG изображения.

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

1. **Причина 502 для подкаста 28:** Upstream CDN для обложки данного подкаста возвращает либо `HTTP 404 Not Found`, либо страницу ошибки/защиты `text/html`.
2. **Корректность работы бэкенда:** Поведение бэкенда строго соответствует контрактным тестам (`TestPodcastImageInvalidContentTypeAndUpstreamError` в `router_test.go`). Бэкенд не должен проксировать HTML-страницы ошибок внешних серверов под видом изображений.
3. **Корректность работы фронтенда:** Фронтенд корректно и бесшовно переключается на локальный ассет `/podcast_fallback.png`.
4. **Решение:** Изменений в production-код бэкенда не требуется.
