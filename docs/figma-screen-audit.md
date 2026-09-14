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
- Production-компоненты не модифицируются ради фиктивного прохождения аудита. Если поведение или верстка реального компонента отличается от Figma, такое отличие открыто фиксируется со статусом `FAIL`.
- Статус `APPROVED DIFFERENCE` выставляется только при наличии точной ссылки на утверждённый документ (`docs/product-decisions.md`) или явное решение пользователя. Если у компонента есть как согласованные, так и несогласованные отличия, общий статус компонента фиксируется как `FAIL`.

---

## 2. Покомпонентная сверка и визуальные пары

### 2.1. Logo (Figma node `317:1293` vs `logo.tsx`)
- **Figma (узел `317:1293`):** Фирменный знак `mpod` с характерной стилизацией радиоволн, точные размеры узла: **124x45 px**.
- **Фактическая реализация (`frontend/src/components/mpod/logo.tsx`):** Геометрия контуров и цвета темы совпадают, однако в коде production-компонента жестко заданы классы `h-11 w-[123px]`, в результате чего Actual-компонент рендерится с размерами **123x44 px** (отличие на 1 px по ширине и высоте).
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/logo-figma.png](docs/audit-assets/logo-figma.png) (124x45)
  - Actual: [docs/audit-assets/logo-actual.png](docs/audit-assets/logo-actual.png) (123x44)

### 2.2. TopNav (Figma node `372:643` vs `top-nav.tsx`)
- **Figma (узел `372:643`, Desktop, 1440px с центрированным контейнером 1200px, h=64px):**
  - Слева: `Logo` (`380:347`).
  - Навигационные элементы (`372:664`): пункты озаглавлены строго **`Player`**, **`Podcasts`**, **`Abooks`**, **`Settings`** (активный пункт выделен фоном `bg-secondary` `#f4f4f5` и полужирным начертанием `Inter:Semi_Bold`).
  - Справа: кнопка действия `+ Add` (`372:699`) с иконкой `hugeicons/plus-sign-square`.
- **Фактическая реализация (`frontend/src/components/mpod/top-nav.tsx`):**
  - Полное визуальное и геометрическое совпадение: пункты меню `Player`, `Podcasts`, `Abooks`, `Settings` и кнопка `+ Add`.
  - Отступы (h=64px, gap=28px), шрифты, цвета фона и кнопки идентичны макету. Размеры совпадают 1:1 (**1440x64 px**).
- **Статус:** `PASS`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/topnav-figma.png](docs/audit-assets/topnav-figma.png) (1440x64)
  - Actual: [docs/audit-assets/topnav-actual.png](docs/audit-assets/topnav-actual.png) (1440x64)

### 2.3. AppShell (Figma node `374:295` vs `app-shell.tsx`)
- **Figma (узел `374:295`, 1440x900 px):** Верхняя панель `TopNav`, под ней область контента 1200px, где заголовок `Subscriptions`, подзаголовок `Short description`, кнопки действий `Refresh all` и `Show all`, а также контентная область находятся **внутри единой большой рамки/карточки**.
- **Фактическая реализация (`frontend/src/components/mpod/app-shell.tsx`):**
  - **Структурное расхождение:** Заголовок страницы и кнопки действий вынесены в `PageHeader` над рамкой контента. В рамку заключён только дочерний контент (`children`), а не весь экранный блок с заголовком и кнопками.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/appshell-figma.png](docs/audit-assets/appshell-figma.png) (1440x900)
  - Actual: [docs/audit-assets/appshell-actual.png](docs/audit-assets/appshell-actual.png) (1440x900)

### 2.4. AuthShell и AuthCard (Figma node `343:348` vs `auth-shell.tsx`, `auth-card.tsx`)
- **Figma (узел `343:348`, 1440x900 px):** Десктопный экран регистрации:
  - Слева: логотип `mpod` и заголовок `Create the only account for your podcast library`, выровненные по вертикальному центру относительно правой карточки.
  - Справа: центрированная карточка `Create your account` с полями ввода `Username` (`Choose a username`), `Password` (`Create a password`) с иконкой глаза и зелёная кнопка `Create account`.
