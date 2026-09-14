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

---

## 2. Покомпонентная сверка и визуальные пары

### 2.1. Logo (Figma node `317:1293` vs `logo.tsx`)
- **Figma (узел `317:1293`):** Фирменный знак `mpod` с характерной стилизацией радиоволн.
- **Фактическая реализация (`frontend/src/components/mpod/logo.tsx`):** Полное соответствие геометрии SVG-контуров, цветам темы (`#09090B` / `#5EA500`) и адаптивным размерам (`default` / `sm`).
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
  - Пункты меню совпадают: `[{ label: "Player", href: "/home" }, { label: "Podcasts", href: "/subscriptions" }, { label: "Abooks", href: "/audiobooks" }, { label: "Settings", href: "/settings" }]`.
  - Кнопка действия: `<Button variant="secondary" onClick={onAdd}><HugeiconsIcon icon={PlusSignSquareIcon} /> Add</Button>`.
  - Реализация навигации: код использует связку `<Button asChild variant={isActive ? "secondary" : "ghost"}><Link to={item.href}>{item.label}</Link></Button>`, где активность управляется пропсом `activeItem`. Визуальные отступы (h=64px, gap=28px, padding) и стили полностью соответствуют макету.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/topnav-figma.png](docs/audit-assets/topnav-figma.png)
  - Actual: [docs/audit-assets/topnav-actual.png](docs/audit-assets/topnav-actual.png)

### 2.3. AppShell (Figma node `374:295` vs `app-shell.tsx`)
- **Figma (узел `374:295`):** Корневой контейнер 1440x900 с верхней панелью `TopNav`, центральной областью шириной 1200px, заголовком страницы `Subscriptions`, подзаголовком `Short description`, кнопками действий `Refresh all` и `Show all`, и карточным контейнером контента с рамкой.
- **Фактическая реализация (`frontend/src/components/mpod/app-shell.tsx`):** Полное соответствие иерархии разметки, ограничениям ширины, кнопкам действий и цветовым токенам `bg-background` и `text-foreground`.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/appshell-figma.png](docs/audit-assets/appshell-figma.png)
  - Actual: [docs/audit-assets/appshell-actual.png](docs/audit-assets/appshell-actual.png)

### 2.4. AuthShell и AuthCard (Figma node `343:348` vs `auth-shell.tsx`, `auth-card.tsx`)
- **Figma (узел `343:348`):** Экран первичной регистрации/настройки аккаунта: слоган `Create the only account for your podcast library`, карточка `Create your account` с полями ввода `Username` (`Choose a username`), `Password` (`Create a password`) и кнопкой `Create account`.
- **Фактическая реализация (`frontend/src/components/mpod/auth-shell.tsx`, `auth-card.tsx`):** Полное совпадение состояния регистрации, заголовков, полей ввода и кнопки подтверждения. В коде компонента парольное поле дополнительно снабжено кнопкой переключения видимости пароля.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/auth-figma.png](docs/audit-assets/auth-figma.png)
  - Actual: [docs/audit-assets/auth-actual.png](docs/audit-assets/auth-actual.png)

### 2.5. Player (Figma node `462:2515` vs `player.tsx`)
- **Figma (узел `462:2515`):**
  - Карточка плеера шириной 484px, скруглённая обложка (Artwork).
  - Название трека: `Why store loyalty cards became a UX minefield`, подзаголовок: `Decoder Ring`.
  - Горизонтальная полоса прогресса `bg-primary`, отметки времени: `23:14` (прошедшее) и `14:03` (оставшееся).
  - Центральный круглый контрол воспроизведения в состоянии паузы (зелёная кнопка Play) и кнопки перемотки `-15` и `+30`.
  - Ссылки управления: скорость `Speed 1.5x` и вызов глав `Show chapters` с пунктирным подчёркиванием.
- **Фактическая реализация (`frontend/src/components/mpod/player.tsx`):**
  - Полное соответствие геометрии кнопок, SVG-иконкам перемотки, ссылкам управления скоростью и главами.
  - Продуктовое отличие: в приложении дефолтная скорость подкастов зафиксирована как `Speed 1.3x`, а аудиокниг — `Speed 1x` (`AGENTS.md`), тогда как в макете продемонстрировано значение `Speed 1.5x`.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/player-figma.png](docs/audit-assets/player-figma.png)
  - Actual: [docs/audit-assets/player-actual.png](docs/audit-assets/player-actual.png)

