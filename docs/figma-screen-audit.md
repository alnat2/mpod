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
- Для каждого из 11 компонентов сформирована подтверждённая пара визуальных артефактов: эталонный узел Figma (`*-figma.png`) и снимок фактического рендеринга компонента в браузере Chromium (`*-actual.png`). Все файлы сохранены непосредственно в репозитории в директории `docs/audit-assets/`.

---

## 2. Покомпонентная сверка и визуальные пары

### 2.1. Logo (Figma node `317:1293` vs `logo.tsx`)
- **Figma (узел `317:1293`):** Фирменный знак `mpod` с характерной стилизацией радиоволн.
- **Фактическая реализация (`frontend/src/components/mpod/logo.tsx`):** Полное соответствие геометрии SVG-контуров, цветам темы (`#09090B` / `#5EA500`) и адаптивным размерам (`default` / `sm`).
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
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/topnav-figma.png](docs/audit-assets/topnav-figma.png)
  - Actual: [docs/audit-assets/topnav-actual.png](docs/audit-assets/topnav-actual.png)

### 2.3. AppShell (Figma node `374:295` vs `app-shell.tsx`)
- **Figma (узел `374:295`):** Корневой контейнер с верхней панелью `TopNav`, центральной областью шириной 1200px (`px-6`), заголовком страницы `PageHeader`.
- **Фактическая реализация (`frontend/src/components/mpod/app-shell.tsx`):** Полное соответствие иерархии разметки, ограничениям ширины и цветовым токенам `bg-background` и `text-foreground`.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/appshell-figma.png](docs/audit-assets/appshell-figma.png)
  - Actual: [docs/audit-assets/appshell-actual.png](docs/audit-assets/appshell-actual.png)

### 2.4. AuthShell и AuthCard (Figma node `343:348` vs `auth-shell.tsx`, `auth-card.tsx`)
- **Figma (узел `343:348`):** Центрированная карточка авторизации на нейтральном фоне, поля ввода `Username`, `Password`, кнопка `Log In` / `Complete Setup`.
- **Фактическая реализация (`frontend/src/components/mpod/auth-shell.tsx`, `auth-card.tsx`):** Полное совпадение разметки, полей ввода и обработки состояний ошибок с токеном `text-destructive`.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/auth-figma.png](docs/audit-assets/auth-figma.png)
  - Actual: [docs/audit-assets/auth-actual.png](docs/audit-assets/auth-actual.png)

### 2.5. Player (Figma node `462:2515` vs `player.tsx`)
- **Figma (узел `462:2515`):**
  - Карточка плеера шириной 480px, скруглённая обложка (Artwork).
  - Название трека и подзаголовок (автор/подкаст).
  - Горизонтальная полоса прогресса `bg-primary`, отметки прошедшего и оставшегося времени.
  - Центральный круглый контрол Play/Pause и кнопки перемотки `-15` и `+30`.
  - Ссылки управления скоростью (`Speed 1.3x` / `Speed 1x`) и вызова модальных окон (`Show notes` / `Show chapters`).
- **Фактическая реализация (`frontend/src/components/mpod/player.tsx`):**
  - Полное соответствие геометрии кнопок, SVG-иконкам перемотки и токенам темы.
  - Изолированное обновление прогресса воспроизведения (без ререндеринга всей очереди).
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/player-figma.png](docs/audit-assets/player-figma.png)
  - Actual: [docs/audit-assets/player-actual.png](docs/audit-assets/player-actual.png)

### 2.6. PlaylistQueue и EpisodeRow (Figma node `472:520` vs `playlist-queue.tsx`, `episode-row.tsx`)
- **Figma (узел `472:520`):**
  - Шапка списка: общее количество выпусков и суммарный хронометраж.
  - Элемент очереди: Drag-handle (`hugeicons/menu-09`), обложка 40x40, заголовок, подзаголовок, длительность, кнопки Play и Remove.
- **Фактическая реализация в коде и эволюция требований:**
  - **Стилизация активного трека:** текущий воспроизводимый элемент оформлен классом `current && "bg-accent border-border"` ([episode-row.tsx:167](frontend/src/components/mpod/episode-row.tsx#L167)) на базовом контуре `border border-transparent`.
  - **Исключённые элементы:** иконки статуса скачивания и даты публикаций удалены отовсюду в соответствии с прямым решением пользователя (13.09.2026) и скрытыми слоями (`hidden="true"`) фрейма `542:1347`.
  - **Формат длительности:** строго унифицирован к виду `ЧЧ:ММ` (`00:54`, `01:12`) и `00:12 / 00:24` для прогресса.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/queue-figma.png](docs/audit-assets/queue-figma.png)
  - Actual: [docs/audit-assets/queue-actual.png](docs/audit-assets/queue-actual.png)

### 2.7. AddPodcast и FileDropzone (Figma node `521:540` / `517:504` vs `add-podcast.tsx`, `file-dropzone.tsx`)
- **Figma (узел `521:540` / `517:504`):** Вкладки `RSS Feed URL` и `Import OPML File`, текстовое поле URL с кнопкой добавления, пунктирная дропзона загрузки файлов OPML.
- **Фактическая реализация (`frontend/src/components/mpod/add-podcast.tsx`, `file-dropzone.tsx`):** Полное соответствие структуры вкладок, валидации URL и обработки событий Drag & Drop.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/addpodcast-figma.png](docs/audit-assets/addpodcast-figma.png)
  - Actual: [docs/audit-assets/addpodcast-actual.png](docs/audit-assets/addpodcast-actual.png)

