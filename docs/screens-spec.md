# Спецификация экранов и UI-контрактов mpod

Документ фиксирует точную привязку экранов приложения mpod к эталонным фреймам и переменным Figma (файл `3CmMv8wYlyNz9qDDdOd2Ka`, коллекция `mpod dark mode`).

---

## 1. Цветовая палитра Dark Mode (`mpod dark mode`)

| CSS Variable | Figma Token | Hex / Value | Применение |
|---|---|---|---|
| `--background` | `background` | `#1c1f24` | Фон страницы |
| `--card` | `card` | `#25292c` | Фон основной карточки контента |
| `--card-foreground` | `card-foreground` | `#f2fdff` | Текст заголовков внутри карточек |
| `--foreground` | `foreground` | `#f7fbff` | Основной текст и заголовки |
| `--primary` | `primary` | `#1e529a` | Акцентный синий: кнопка «Show all», активные иконки, ссылки |
| `--primary-foreground`| `primary-foreground` | `#dde9ee` | Текст на кнопках primary |
| `--secondary` | `secondary` | `#353a3f` | Второстепенные кнопки («Refresh all», «Unsubscribe», «Add») |
| `--secondary-foreground`| `secondary-foreground` | `#f7fbff` | Текст на второстепенных кнопках |
| `--muted` | `muted` | `#2d3237` | Плейсхолдеры обложек, неактивные элементы |
| `--muted-foreground` | `muted-foreground` | `#a3a09a` | Подзаголовки, метаданные, даты, длительность |
| `--accent` | `accent` | `#0c0e19` | Темные карточки / акцентный фон |
| `--border` | `border` | `rgba(250, 250, 250, 0.1)` | Границы карточек и инпутов |
| `--input` | `input` | `rgba(250, 250, 250, 0.15)`| Поля ввода |
| `--ring` | `primary` | `#1e529a` | Фокусные рамки |

---

## 2. Desktop Экраны (Section `mpod desktop` — `552:1808`, canvas 1440×900)

### Общая геометрия Desktop
- **Хедер (`TopNav`)**: контейнер шириной 1200px, центрированный внутри окна (на 1440px отступы по бокам по 80px).
- **Контентная карточка**: максимальная ширина 1280px (`max-w-[1280px]`), отступы `px-10 py-5` (40px / 20px), скругление `rounded-md` (8px), отступ снизу `pb-8` (32px).
- **Вкладки навигации**: `Player`, `Podcasts`, `Abooks`, `Settings` + кнопка `+ Add` справа.

---

### 2.1. Экран «Podcasts» (Subscriptions)
- **Node ID эталона**: `546:2209`
- **Состояния**:
  - Базовое: `546:2209`
  - Ошибка подкаста (Podcast Error): `558:2264`
  - Все эпизоды раскрыты (Show All): `561:2571`
- **Заголовок страницы**:
  - Title: `Podcasts` (font-semibold, 30px / leading 36px). *Не Subscriptions!*
  - Subtitle: `{N} podcasts` (font-medium, 16px / leading 24px, muted).
  - Trailing Actions: кнопка `Refresh all` (secondary) + кнопка `Show all` (primary, `#1e529a`).
- **Карусель подкастов (`carousel`)**:
  - Карточка подкаста: размер 320×160px (или 285×152px), скругление 16px, обложка 88×88px.
  - Две кнопки в карточке: `Refresh` и `Unsubscribe`.
  - **Правило центрирования**: если карточек меньше 4, карточки центрируются в карусели, стрелки `<` и `>` располагаются строго под карточками.
- **Список эпизодов (`episodes`)**:
  - Header списка: счетчик слева `{listened} / {total} episodes`, кнопка справа `Mark all listened` (синий текст primary).
  - Элемент эпизода (`EpisodeItem`, 70px):
    - Обложка 40×40px.
    - Название эпизода (semibold, 14px).
    - Метаданные: дата и длительность в формате `Mar 31, 2026 • 54m` (справа перед кнопками).
    - **4 кнопки действий** (size 36×36px, скругление 10px):
      1. `Download` (иконка `download-square-01`)
      2. `Playlist` (иконка `play-list-add`)
      3. `Notes` (иконка `note`)
      4. `Mark listened` (иконка `view` / `view-off`)
    - Тонкий разделитель между элементами.

---

### 2.2. Экран «Player» (Home Screen)
- **Node ID эталона**: `542:1347`
- **Компоненты**:
  - `Player` (480×458px): большая обложка, ползунок прогресса, кнопки перемотки -15s / +30s, Play/Pause, громкость, скорость.
  - `PlaylistQueue` (1040×272px): очередь воспроизведения.

---

### 2.3. Экран «Audiobooks» (Abooks)
- **Node ID эталона**: `1272:8113` (раздел `for abooks` `1309:12604`)
- **Плеер аудиокниг**: `1306:10946`
- **Модалка глав (Chapters modal)**: `1309:11463`
- **Элементы файлового менеджера**: `1337:13363` (`chapters in filemanager`)

---

### 2.4. Экран «Settings»
- **Node ID эталона**: `545:1766`
- **Элементы**: секции настроек с токенами `SettingItem` (`1562:13131`), поля ввода `input: #fafafa26`.

---

### 2.5. Экраны Авторизации и Настройки
- **Setup Screen**: `541:1026` (первичная регистрация)
- **Login Screen**: `541:1089` (вход)
- **Пустое состояние (No Podcasts)**: `541:936`

---

### 2.6. Модальные окна Desktop
- **Add RSS Feed Modal**: `544:1640`
- **Import OPML Modal**: `544:1916`
- **Show Notes Modal**: `544:1430`

---

## 3. Mobile Экраны (Section `mpod mobile` — `700:4535`, viewport 360×800)

| Экран / Компонент | Node ID эталона | Особенности |
|---|---|---|
| `Subscriptions Screen Mobile` | `885:6375`, `1156:6439` | Мобильная карусель карточек и плоский список эпизодов |
| `Home Screen Mobile` (Player) | `686:2505`, `1485:10844` | Мобильный плеер с нижней навигацией |
| `Settings Screen Mobile` | `1154:5580` | Мобильные настройки |
| `Login Screen Mobile` | `694:3007` | Мобильная форма логина |
| `Setup Screen Mobile` | `694:2973` | Мобильная первичная регистрация |
| `No Podcast Screen Mobile` | `694:3041` | Пустое состояние |
| `Add RSS Feed Modal Mobile` | `696:3304` | Мобильная модалка добавления RSS |
| `Show Notes Modal Mobile` | `696:3303` | Мобильные заметки |
| `BottomSheet` | `1166:9535` | Мобильный шторка-bottomsheet |
| `Bottom Nav` | `1269:7838` | Нижняя плашка навигации |
