# Сверка интегрированных экранов и компонентов с Figma

Дата аудита: 14 сентября 2026 года
Источник Figma: файл `3CmMv8wYlyNz9qDDdOd2Ka`, страница `screens` (canvas `27:2`)
Утверждённый раздел со статусом `Ready for dev`: `mpod components` (node `538:933`)

---

## 1. Методология и границы применимости

Согласно правилам проекта (`AGENTS.md`, `skills/frontend-implementation/SKILL.md`):
- Разработке и обязательной сверке подлежат исключительно секции Figma, имеющие официальный статус `Ready for Development` (`Ready for dev`).
- Секции `mpod desktop` (`552:1808`), `mpod mobile` (`700:4535`), `mpod mobile components` (`700:4536`) и `for abooks` (`1309:12604`) являются черновыми/рабочими компоновками и не имеют статуса `Ready for dev`. Мобильная адаптация в рамки текущего аудита не входит.
- Единственной утверждённой компонентной секцией является `mpod components` (`538:933`).
- Для получения актуальных данных дизайна использован официальный Figma MCP сервер (`get_screenshot`, инспекция узлов холста), исключая устаревшие локальные дампы.
- Для каждого проверяемого компонента сформирована подтверждённая пара визуальных артефактов: эталонный узел Figma (`*-figma.png`) и снимок фактического рендеринга реального production-компонента в браузере Chromium (`*-actual.png`). Все файлы сохранены непосредственно в репозитории в директории `docs/audit-assets/`.
- Исходные эталоны Figma сохранены раздельно для каждого узла без ручного редактирования или склейки.
- Actual-снимки выполняются в масштабе 1:1 по отношению к CSS-пикселям холста Figma без добавления сторонних декоративных рамок, фонов или внутренних отступов контейнеров, а также без паразитных состояний hover, focus ring и всплывающих тултипов.
- Production-компоненты не модифицируются ради фиктивного прохождения аудита. Если поведение или верстка реального компонента отличается от Figma, такое отличие открыто фиксируется со статусом `FAIL`, если на него отсутствует утверждённое продуктовое решение.

---

## 2. Покомпонентная сверка и визуальные пары

### 2.1. Logo (Figma node `317:1293` vs `logo.tsx`)
- **Figma (узел `317:1293`):** Фирменный знак `mpod` с характерной стилизацией радиоволн (124x45).
- **Фактическая реализация (`frontend/src/components/mpod/logo.tsx`):** Полное совпадение геометрии SVG-контуров, цвета темы (`#09090B` / `#5EA500`) и пропорций.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/logo-figma.png](docs/audit-assets/logo-figma.png)
  - Actual: [docs/audit-assets/logo-actual.png](docs/audit-assets/logo-actual.png)

### 2.2. TopNav (Figma node `372:643` vs `top-nav.tsx`)
- **Figma (узел `372:643`, Desktop, 1440px с центрированным контейнером 1200px, h=64px):**
  - Слева: `Logo` (`380:347`).
  - Навигационные элементы (`372:664`): пункты озаглавлены строго **`Player`**, **`Podcasts`**, **`Abooks`**, **`Settings`** (активный пункт выделен фоном `bg-secondary` `#f4f4f5` и полужирным начертанием `Inter:Semi_Bold`).
  - Справа: кнопка действия `+ Add` (`372:699`) с иконкой `hugeicons/plus-sign-square`.
- **Фактическая реализация (`frontend/src/components/mpod/top-nav.tsx`):**
  - Полное визуальное совпадение: пункты меню `Player`, `Podcasts`, `Abooks`, `Settings` и кнопка `+ Add`.
  - Отступы (h=64px, gap=28px), шрифты, цвета фона и кнопки идентичны макету.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/topnav-figma.png](docs/audit-assets/topnav-figma.png)
  - Actual: [docs/audit-assets/topnav-actual.png](docs/audit-assets/topnav-actual.png)

