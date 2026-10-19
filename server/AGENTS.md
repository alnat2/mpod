# mpod backend

## Архитектура

- Go backend. Следуй `../docs/architecture.md` и релевантным решениям `../docs/product-decisions.md`.
- Разделяй service, repository, database и filesystem responsibilities. Не превращай отдельные handlers в владельцев всех бизнес-правил.
- Backend владеет auth, playback state, import, playlist и lifecycle файлов.
- Manual и scheduled refresh используют одну общую логику.
- Централизуй file operations. Исходные файлы аудиокниг никогда не удаляются при удалении из playlist.
- Runtime configuration хранится в environment, пользовательские настройки — в database-backed settings.

## API и данные

- API располагается под `/api`, обычные request/response используют JSON и consistent errors.
- Не добавляй pagination, advanced filtering, API versioning или search без требования.
- Duplicate handling и playback sync должны соответствовать product decisions.
- Feed refresh не перезаписывает listened state, playlist state или playback progress пользователя.
- Missing local files обрабатываются как явная reconciliation situation, а не silent corruption.
- Podcast download — disposable copy; audiobook source — read-only library media. Не смешивай эти lifecycle.

## Реализация и проверка

- Предпочитай explicit service/repository boundaries, focused modules и простой код без premature frameworks.
- Перед запуском проверок установи Go module root и используй актуальные команды репозитория. Не фиксируй временные GOPATH/GOCACHE workaround как универсальную настройку проекта.
- Bug fix сопровождается focused regression test и проверкой связанных state transitions.
- Изменения schema, contracts и filesystem lifecycle проверяются на соответствующих edge cases.
- Если необходим frontend fix вне backend scope, сообщи finding и дождись разрешения.
