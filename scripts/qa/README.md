# QA-инструменты для эмуляторов и телефонов

Минимальный набор скриптов для проверок на Android (эмулятор или реальный телефон)
и для диагностики плеера. Ничего не устанавливают, не меняют продуктовый код и не
ходят на серверы — только управляют устройством и читают страницу через DevTools.

Правила самих прогонов (разрешение на запуск, готовность окружения, скриншоты,
антипаттерны) — в [`docs/emulator-testing.md`](../../docs/emulator-testing.md).
Перед запуском прочитать обязательно.

## Подключение устройства

Реальный телефон (Android 11+), без кабеля:

```sh
adb pair <ip>:<pair-порт>      # PIN с экрана «Подключение с помощью кода»
adb mdns services              # найти _adb-tls-connect порт
adb connect <ip>:<connect-порт>
adb devices                    # должен быть статус device

adb forward tcp:9222 localabstract:chrome_devtools_remote
curl -s http://127.0.0.1:9222/json/list   # страницы, включая установленный WebAPK
```

Эмулятор — то же самое, serial вида `emulator-5554`.

## Скрипты

### `adb-timeout <сек> <команда...>`

Жёсткий таймаут для любой команды (в macOS нет `timeout`). Ставить на **каждую** команду
к устройству: зависший `adb`/`agent-device` иначе съедает 20–30 минут прогона.

```sh
scripts/qa/adb-timeout 90 adb -s "$MPOD_ADB_SERIAL" shell dumpsys power
```

### `android-screen.sh <state|lock|wake|unlock|media-play-pause> [serial]`

Экран и медиаклавиша. Serial берётся из аргумента, `$MPOD_ADB_SERIAL` или единственного
подключённого устройства.

```sh
scripts/qa/android-screen.sh lock     # погасить: KEYCODE_SLEEP (223), не 26
scripts/qa/android-screen.sh unlock   # разбудить + свайп вверх
scripts/qa/android-screen.sh state    # mWakefulness / display / isKeyguardShowing
scripts/qa/android-screen.sh media-play-pause  # KEYCODE_MEDIA_PLAY_PAUSE (85)
```

### `cdp-eval.mjs <port> <urlSubstr> "<js>"`

Выполнить выражение в странице устройства и получить JSON. Тело выражения — как в функции,
то есть со словом `return`; `await` поддерживается.

```sh
scripts/qa/cdp-eval.mjs 9222 home "return {vis: document.visibilityState, ms: navigator.mediaSession.playbackState}"
```

### `cdp-click.mjs <port> <urlSubstr> "<js, возвращающий элемент>"`

«Настоящий» клик через `Input.dispatchMouseEvent` по центру найденного элемента.
Нужен для установленного WebAPK: `agent-device` видит там один узел `Web View`,
поэтому тапы по координатам не попадают.

```sh
scripts/qa/cdp-click.mjs 9222 home "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Play')"
```

### `media-probe.mjs <port> <install|dump|state|reset|eval> [urlSubstr]`

Рантайм-инструментирование страницы без правок кода: обёртки `HTMLMediaElement.play/pause`,
`navigator.mediaSession.setActionHandler`, слушатели `visibilitychange` / `pagehide` /
`pageshow` / `freeze` / `resume` / `online` / `offline`, `PerformanceObserver` по `/api/`.
События копятся в `window.__qa`, снимаются одной командой.

```sh
scripts/qa/media-probe.mjs 9222 install home
scripts/qa/media-probe.mjs 9222 dump home | python3 -m json.tool
scripts/qa/media-probe.mjs 9222 state home
```

`install` живёт до перезагрузки страницы. После reload нужно вызвать `install` снова.

## Что важно помнить

- **Аудиоэлемент обычно вне DOM**: плеер создаёт `new Audio()` и не вставляет его в документ,
  поэтому `document.querySelectorAll('audio')` даёт `0`. Смотри состояние через перехват
  `play()` в `media-probe`.
- **`mediaSession.playbackState`** врёт о намерении, а не о факте: `paused` при живом
  метадате нормально для остановленного плеера.
- **Локскрин без медиакарточки** при `paused` — не баг, а поведение системы.
- **`agent-device` отдаёт чёрный кадр на keyguard** — это ограничение привязки к поверхности
  приложения, не проблема устройства. При необходимости: `adb exec-out screencap -p > shot.png`.
- **`ms:*` видно только для хендлеров, зарегистрированных после `install`.** Приложение ставит
  `setActionHandler` на маунте, поэтому инъекция в уже загруженную страницу не покажет `ms:play` /
  `ms:pause` — это не значит, что action не пришёл. Чтобы поймать их, нужна document-start
  инъекция: `Page.enable` → `Page.addScriptToEvaluateOnNewDocument` → перезагрузка.
- **`t` в событиях — это `performance.now()` от навигации страницы**, не от инъекции и не wall
  clock. Привязка к часам: `page_nav_epoch = t0_install − install_t`.
- **`Page.reload` через CDP на Android-WebAPK игнорируется** — перезагружать через
  `Runtime.evaluate` с `location.reload()`.
- **После lifecycle `freeze` событий не будет вообще** (ни `play:call`, ни сетевых): renderer
  заморожен. Это ответ, а не зависший probe — см. раздел 7 в `docs/emulator-testing.md`.