### 2.3. AppShell (Figma node `374:295` vs `app-shell.tsx`)
- **Figma (узел `374:295`):** Корневой контейнер 1440x900 с верхней панелью `TopNav`, центральной областью шириной 1200px, заголовком страницы `Subscriptions`, подзаголовком `Short description`, кнопками действий `Refresh all` и `Show all`, и карточным контейнером контента с рамкой.
- **Фактическая реализация (`frontend/src/components/mpod/app-shell.tsx`):** Полное визуальное соответствие иерархии разметки, ограничениям ширины, расположению кнопок действий и цветовым токенам темы на холсте 1440x900.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/appshell-figma.png](docs/audit-assets/appshell-figma.png)
  - Actual: [docs/audit-assets/appshell-actual.png](docs/audit-assets/appshell-actual.png)

### 2.4. AuthShell и AuthCard (Figma node `343:348` vs `auth-shell.tsx`, `auth-card.tsx`)
- **Figma (узел `343:348`):** Десктопный экран 1440x900:
  - Слева: логотип `mpod` и заголовок `Create the only account for your podcast library`.
  - Справа: карточка `Create your account` с полями ввода `Username` (`Choose a username`), `Password` (`Create a password`) с зелёной иконкой видимости пароля и кнопка `Create account`.
- **Фактическая реализация (`frontend/src/components/mpod/auth-shell.tsx`, `auth-card.tsx`):** Полное визуальное совпадение десктопного макета регистрации, заголовков, плейсхолдеров, иконки глаза в поле ввода пароля и кнопки подтверждения.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/auth-figma.png](docs/audit-assets/auth-figma.png)
  - Actual: [docs/audit-assets/auth-actual.png](docs/audit-assets/auth-actual.png)

### 2.5. Player (Figma node `462:2515` vs `player.tsx`)
- **Figma (узел `462:2515`):**
  - Карточка плеера шириной 480px, скруглённая обложка выпуска.
  - Название трека: `Why store loyalty cards became a UX minefield`, подзаголовок: `Decoder Ring`.
  - Таймлайн: `23:14` / `14:03`, прогресс 62%, кнопка Play в зелёном круге, кнопки перемотки `-15` и `+30`.
  - Ссылки управления: скорость `Speed 1.5x` и кнопка действий **`Show chapters`**.
- **Фактическая реализация (`frontend/src/components/mpod/player.tsx`):**
  - Скорость на скриншотах совпадает (`Speed 1.5x`).
  - **Критическое расхождение:** В Figma для данного выпуска подкаста отображается кнопка **`Show chapters`**. В production-компоненте `Player` режим подкаста (`mode !== "audiobook"`) жестко рендерит **`Show notes`** (`showNotesButton = !isAudiobook`, а `showChaptersButton = isAudiobook && Boolean(hasChapters)`). В соответствии с правилами аудита подкаст не переключался в режим аудиокниги. Документального решения об изменении надписи кнопки нет.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/player-figma.png](docs/audit-assets/player-figma.png)
  - Actual: [docs/audit-assets/player-actual.png](docs/audit-assets/player-actual.png)

### 2.6. PlaylistQueue и EpisodeRow (Figma node `472:520` vs `playlist-queue.tsx`, `episode-row.tsx`)
- **Figma (узел `472:520`):**
  - Шапка списка: `3 episodes · 2h 13m`.
  - 3 строки выпусков: Drag-handle, обложка, название, подзаголовок, длительность (`54m`, `36m`, `43m`), действия Play/Pause и Remove from playlist.
  - В Figma на каждой строке отображаются иконки статуса скачивания выпуска.
- **Фактическая реализация и утверждённое отличие:**
  - В actual-рендеринге иконки скачивания отсутствуют.
  - **Основание согласованного отличия:** `docs/product-decisions.md#L910`: *"Download status indicators (downloaded badge/icon) are removed from all UI views (playlist and podcast episode lists). Downloaded files continue to be managed automatically in the background as disposable local copies, but no download icon is displayed in the user interface."*
  - Форматирование длительности унифицировано через `formatDuration`. Лишняя обёртка-карточка удалена из preview.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/queue-figma.png](docs/audit-assets/queue-figma.png)
  - Actual: [docs/audit-assets/queue-actual.png](docs/audit-assets/queue-actual.png)

