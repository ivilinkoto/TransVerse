# База данни (PostgreSQL 16, Drizzle ORM)

Схема: `src/server/db/schema.ts`. Миграции: `drizzle/` (генерират се с `pnpm db:generate`, прилагат се с `pnpm db:migrate`).

| Група | Таблици |
|-------|---------|
| Реална география | `countries`, `cities` (GeoNames id), `ports`, `routes` (кеш на маршрути) |
| Симулирана икономика | `city_markets` (търсене по град/товар), `market_events` |
| Акаунти | `users`, `sessions` (SHA-256 на токена), `rate_limits` |
| Компании и активи | `companies`, `depots`, `vehicles`, `trailers`, `drivers`, `driver_candidates` |
| Компании на играчите | `organizations` (име, профил, ниво, подобрения, собственик и **каса**), `treasury_entries` (регистър на касата, уникален `idempotency_key`) |
| Плащания | `payments` (играч, доставчик, продукт, ТрансКоин/VIP дни, сума, статус, Stripe session/payment intent, PayPal order/capture, съгласие, платено/възстановено) |
| ТрансКоин | `coin_entries` (регистър на премиум валутата; баланс в `users.coins`) |
| Мисии | `mission_progress` (играч + период + мисия: цел, прогрес, награда, изпълнена/взета) |
| Ивенти | `global_events` (цел, прогрес, филтри, награди jsonb, начало/край, постигнат/разплатен, резултат, шаблон), `global_event_contributions` (ивент + играч: принос, доставки, компания, място и награда) |
| Фирмени мисии | `company_mission_progress` (компания + седмица + мисия: цел, прогрес, награда за касата, принос по членове) |
| Лицензи | `user_licences` (играч + лиценз, цена, източник purchase/legacy/admin) |
| Чат на компаниите | `company_messages` (компания, автор, текст, изтриване) |
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
Миграция `0006`: `mission_progress`.
Миграция `0007`: `coin_entries`, `users.coins / xp_boost_until / vip_reroll_key`, `contracts.reserved_by_company_id / reserved_until`.
Миграция `0008`: `company_messages`.
Миграция `0009`: `global_events`, `global_event_contributions`, `company_mission_progress`.
Миграция `0010`: `payments`.
Миграция `0011`: `payments.order_id / capture_id` (PayPal).
