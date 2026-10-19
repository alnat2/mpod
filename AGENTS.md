# mpod

Single-user web application: React frontend, Go backend, SQLite, local storage. Не native mobile app, desktop app или CLI.

## Требования

- Product decisions: `docs/product-decisions.md`; architecture: `docs/architecture.md`; requirements: `prd.md`.
- При конфликте поведения: decisions → architecture → PRD. Это не отменяет safety rules AGENTS.md.

## Ограничения

- Single-user, one-time registration, session-based auth.
- Без multi-user, cloud storage, distributed infrastructure, Redis, Postgres и workers без явного изменения требований.
- Backend владеет auth, playback, import, playlist и file lifecycle.
- Исходные аудиокниги read-only: удаление из playlist не удаляет их с диска.
- Простые поддерживаемые решения, без speculative features и overengineering.

## Области

- Для Figma/design/UI-задач и перед изменением `frontend/` прочитай `frontend/AGENTS.md`, в том числе при запуске из корня.
- Перед изменением `server/` прочитай `server/AGENTS.md`.
- Frontend-задача меняет frontend и frontend-owned docs; backend-задача — backend и backend-owned docs.
- Причина вне заданной области: сообщи вывод и дождись разрешения на cross-domain fix. Изначальный full-stack запрос разрешает обе области.
- Docker/runtime/deploy: сначала `docs/deployment.md`. Test branch — `test`, production — `main`; не переключай источник самостоятельно. Production — после явного подтверждения.

## Готовность

- Поведение соответствует требованиям, relevant tests и edge cases проверены.
- Bug fix включает focused regression test, воспроизводящий прежний дефект; если непрактично — сообщи причину.
- UI проверен в реальном браузере по frontend-инструкциям.
- Unrelated files и пользовательские данные не изменены.
- Обновляй существующие docs при необходимости; отдельные документы создавай только для информации, которой действительно нужен durable standalone источник, не для каждой итерации.