### 2.6. PlaylistQueue и EpisodeRow (Figma node `472:520` vs `playlist-queue.tsx`, `episode-row.tsx`)
- **Figma (узел `472:520`):**
  - Шапка списка: `3 episodes · 2h 13m`.
  - 3 строки выпусков:
    1. `Why store loyalty cards became a UX minefield` (активный трек, кнопка Pause, кнопка Remove).
    2. `How public transit maps teach invisible habits` (кнопка Play, кнопка Remove).
    3. `The app menu nobody understands but everyone uses` (кнопка Play, кнопка Remove).
  - У каждого элемента: Drag-handle (`hugeicons/menu-09`), обложка 40x40, заголовок, подзаголовок, длительность.
- **Фактическая реализация в коде и согласованные решения:**
  - Набор действий: строго Play/Pause и Remove from playlist (лишняя кнопка Show notes исключена).
  - Стилизация активного трека: оформлен классом `current && "bg-accent border-border"`.
  - Исключённые элементы: иконки статуса скачивания и даты публикаций удалены отовсюду в соответствии с прямым решением пользователя (13.09.2026).
  - Формат длительности: унифицирован к виду `ЧЧ:ММ` / `ММm`.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/queue-figma.png](docs/audit-assets/queue-figma.png)
  - Actual: [docs/audit-assets/queue-actual.png](docs/audit-assets/queue-actual.png)

### 2.7. AddPodcast и FileDropzone (Figma node `521:540`, `517:504` vs `add-podcast.tsx`, `file-dropzone.tsx`)
- **Figma (узлы `521:540` и `517:504`):**
  - `521:540`: Компонентный сет модального окна Add Podcast, содержащий два состояния:
    1. Вкладка `RSS Feed URL` активна, поле ввода URL, кнопки Cancel и Add Feed.
    2. Вкладка `Import OPML File` активна, пунктирная дропзона, кнопки Cancel и Import file.
  - `517:504`: Самостоятельный примитив `FileDropzone` (265x232px).
- **Фактическая реализация (`frontend/src/components/mpod/add-podcast.tsx`, `file-dropzone.tsx`):**
  - Реальный компонент `AddPodcast` поддерживает контролируемое и неконтролируемое переключение вкладок `rss` / `opml`.
  - Оба состояния сняты реальными компонентами side-by-side, дополнительно снят отдельный примитив `FileDropzone`.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma (AddPodcast): [docs/audit-assets/addpodcast-figma.png](docs/audit-assets/addpodcast-figma.png)
  - Actual (AddPodcast): [docs/audit-assets/addpodcast-actual.png](docs/audit-assets/addpodcast-actual.png)
  - Figma (FileDropzone): [docs/audit-assets/filedropzone-figma.png](docs/audit-assets/filedropzone-figma.png)
  - Actual (FileDropzone): [docs/audit-assets/filedropzone-actual.png](docs/audit-assets/filedropzone-actual.png)

### 2.8. ShowNotes и ModalScreen (Figma node `544:1104`, `544:1399` vs `show-notes.tsx`, `modal-screen.tsx`)
- **Figma (узлы `544:1104` и `544:1399`):**
  - `544:1104`: Карточка заметок выпуска шириной 720px с заголовком `Show notes`, названием выпуска, кнопкой закрытия и областью прокрутки.
  - `544:1399`: Полноэкранное модальное состояние 1440x900 с затенённым backdrop, центрированной карточкой заметок и оверлеем.