- **Фактическая реализация (`frontend/src/components/mpod/auth-shell.tsx`, `auth-card.tsx`):**
  - Карточка справа совпадает по составу и стилям.
  - **Расхождение:** Левый блок с Logo и заголовком в Actual расположен с фиксированным верхним отступом (`items-start` с `py-5 md:items-center lg:flex-row`) и визуально находится заметно выше, чем в Figma, где левая текстовая колонка строго сцентрирована по высоте правой формы.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/auth-figma.png](docs/audit-assets/auth-figma.png) (1440x900)
  - Actual: [docs/audit-assets/auth-actual.png](docs/audit-assets/auth-actual.png) (1440x900)

### 2.5. Player (Figma node `462:2515` vs `player.tsx`)
- **Figma (узел `462:2515`, 484x462 px):**
  - Карточка плеера, обложка, название трека: `Why store loyalty cards became a UX minefield`, подзаголовок: `Decoder Ring`.
  - Таймлайн: `23:14` / `14:03`, прогресс 62%, кнопка Play, кнопки перемотки `-15` и `+30`.
  - Нижние ссылки управления: скорость `Speed 1.5x` и кнопка действий **`Show chapters`**.
- **Фактическая реализация (`frontend/src/components/mpod/player.tsx`):**
  - Скорость на скриншотах совпадает (`Speed 1.5x`).
  - **Расхождение 1 (надпись кнопки):** В Figma для данного выпуска подкаста отображается кнопка **`Show chapters`**. В production-компоненте `Player` режим подкаста жестко рендерит **`Show notes`** (`showNotesButton = !isAudiobook`, а `showChaptersButton = isAudiobook && Boolean(hasChapters)`).
  - **Расхождение 2 (размеры):** Размеры фрейма в Figma составляют **484x462 px**, а фактический размер production-карточки — **480x458 px**.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/player-figma.png](docs/audit-assets/player-figma.png) (484x462)
  - Actual: [docs/audit-assets/player-actual.png](docs/audit-assets/player-actual.png) (480x458)

### 2.6. PlaylistQueue и EpisodeRow (Figma node `472:520` vs `playlist-queue.tsx`, `episode-row.tsx`)
- **Figma (узел `472:520`, 1044x275 px):**
  - Шапка списка: `3 episodes · 2h 13m`.
  - 3 строки выпусков в виде единого плоского списка с тонкими разделителями строк. Заголовки строго прижаты влево рядом с обложкой. Подзаголовки имеют нейтральный серый цвет. На строках отображаются иконки статуса скачивания.
- **Фактическая реализация и различия:**
  - **Согласованная часть различий:** Иконки статуса скачивания отсутствуют на основании утверждённого решения [docs/product-decisions.md#L910](docs/product-decisions.md#L910) (*"Download status indicators (downloaded badge/icon) are removed from all UI views"*).
  - **Несогласованное расхождение 1 (выравнивание):** Заголовки выпусков в Actual смещены ближе к центру строки вместо левого выравнивания рядом с обложкой.
  - **Несогласованное расхождение 2 (цвет подзаголовка):** Подзаголовок в коде окрашен в зелёный цвет темы (`text-primary` / `#5EA500`), тогда как в Figma он нейтральный серый (`text-muted-foreground`).
  - **Несогласованное расхождение 3 (структура строк):** В Actual каждая строка выпущена в виде отдельной скруглённой карточки (`rounded-sm` с тенью `shadow-xs`), тогда как в Figma это сплошной плоский список с линиями-разделителями.
  - **Несогласованное расхождение 4 (размеры):** 1044x275 px в Figma против 1040x272 px в Actual.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/queue-figma.png](docs/audit-assets/queue-figma.png) (1044x275)
  - Actual: [docs/audit-assets/queue-actual.png](docs/audit-assets/queue-actual.png) (1040x272)

### 2.7. AddPodcast (Figma node `521:540` vs `add-podcast.tsx`)
- **Figma (узел `521:540`, сет `AddPodcast-desktop` 1488x473 px):**
  - Состояние 1 (`Mode=RSS Feed URL`): поле ввода URL, кнопки Cancel и Add Feed.
  - Состояние 2 (`Mode=Import OPML File`): зона дропзоны, кнопка Cancel и **активная кнопка действия с текстом `Import file`**.
