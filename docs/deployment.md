# mpod deployment

## Ограничения

- Production deploy — только после явного подтверждения пользователя.
- Test source — branch `test`; production source — branch `main`.
- Не удаляй persistent volumes и не используй `down -v` без отдельного запроса на удаление данных.
- Перед deploy проверь актуальный script и состояние цели. Команда из документа не является разрешением на запуск.
- После deploy проверь health/целевой сценарий и фактический commit hash. Не подменяй deployed hash хэшем local checkout.

## Репозиторий

- GitHub: `alnat2/mpod`.
- Gitea mirror: `http://192.168.0.222:3000/admin/mpod.git`; ранее настроена синхронизация из GitHub, текущий статус проверить при необходимости.

## Test

- SSH: `nas`.
- NAS path: `/home/cross/mpod-mobile`.
- Compose project/service: `mpod-mobile` / `mpod`.
- Container: `mpod-mobile-mpod-1`.
- Host/container port: `5051` / `5050`.
- Volume: `mpod_data`, mount `/data`.
- Script: `/home/cross/mpod-mobile/deploy-test.sh`.

## Production

- NAS path: `/home/cross/mpod`.
- Compose project/service: `mpod` / `mpod`.
- Container: `mpod-mpod-1`.
- Host port: `5050`.
- Volume: `mpod_data`, mount `/data`.
- Script: `/home/cross/mpod/deploy-prod.sh`, требует `YES`.

## Runtime

- Один app container и persistent `/data`.
- DB: `/data/mpod.sqlite`; downloads: `/data/downloads`.
- Audiobook library задаётся `AUDIOBOOKS_DIR` (default `/share/audio/abooks/`) и остаётся read-only.
- Dockerfile общий и находится в корне репозитория. Версии base images проверяй в актуальном Dockerfile, не фиксируй их в AGENTS.md.

## Команды деплоя

Ни одна команда ниже не запускается автоматически при чтении документа.

Test:

```bash
ssh nas 'cd /home/cross/mpod-mobile && bash deploy-test.sh'
```

Production, только после явного подтверждения:

```bash
ssh nas 'cd /home/cross/mpod && bash deploy-prod.sh'
```

Топология перенесена из существующих инструкций, но в рамках подготовки черновика не проверялась на NAS. Перед операцией сверить её с реальной конфигурацией.