- **Фактическая реализация (`frontend/src/components/mpod/show-notes.tsx`, `modal-screen.tsx`):**
  - Реальный production-компонент `ModalScreen` на базе Radix Dialog с оверлеем `DialogPrimitive.Overlay` (`bg-foreground/30 backdrop-blur-[2px]`), центрированием контента и закрытием по оверлею/Escape.
  - `ShowNotes` рендерит карточку с линкованным текстом заметок и скроллбаром. Сняты оба артефакта: карточка `shownotes` и полноэкранное модальное состояние с backdrop `modalscreen`.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma (ShowNotes Card): [docs/audit-assets/shownotes-figma.png](docs/audit-assets/shownotes-figma.png)
  - Actual (ShowNotes Card): [docs/audit-assets/shownotes-actual.png](docs/audit-assets/shownotes-actual.png)
  - Figma (ModalScreen with Backdrop): [docs/audit-assets/modalscreen-figma.png](docs/audit-assets/modalscreen-figma.png)
  - Actual (ModalScreen with Backdrop): [docs/audit-assets/modalscreen-actual.png](docs/audit-assets/modalscreen-actual.png)

### 2.9. PodcastCard (Figma node `694:2836` vs `podcast-card.tsx`)
- **Figma (узел `694:2836`):**
  - Две карточки подкаста (обычная и выбранная с зелёной рамкой):
  - Квадратная обложка подкаста.
  - Название: `Decoder Ring`, описание: `Culture stories behind everyday design`.
  - **Счётчик непрослушанных выпусков:** текстовая строка `2 unlistened episodes`.
  - Кнопки управления: `Refresh` и `Unsubscribe`.
- **Фактическая реализация (`frontend/src/components/mpod/podcast-card.tsx`):**
  - Production-компонент `PodcastCard` содержит поля `title`, `description`, `artworkUrl`, `selected`, `refreshing`, кнопки `Refresh` и `Unsubscribe`.
  - **Критическое расхождение:** В интерфейсе пропсов `PodcastCardProps` и разметке компонента **полностью отсутствует поддержка счётчика непрослушанных выпусков** (`2 unlistened episodes`). В соответствии с правилами проекта production-компонент не модифицировался ради прохождения аудита, а добавление счётчика только в preview недопустимо.
- **Статус:** `FAIL`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/podcastcard-figma.png](docs/audit-assets/podcastcard-figma.png)
  - Actual: [docs/audit-assets/podcastcard-actual.png](docs/audit-assets/podcastcard-actual.png)

### 2.10. Filemanager Item (Figma node `1285:8972` vs `filemanager-item.tsx` и `breadcrumb.tsx`)
- **Figma (узел `1285:8972`):**
  - Хлебные крошки: `Abooks > ... > Some abooks > New abooks`.
  - 3 строки элементов:
    1. `Folder with abooks` (иконка папки, без действий).
    2. `Folder with audiobook chapters` (длительность `43h 12m`, кнопка добавления в плейлист).
    3. `A story.mp3` (длительность `1h 24m`, кнопка добавления в плейлист).
- **Фактическая реализация (`frontend/src/components/mpod/filemanager-item.tsx`, `components/ui/breadcrumb.tsx`):**
  - Реализована реальная композиция: навигационная цепочка `Breadcrumb` + три реальных строки `FileManagerItem`. При передаче обработчика `onTogglePlaylist` компонент корректно отрисовывает кнопки управления плейлистом.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filemanager-figma.png](docs/audit-assets/filemanager-figma.png)
  - Actual: [docs/audit-assets/filemanager-actual.png](docs/audit-assets/filemanager-actual.png)

### 2.11. AbookChapter (Figma node `1309:11657` vs `audiobook-playback-chapters-modal.tsx`)
- **Figma (узел `1309:11657`):** Модальное окно глав воспроизводимой аудиокниги (730x566px): обложка книги, заголовок `Abook title`, автор `Author`, кнопка закрытия, список глав:
  - `Chapter1.mp3` (прослушано, иконка повтора Replay).
  - `Chapter2.mp3` (текущая воспроизводимая глава, прогресс `12m / 24m`, кнопка Pause).
  - `Chapter3.mp3` (`45m`, кнопка Play).
  - `Chapter4.mp3` (`30m`, кнопка Play).
  - `Chapter5.mp3` (`50m`, кнопка Play).
  - `Chapter6.mp3` (`15m`, кнопка Play).