- **Фактическая реализация (`frontend/src/components/mpod/add-podcast.tsx`):**
  - Состояние 1 (RSS) совпадает.
  - **Критическое расхождение:** В состоянии OPML production-компонент `add-podcast.tsx` рендерит **заблокированную (disabled)** кнопку с неизменным текстом **`Add Feed`** (`disabled={disabled || (isOpml && !opmlFile)}`). Текст `Import file` в коде компонента отсутствует.
  - **Размеры:** 1488x473 px в Figma против 1486x473 px в Actual.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/addpodcast-figma.png](docs/audit-assets/addpodcast-figma.png) (1488x473)
  - Actual: [docs/audit-assets/addpodcast-actual.png](docs/audit-assets/addpodcast-actual.png) (1486x473)

### 2.8. FileDropzone (Figma node `517:504` vs `file-dropzone.tsx`)
- **Figma (узел `517:504`):** Самостоятельный компонент дропзоны размером **265x232 px** с пунктирной зелёной рамкой (`border-primary border-dashed`), иконкой выгрузки файла, заголовком `Drag and drop your file` и ссылкой `Browse files`.
- **Фактическая реализация (`frontend/src/components/mpod/file-dropzone.tsx`):**
  - Оформление, иконки и тексты соответствуют макету.
  - **Расхождение по высоте (2 px):** В Actual компонент рендерится с размером **265x234 px** (на 2 px выше макета) из-за внутренних отступов `p-6`, размеров иконки `size-20` (80px), межстрочных промежутков `gap` и кнопки `h-9`.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filedropzone-figma.png](docs/audit-assets/filedropzone-figma.png) (265x232)
  - Actual: [docs/audit-assets/filedropzone-actual.png](docs/audit-assets/filedropzone-actual.png) (265x234)

### 2.9. ShowNotes (Figma node `544:1104` vs `show-notes.tsx`)
- **Figma (узел `544:1104`, 730x560 px):** Карточка заметок выпуска фиксированной высоты 560px с точным текстом из 4 абзацев, кнопкой закрытия и выделенным статическим скроллбаром (`Visible Scrollbar`, ширина 6px, подложка `#f4f4f5`, ползунок `#696867` высотой 116px).
- **Фактическая реализация (`frontend/src/components/mpod/show-notes.tsx`):**
  - В превью используются строго 4 абзаца из Figma без искусственных дополнений.
  - **Расхождение 1 (высота и скроллбар):** При естественном объёме 4 абзацев текст полностью помещается в блок без переполнения, поэтому карточка рендерится с естественной высотой **480 px** (против 560 px в Figma), а браузерный скроллбар не активируется. В Figma же карточка имеет фиксированную высоту 560 px с нарисованным постоянным элементом скроллбара.
  - **Расхождение 2 (размеры):** 730x560 px в Figma против 720x480 px в Actual.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/shownotes-figma.png](docs/audit-assets/shownotes-figma.png) (730x560)
  - Actual: [docs/audit-assets/shownotes-actual.png](docs/audit-assets/shownotes-actual.png) (720x480)

### 2.10. ModalScreen (Figma node `544:1399` vs `modal-screen.tsx`, `show-notes.tsx`)
- **Figma (узел `544:1399`, 1440x900 px):** Полноэкранный модальный экран 1440x900 с карточкой Show Notes на глубоко затенённом фоне (backdrop).
- **Фактическая реализация (`frontend/src/components/mpod/modal-screen.tsx`):**
  - Случайный фокус на кнопке закрытия, фокусное кольцо и тултип `Close` устранены при захвате кадра. Контент содержит точные 4 абзаца.
  - **Расхождение 1 (затемнение фона):** В Figma фон представляет собой плотный равномерный тёмный оверлей, тогда как `modal-screen.tsx` использует полупрозрачный `DialogPrimitive.Overlay` со стилем `bg-foreground/30 backdrop-blur-[2px]`.
  - **Расхождение 2 (карточка контента):** Наследуются расхождения внутренней карточки ShowNotes (высота 480 px вместо 560 px, отсутствие статического скроллбара).
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/modalscreen-figma.png](docs/audit-assets/modalscreen-figma.png) (1440x900)
  - Actual: [docs/audit-assets/modalscreen-actual.png](docs/audit-assets/modalscreen-actual.png) (1440x900)

