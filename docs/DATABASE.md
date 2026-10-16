# База данни (PostgreSQL 16, Drizzle ORM)

Схема: `src/server/db/schema.ts`. Миграции: `drizzle/` (генерират се с `pnpm db:generate`, прилагат се с `pnpm db:migrate`).

| Група | Таблици |
|-------|---------|
| Реална география | `countries`, `cities` (GeoNames id), `ports`, `routes` (кеш на маршрути) |
| Симулирана икономика | `city_markets` (търсене по град/товар), `market_events` |
| Акаунти | `users`, `sessions` (SHA-256 на токена), `rate_limits` |
| Компании и активи | `companies`, `depots`, `vehicles`, `trailers`, `drivers`, `driver_candidates` |
| Компании на играчите | `organizations` (име, профил, ниво, подобрения, собственик и **каса**), `treasury_entries` (регистър на касата, уникален `idempotency_key`) |
| Лицензи | `user_licences` (играч + лиценз, цена, източник purchase/legacy/admin) |
| Членство в компании | `company_ranks` (длъжности, права, старшинство), `company_members` (един играч — една компания), `company_applications`, `company_assets` (лого/банер като bytea, проверени по съдържание) |
| Пазар и доставки | `contracts`, `deliveries` (разписание jsonb, един запис на поръчка) |
| Финанси | `ledger_entries` (уникален `idempotency_key`, `balance_after_cents`) |
| Прогрес и общност | `achievements`, `seasons`, `season_scores`, `notifications`, `activity` |
| Служебни | `job_state` (последно изпълнение на фоновите задачи) |
| Поддръжка и администрация | `support_tickets`, `support_messages`, `admin_audit` |

Инварианти, проверявани от тестовете: балансът на компанията е равен на сумата от счетоводните записи; една доставка на поръчка за играч (`deliveries (contract_id, company_id)`; обикновените поръчки имат и един победител чрез условно обновяване на статуса, спешните са отворени за всички до изтичане); плащане точно веднъж.

Миграция `0002` създава длъжностите по подразбиране и членството на собственика за всички вече основани компании.
Миграция `0003` премества профила на основаните компании от `companies` (личния акаунт) в `organizations` със същите id; `companies` остава личният акаунт на играча (баланс, автопарк, лиценз `kind`).
Миграция `0004`: `user_licences`, `users.vip_until`, `contracts.urgent / speed_factor / created_by` и еднократно даване на лицензи на съществуващите играчи.
Миграция `0005`: уникалният индекс на доставките става (поръчка, играч), за да може спешна поръчка да се поема от много играчи.