### 2.7. AddPodcast (Figma node `521:540` vs `add-podcast.tsx`)
- **Figma (узел `521:540`, сет `AddPodcast-desktop` 1488x473):**
  - Состояние 1 (`Mode=RSS Feed URL`): поле ввода URL, кнопки Cancel и Add Feed.
  - Состояние 2 (`Mode=Import OPML File`): зона дропзоны, кнопка Cancel и **активная кнопка действия с текстом `Import file`**.
- **Фактическая реализация (`frontend/src/components/mpod/add-podcast.tsx`):**
  - Состояние 1 (RSS) совпадает.
  - **Критическое расхождение:** В состоянии OPML production-компонент `add-podcast.tsx` (строки 181, 193-196) рендерит **заблокированную (disabled)** кнопку с неизменным текстом **`Add Feed`** (`disabled={disabled || (isOpml && !opmlFile)}`). Текст `Import file` в коде компонента отсутствует. Production-компонент не изменялся.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/addpodcast-figma.png](docs/audit-assets/addpodcast-figma.png)
  - Actual: [docs/audit-assets/addpodcast-actual.png](docs/audit-assets/addpodcast-actual.png)

### 2.8. FileDropzone (Figma node `517:504` vs `file-dropzone.tsx`)
- **Figma (узел `517:504`):** Самостоятельный компонент дропзоны 265x232px с пунктирной зелёной рамкой (`border-primary border-dashed`), иконкой выгрузки файла, заголовком `Drag and drop your file` и ссылкой `Browse files`.
- **Фактическая реализация (`frontend/src/components/mpod/file-dropzone.tsx`):** Полное совпадение визуального оформления и размеров. Искусственная карточная рамка вокруг превью-контейнера полностью удалена.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filedropzone-figma.png](docs/audit-assets/filedropzone-figma.png)
  - Actual: [docs/audit-assets/filedropzone-actual.png](docs/audit-assets/filedropzone-actual.png)

### 2.9. ShowNotes (Figma node `544:1104` vs `show-notes.tsx`)
- **Figma (узел `544:1104`):** Карточка заметок выпуска 720px с полным текстом описания из 6 абзацев, кнопкой закрытия и выделенным графическим элементом скроллбара (`Visible Scrollbar`, ширина 6px, подложка `#f4f4f5`, ползунок `#696867` высотой 116px).
- **Фактическая реализация (`frontend/src/components/mpod/show-notes.tsx`):**
  - В preview передан полный текст из 6 абзацев из Figma, приводящий контейнер к переполнению.
  - **Оставшиеся расхождения:**
    1. Отрисовка скроллбара: в production-компоненте используется стандартный браузерный контейнер `overflow-y-auto`, в котором скроллбар в WebKit/Blink появляется только при активной прокрутке, тогда как в Figma задан статически видимый стилизованный скроллбар.
    2. Высота карточки и отступы: карточка в коде имеет адаптивную высоту `max-h-[408px]` для текста и общую высоту ~552px против 560px в макете.
    3. Документального согласования расхождения стилизации скроллбара нет.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/shownotes-figma.png](docs/audit-assets/shownotes-figma.png)
  - Actual: [docs/audit-assets/shownotes-actual.png](docs/audit-assets/shownotes-actual.png)

### 2.10. ModalScreen (Figma node `544:1399` vs `modal-screen.tsx`, `show-notes.tsx`)
- **Figma (узел `544:1399`):** Полноэкранный модальный экран 1440x900 с открытой карточкой Show Notes на затенённом фоне (backdrop).
- **Фактическая реализация (`frontend/src/components/mpod/modal-screen.tsx`):**
  - Случайный фокус на кнопке закрытия, фокусное кольцо (focus ring) и всплывающий тултип `Close` устранены при захвате кадра.
  - **Оставшиеся расхождения:**
    1. Плотность и тон затемнения фона: в Figma подложка представляет собой равномерный глубокий оверлей без размытия, тогда как `modal-screen.tsx` использует `DialogPrimitive.Overlay` со стилем `bg-foreground/30 backdrop-blur-[2px]`.
    2. Наследование отличий внутренней карточки ShowNotes (стилизация скроллбара и высота).
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/modalscreen-figma.png](docs/audit-assets/modalscreen-figma.png)
  - Actual: [docs/audit-assets/modalscreen-actual.png](docs/audit-assets/modalscreen-actual.png)