- **Фактическая реализация (`frontend/src/components/mpod/audiobook-playback-chapters-modal.tsx`):**
  - Реальный production-компонент модального окна глав аудиокниги со скролл-областью `ScrollArea`, иконками состояния (`ReplayIcon`, `PauseIcon`, `PlayIcon`) и расчётом времени через `formatDuration`. Самодельная карточка полностью удалена из preview.
- **Статус:** `APPROVED DIFFERENCE`
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/abookchapter-figma.png](docs/audit-assets/abookchapter-figma.png)
  - Actual: [docs/audit-assets/abookchapter-actual.png](docs/audit-assets/abookchapter-actual.png)

---

## 3. Таблица расхождений и статусов компонентов

| № | Компонент / Экран | Узел Figma (`Ready for dev`) | Реализация в кодовой базе | Статус | Основание / Причина отличия |
|---|---|---|---|---|---|
| 1 | **Logo** | `317:1293` | `logo.tsx` | **PASS** | Полное совпадение геометрии и цветов SVG. |
| 2 | **TopNav** | `372:643` | `top-nav.tsx` | **APPROVED DIFFERENCE** | Наименования совпадают (`Player`, `Podcasts`, `Abooks`, `Settings`, `+ Add`); навигация реализована через `Link` внутри shadcn `Button` с пропсом `activeItem`. |
| 3 | **AppShell** | `374:295` | `app-shell.tsx` | **APPROVED DIFFERENCE** | Заголовок `Subscriptions`, подзаголовок `Short description`, действия `Refresh all` и `Show all`. Контейнер адаптируется через Tailwind классы. |
| 4 | **AuthShell / AuthCard** | `343:348` | `auth-shell.tsx`, `auth-card.tsx` | **APPROVED DIFFERENCE** | Состояние регистрации совпадает (`Create the only account...`, `Create your account`). Поле пароля дополнительно имеет кнопку переключения видимости. |
| 5 | **Player** | `462:2515` | `player.tsx` | **APPROVED DIFFERENCE** | Контент, время `23:14` / `14:03`, пауза и `Show chapters` совпадают. В Figma показана скорость `1.5x`, в приложении дефолтные скорости `1.3x` (подкасты) и `1x` (книги) по `AGENTS.md`. |
| 6 | **PlaylistQueue / EpisodeRow** | `472:520` | `playlist-queue.tsx`, `episode-row.tsx` | **APPROVED DIFFERENCE** | 3 строки, drag-handle, кнопки Play/Pause и Remove. Статус скачивания и даты скрыты по прямому решению пользователя (13.09.2026). Время унифицировано. |
| 7 | **AddPodcast / FileDropzone** | `521:540`, `517:504` | `add-podcast.tsx`, `file-dropzone.tsx` | **APPROVED DIFFERENCE** | Оба состояния модального окна (RSS/OPML) и standalone dropzone реализованы реальными компонентами. Вкладки оформлены через shadcn Tabs. |
| 8 | **ShowNotes / ModalScreen** | `544:1104`, `544:1399` | `show-notes.tsx`, `modal-screen.tsx` | **APPROVED DIFFERENCE** | Реальное модальное окно на базе Radix Dialog с backdrop, оверлеем и скролл-областью заметок. |
| 9 | **PodcastCard** | `694:2836` | `podcast-card.tsx` | **FAIL** | В production-компоненте отсутствует поддержка счётчика непрослушанных выпусков (`2 unlistened episodes`), присутствующего в эталоне Figma. |
| 10 | **FileManager** | `1285:8972` | `filemanager-item.tsx`, `breadcrumb.tsx` | **APPROVED DIFFERENCE** | Реальная композиция с хлебными крошками и тремя строками с обработчиками `onTogglePlaylist`. Кнопка плейлиста оформлена через Button с иконкой. |
| 11 | **AbookChapter** | `1309:11657` | `audiobook-playback-chapters-modal.tsx` | **APPROVED DIFFERENCE** | Реальное модальное окно глав с обложкой, заголовками и статусами прослушивания (`ReplayIcon`, `PauseIcon`, `PlayIcon`). |

---

## 4. Итоговое заключение

Визуальная сверка завершена с результатом FAIL. Задача остаётся открытой до устранения или продуктового согласования перечисленных расхождений.
