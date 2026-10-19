# mpod frontend

## Источники

- Frontend decisions: `../docs/frontend-decisions.md`.
- Согласованные продуктовые контракты: `../docs/product-decisions.md`.
- Для реализации из Figma прочитай `../skills/frontend-implementation/SKILL.md`.
- Для Figma sync прочитай `../skills/mpod-frontend-figma-sync/SKILL.md`, если задача соответствует его назначению.
- Пути здесь заданы относительно директории этого AGENTS.md. Не считай frontend источником backend бизнес-правил.

## Figma

- Для mpod library component work прочитай `/Users/cross/.codex/skills/mpod-figma-library-components/SKILL.md`. Если навык недоступен, сообщи проблему; не подменяй его отсутствующим `skills/figma-library-components/SKILL.md`.

- Для исследования исходного дизайна используй live official Figma MCP. Не подменяй его cached JSON, старыми screenshot или памятью без явного разрешения пользователя.
- Реализуй только элементы из секций `Ready for Development`; перед реализацией проверь статус источника.
- Если необходимый file/frame недоступен, останови зависимую работу и сообщи: `I do not have access to the file/frame needed for this task.` Укажи конкретное отсутствующее разрешение или источник.
- Не выдумывай отсутствующие UI states, labels, icons, tokens, spacing или поведение. Запроси решение пользователя.
- Используй согласованные primitives, tokens и existing components. Предпочитай targeted queries вместо полного extraction.
- Для Figma-вызовов сохраняй существующее ограничение: интервал 2–3 секунды и пауза не позднее трёх последовательных вызовов. При переносе процедуры в skill не дублируй её здесь.

## Проверка

- После UI-изменения выполни реальную browser verification против актуального Figma source.
- Проверь затронутые состояния и desktop/mobile breakpoints, а не только один screenshot.
- Настраивай настоящий browser viewport. Изменение CSS width у body не заменяет viewport для media queries.
- Не объявляй задачу готовой, если required visual verification не выполнена; сообщи, что мешает.
- Если обнаружен backend/API дефект вне frontend scope, сообщи evidence и не реализуй backend fix без разрешения.