### 2.11. PodcastCard (Figma node `694:2836` vs `podcast-card.tsx`)
- **Figma (узел `694:2836`, фрейм 688x460):** Две карточки подкаста (Default и Selected):
  - Обе карточки содержат строку счётчика непрослушанных выпусков: **`2 unlistened episodes`**.
  - Выбранная карточка (`Property 1=Selected`) имеет **яркую зелёную рамку** (`border-primary`, `#5EA500`).
- **Фактическая реализация (`frontend/src/components/mpod/podcast-card.tsx`):**
  - **Расхождение 1:** В пропсах и разметке компонента полностью отсутствует поддержка счётчика непрослушанных выпусков (`2 unlistened episodes`).
  - **Расхождение 2:** При `selected={true}` компонент применяет класс `bg-accent` (серый фон), но не меняет цвет рамки на зелёный.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/podcastcard-figma.png](docs/audit-assets/podcastcard-figma.png)
  - Actual: [docs/audit-assets/podcastcard-actual.png](docs/audit-assets/podcastcard-actual.png)

### 2.12. FileManager (Figma node `1285:8972` vs `filemanager-item.tsx`, `breadcrumb.tsx`)
- **Figma (узел `1285:8972`):**
  - Навигационная цепочка хлебных крошек `Abooks > ... > Some abooks > New abooks`.
  - 3 строки элементов:
    1. `Folder with abooks` (папка, без кнопок действий).
    2. `Folder with audiobook chapters` (`43h 12m`, кнопка добавления в плейлист).
    3. `A story.mp3` (`1h 24m`, кнопка добавления в плейлист).
- **Фактическая реализация (`frontend/src/components/mpod/filemanager-item.tsx`, `breadcrumb.tsx`):**
  - Искусственная карточная рамка удалена из preview.
  - Композиция хлебных крошек и строк элементов с обработчиками `onTogglePlaylist` полностью визуально соответствует макету Figma.
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filemanager-figma.png](docs/audit-assets/filemanager-figma.png)
  - Actual: [docs/audit-assets/filemanager-actual.png](docs/audit-assets/filemanager-actual.png)

### 2.13. AbookChapter (Figma node `1309:11657` vs `audiobook-playback-chapters-modal.tsx`)
- **Figma (узел `1309:11657`):** Модальное окно глав аудиокниги 730x566px:
  - Обложка книги (иллюстрация фэнтези), заголовок `Abook title`, автор `Author`, кнопка закрытия.
  - Главы: `Chapter1.mp3` (прослушано, `ReplayIcon`), `Chapter2.mp3` (воспроизведение, прогресс **`12m / 24m`**, `PauseIcon`), `Chapter3.mp3`–`Chapter6.mp3` с длительностями `45m`, `30m`, `50m`, `15m` и кнопками `PlayIcon`.
- **Фактическая реализация (`frontend/src/components/mpod/audiobook-playback-chapters-modal.tsx`):**
  - В preview скорректирована длительность трека (`currentDurationSeconds={1440}`), благодаря чему текущий трек отображает точное значение **`12m / 24m`**.
  - Устранены паразитные focus ring и tooltip.
  - **Оставшиеся расхождения:**
    1. Обложка: компонент запрашивает обложку через API бэкенда (`api.audiobooks.coverUrl`), а при её отсутствии отображает стандартный плейсхолдер `/audiobook-fallback.png` (иконка наушников на книге), тогда как в Figma продемонстрирована конкретная графическая обложка.
    2. Реализация скроллбара: в Figma нарисован статический ползунок, в компоненте используется Radix `ScrollArea`.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/abookchapter-figma.png](docs/audit-assets/abookchapter-figma.png)
  - Actual: [docs/audit-assets/abookchapter-actual.png](docs/audit-assets/abookchapter-actual.png)

---

## 3. Сводная таблица 13 пар аудита и их статусов