### 2.11. PodcastCard (Figma node `694:2836` vs `podcast-card.tsx`)
- **Figma (узел `694:2836`, фрейм 688x460 px):** Две карточки подкаста (Default и Selected):
  - Обе карточки содержат строку счётчика: **`2 unlistened episodes`**.
  - Выбранная карточка (`Property 1=Selected`) имеет **яркую зелёную рамку** (`border-primary`, `#5EA500`).
- **Фактическая реализация (`frontend/src/components/mpod/podcast-card.tsx`):**
  - **Расхождение 1:** В коде компонента полностью отсутствует поддержка счётчика непрослушанных выпусков (`2 unlistened episodes`).
  - **Расхождение 2:** При `selected={true}` компонент применяет класс `bg-accent` (серый фон), но не меняет цвет рамки на зелёный.
  - **Расхождение 3 (размеры):** 688x460 px в Figma против 688x420 px в Actual (из-за отсутствия строки счётчика высота карточки меньше на 40 px).
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/podcastcard-figma.png](docs/audit-assets/podcastcard-figma.png) (688x460)
  - Actual: [docs/audit-assets/podcastcard-actual.png](docs/audit-assets/podcastcard-actual.png) (688x420)

### 2.12. FileManager (Figma node `1285:8972` vs `filemanager-item.tsx`, `breadcrumb.tsx`)
- **Figma (узел `1285:8972`, 1044x275 px):**
  - Хлебные крошки `Abooks > ... > Some abooks > New abooks`.
  - 3 строки элементов библиотеки внутри **единой общей внешней рамки** в виде плоского списка с разделителями.
- **Фактическая реализация (`frontend/src/components/mpod/filemanager-item.tsx`, `breadcrumb.tsx`):**
  - **Структурное расхождение 1:** В Actual общая внешняя рамка отсутствует; каждая строка `FileManagerItem` рендерится как обособленная карточка с собственными скруглёнными углами, границей и тенью.
  - **Расхождение 2 (размеры):** 1044x275 px в Figma против 1040x276 px в Actual.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filemanager-figma.png](docs/audit-assets/filemanager-figma.png) (1044x275)
  - Actual: [docs/audit-assets/filemanager-actual.png](docs/audit-assets/filemanager-actual.png) (1040x276)

### 2.13. AbookChapter (Figma node `1309:11657` vs `audiobook-playback-chapters-modal.tsx`)
- **Figma (узел `1309:11657`, 730x566 px):** Модальное окно глав аудиокниги:
  - Обложка книги (иллюстрация фэнтези), заголовок `Abook title`, автор `Author`, кнопка закрытия.
  - Главы: `Chapter1.mp3` (прослушано, `ReplayIcon`), `Chapter2.mp3` (воспроизведение, прогресс **`12m / 24m`**, `PauseIcon`), `Chapter3.mp3`–`Chapter6.mp3` с длительностями `45m`, `30m`, `50m`, `15m` и кнопками `PlayIcon`.
- **Фактическая реализация (`frontend/src/components/mpod/audiobook-playback-chapters-modal.tsx`):**
  - Прогресс трека отображает точные `12m / 24m`. Тултипы и фокус сняты.
  - **Расхождение 1 (обложка):** Компонент отображает стандартный плейсхолдер `/audiobook-fallback.png` (иконка наушников на книге) вместо графической иллюстрации обложки из Figma.
  - **Расхождение 2 (скроллбар):** Используется Radix `ScrollArea` вместо статического элемента скролла.
  - **Расхождение 3 (размеры):** 730x566 px в Figma против 720x556 px в Actual.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/abookchapter-figma.png](docs/audit-assets/abookchapter-figma.png) (730x566)
  - Actual: [docs/audit-assets/abookchapter-actual.png](docs/audit-assets/abookchapter-actual.png) (720x556)

---

## 3. Сводная таблица 13 пар аудита и их статусов