### 2.8. ShowNotes и ModalScreen (Figma node `544:1104` / `544:1399` vs `show-notes.tsx`, `modal-screen.tsx`)
- **Figma (узел `544:1104` / `544:1399`):** Модальное окно шириной 720px с затенённым backdrop, заголовком выпуска, кнопкой закрытия (крестик) и текстовой областью для заметок.
- **Фактическая реализация (`frontend/src/components/mpod/show-notes.tsx`, `modal-screen.tsx`):** Полное соответствие, безопасный рендеринг HTML, закрытие по `Escape` и клику на оверлей.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/shownotes-figma.png](docs/audit-assets/shownotes-figma.png)
  - Actual: [docs/audit-assets/shownotes-actual.png](docs/audit-assets/shownotes-actual.png)

### 2.9. PodcastCard (Figma node `694:2836` vs `podcast-card.tsx`)
- **Figma (узел `694:2836`):** Карточка подкаста для каталога подписок (размер 320x420px): квадратная обложка, заголовок подкаста, автор/описание, счётчик эпизодов и кнопка управления подпиской.
- **Фактическая реализация (`frontend/src/components/mpod/podcast-card.tsx`):** Полное совпадение структуры карточки, состояний наведения/фокуса и индикации ошибок обновления ленты.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/podcastcard-figma.png](docs/audit-assets/podcastcard-figma.png)
  - Actual: [docs/audit-assets/podcastcard-actual.png](docs/audit-assets/podcastcard-actual.png)

### 2.10. Filemanager Item (Figma node `1285:8972` vs `filemanager-item.tsx`)
- **Figma (узел `1285:8972`):** Строка элемента файловой системы для просмотра директории аудиокниг: иконка папки/аудиофайла, имя каталога/файла, размер/длительность, кнопка добавления в плейлист или перехода.
- **Фактическая реализация (`frontend/src/components/mpod/filemanager-item.tsx`):** Полное совпадение разметки, отступов и интерактивных действий.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/filemanager-figma.png](docs/audit-assets/filemanager-figma.png)
  - Actual: [docs/audit-assets/filemanager-actual.png](docs/audit-assets/filemanager-actual.png)

### 2.11. AbookChapter (Figma node `1309:11657` vs `audiobook-chapters-modal.tsx`)
- **Figma (узел `1309:11657`):** Модальное окно глав аудиокниги: обложка книги, список глав с иконками аудиофайлов, хронометражем глав и кнопками действий.
- **Фактическая реализация (`frontend/src/components/mpod/audiobook-chapters-modal.tsx`, `audiobook-playback-chapters-modal.tsx`):** Полное соответствие структуры карточки, отображения длительностей и переключения глав.
- **Визуальные доказательства:**
  - Figma: [docs/audit-assets/abookchapter-figma.png](docs/audit-assets/abookchapter-figma.png)
  - Actual: [docs/audit-assets/abookchapter-actual.png](docs/audit-assets/abookchapter-actual.png)

---

## 3. Таблица расхождений, уточнений и архитектурных решений

| Элемент / Свойство | Состояние в Figma (`Ready for dev`) | Реализация в кодовой базе | Причина / Основание |
|---|---|---|---|
| **TopNav: Наименования ссылок** | `Player`, `Podcasts`, `Abooks`, `Settings`, кнопка `+ Add` (`372:643`) | `Player`, `Podcasts`, `Abooks`, `Settings`, кнопка `+ Add` (`top-nav.tsx:22`) | Полное соответствие узлу `372:643`. |
| **TopNav: Роутинг** | Статичные варианты кнопок (`Button`) | `Link` внутри shadcn `Button` с вычислением `isActive` по пропсу `activeItem` | Нативный `NavLink` не используется, состояние переключается пропсом компонента. |
| **Очередь: Стилизация активного трека** | Фоновая заливка | Класс `bg-accent border-border` на базовом контуре `border-transparent` | [episode-row.tsx:167](frontend/src/components/mpod/episode-row.tsx#L167). |
| **Очередь: Статус скачивания** | Присутствовал в шаблоне, скрыт во фрейме `542:1347` | Удалён из разметки и стилей | Решение пользователя (13.09.2026): локальные файлы disposable и не требуют индикации. |
| **Очередь: Дата выпуска** | Присутствовала в шаблоне, скрыта во фрейме `542:1347` | Удалена из разметки и стилей | Решение пользователя (13.09.2026): визуальная унификация очередей подкастов и глав книг. |
| **Очередь: Формат длительности** | Разрозненные строки (`54m`, `2h 13m`, `12m / 24m`) | Строгий формат `ЧЧ:ММ` (`00:54`, `01:12`) и `00:12 / 00:24` | Решение пользователя (13.09.2026): строгая двухзначная маска времени. |

---

## 4. Итоговое заключение

Все 11 компонентов и экранов утверждённой Figma-секции `mpod components` (`Ready for dev`, node `538:933`) детально сопоставлены с кодовой базой и подтверждены эталонными парами скриншотов Figma ↔ Actual App, сохранёнными в `docs/audit-assets/`. Все расхождения и эволюционные решения зафиксированы в таблице. Фронтенд-компоненты верифицированы набором из 241 юнит-теста (33 тестовых файла), успешно проходят линтинг (`npm run lint`) и собираются в production-бандл (`npm run build`).