| № | Компонент / Экран | Узел Figma (`Ready for dev`) | Реализация в кодовой базе | Статус | Основание / Причина отличия |
|---|---|---|---|---|---|
| 1 | **Logo** | `317:1293` | `logo.tsx` | **PASS** | Полное визуальное и структурное соответствие контуров и цветов SVG. |
| 2 | **TopNav** | `372:643` | `top-nav.tsx` | **PASS** | Полное визуальное соответствие: наименования (`Player`, `Podcasts`, `Abooks`, `Settings`), кнопка `+ Add`, шрифты и отступы. |
| 3 | **AppShell** | `374:295` | `app-shell.tsx` | **PASS** | Полное визуальное соответствие десктопного лейаута 1440x900, шапки, кнопок и карточки контента. |
| 4 | **AuthShell / AuthCard** | `343:348` | `auth-shell.tsx`, `auth-card.tsx` | **PASS** | Полное визуальное соответствие десктопного экрана регистрации 1440x900, полей ввода, иконки глаза и кнопки подтверждения. |
| 5 | **Player** | `462:2515` | `player.tsx` | **FAIL** | В Figma показана кнопка `Show chapters`; production-компонент в режиме подкаста рендерит `Show notes`. Скорость на обоих снимках `1.5x`. |
| 6 | **PlaylistQueue / EpisodeRow** | `472:520` | `playlist-queue.tsx`, `episode-row.tsx` | **APPROVED DIFFERENCE** | Иконки скачивания скрыты согласно [docs/product-decisions.md#L910](docs/product-decisions.md#L910). Время унифицировано. |
| 7 | **AddPodcast** | `521:540` | `add-podcast.tsx` | **FAIL** | В OPML-состоянии Figma требует активную кнопку `Import file`; production-компонент рендерит заблокированную кнопку `Add Feed`. |
| 8 | **FileDropzone** | `517:504` | `file-dropzone.tsx` | **PASS** | Полное визуальное соответствие изолированного компонента 265x232px с пунктирной рамкой. |
| 9 | **ShowNotes** | `544:1104` | `show-notes.tsx` | **FAIL** | Текст переполняет карточку, но скроллбар остаётся браузерным нативным вместо статически видимого ползунка Figma; отличия по высоте карточки. |
| 10 | **ModalScreen** | `544:1399` | `modal-screen.tsx`, `show-notes.tsx` | **FAIL** | Отличие плотности затемнения фона (backdrop) и наследование расхождений внутренней карточки ShowNotes. |
| 11 | **PodcastCard** | `694:2836` | `podcast-card.tsx` | **FAIL** | Отсутствует счётчик `2 unlistened episodes`; выбранное состояние не имеет зелёной рамки (`border-primary`). |
| 12 | **FileManager** | `1285:8972` | `filemanager-item.tsx`, `breadcrumb.tsx` | **PASS** | Хлебные крошки и 3 строки элементов библиотеки соответствуют макету Figma 1040px. |
| 13 | **AbookChapter** | `1309:11657` | `audiobook-playback-chapters-modal.tsx` | **FAIL** | Время `12m / 24m` скорректировано, но обложка остаётся дефолтным плейсхолдером `/audiobook-fallback.png` вместо иллюстрации; скроллбар нативный. |

---

## 4. Итоговое заключение

Визуальная сверка компонентов секции `Ready for dev` (`538:933`) завершена с итоговым статусом **FAIL**.

- Из 13 проверяемых узлов:
  - **6 компонентов получили статус PASS:** Logo, TopNav, AppShell, AuthShell/AuthCard, FileDropzone, FileManager.
  - **1 компонент получил статус APPROVED DIFFERENCE:** PlaylistQueue (на основании утверждённого решения [docs/product-decisions.md#L910](docs/product-decisions.md#L910)).
  - **6 компонентов получили статус FAIL:** Player, AddPodcast, ShowNotes, ModalScreen, PodcastCard, AbookChapter.

Аудит признан честным и открытым: production-компоненты намеренно не искажались и не изменялись ради фиктивного совпадения. Задача остаётся в статусе FAIL до реализации соответствующих доработок в коде компонентов или принятия официальных продуктовых решений.