| № | Компонент / Экран | Узел Figma (`Ready for dev`) | Размеры Figma | Размеры Actual | Статус | Причина отличия / Согласованность |
|---|---|---|---|---|---|---|
| 1 | **Logo** | `317:1293` | 124x45 | 123x44 | **FAIL** | Отличие размеров: 124x45 против 123x44 из-за жестких классов `h-11 w-[123px]` в `logo.tsx`. |
| 2 | **TopNav** | `372:643` | 1440x64 | 1440x64 | **PASS** | Полное визуальное и структурное соответствие: наименования, кнопка `+ Add`, шрифты и отступы 1440x64px. |
| 3 | **AppShell** | `374:295` | 1440x900 | 1440x900 | **FAIL** | Структурное отличие: в Figma заголовок, кнопки и контент внутри общей рамки; в Actual заголовок и кнопки вынесены над рамкой контента. |
| 4 | **AuthShell / AuthCard** | `343:348` | 1440x900 | 1440x900 | **FAIL** | Вертикальное смещение: левый блок Logo и слогана в Actual расположен заметно выше по вертикали, чем в Figma. |
| 5 | **Player** | `462:2515` | 484x462 | 480x458 | **FAIL** | В Figma кнопка `Show chapters`; в коде для подкаста рендерится `Show notes`. Размеры 484x462 против 480x458. |
| 6 | **PlaylistQueue / EpisodeRow** | `472:520` | 1044x275 | 1040x272 | **FAIL** | Отсутствие download icons согласовано по `docs/product-decisions.md:910`. Не согласованы: смещение заголовков к центру, цвет подзаголовка, скруглённые карточки вместо плоского списка, размеры 1044x275 против 1040x272. |
| 7 | **AddPodcast** | `521:540` | 1488x473 | 1486x473 | **FAIL** | В OPML-режиме кнопка в Figma активна и озаглавлена `Import file`; в коде заблокирована с текстом `Add Feed`. Размеры 1488x473 против 1486x473. |
| 8 | **FileDropzone** | `517:504` | 265x232 | 265x234 | **FAIL** | Отличие по высоте на 2 px (265x232 против 265x234) из-за внутренних отступов и размеров элементов в `file-dropzone.tsx`. |
| 9 | **ShowNotes** | `544:1104` | 730x560 | 720x480 | **FAIL** | Содержит точные 4 абзаца из Figma. Отличия: естественная высота 480px без скроллбара против фиксированной высоты 560px со статическим скроллбаром Figma. Размеры 730x560 против 720x480. |
| 10 | **ModalScreen** | `544:1399` | 1440x900 | 1440x900 | **FAIL** | Отличие плотности затемнения фона (`DialogPrimitive.Overlay` с backdrop-blur); наследование отличий ShowNotes (высота 480px, отсутствие статического скроллбара). |
| 11 | **PodcastCard** | `694:2836` | 688x460 | 688x420 | **FAIL** | Отсутствует строка `2 unlistened episodes`; выбранное состояние не имеет зелёной рамки `border-primary`. Размеры 688x460 против 688x420. |
| 12 | **FileManager** | `1285:8972` | 1044x275 | 1040x276 | **FAIL** | В Figma плоский список внутри общей внешней рамки; в Actual отдельные скруглённые строки с карточными границами/тенями без общей рамки. Размеры 1044x275 против 1040x276. |
| 13 | **AbookChapter** | `1309:11657` | 730x566 | 720x556 | **FAIL** | Обложка отображает плейсхолдер `/audiobook-fallback.png` вместо графической иллюстрации; скроллбар `ScrollArea` вместо статического. Размеры 730x566 против 720x556. |

---

## 4. Итоговое заключение

Визуальная сверка компонентов секции `Ready for dev` (`538:933`) завершена с итоговым статусом **FAIL**.

- Из 13 проверяемых компонентов:
  - **1 компонент получил статус PASS:** TopNav (узел `372:643`) — полное визуальное соответствие и точные размеры 1440x64 px.
  - **12 компонентов получили статус FAIL:** Logo, AppShell, Auth, Player, PlaylistQueue, AddPodcast, FileDropzone, ShowNotes, ModalScreen, PodcastCard, FileManager, AbookChapter.
  - В компоненте **PlaylistQueue** отсутствие иконок статуса скачивания выпусков подтверждено утверждённым продуктовым решением [docs/product-decisions.md#L910](docs/product-decisions.md#L910), однако наличие иных несогласованных визуальных и структурных отличий (центрирование заголовков, цвет подзаголовка, скруглённые карточки, габариты) переводит общий статус компонента в **FAIL**.

Аудит отражает фактическое состояние кодовой базы: production-компоненты не подгонялись под скриншоты, все реальные расхождения зафиксированы с указанием их причин.
