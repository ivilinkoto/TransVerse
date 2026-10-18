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
| Търгове | `company_tenders` (оферта/активен/изпълнен/провален, курсове, тонове, плащане на курс, бонус, депозит, срок, доставени, шофьори), `contracts.tender_id` |
| Известия и имейл | `push_subscriptions` (устройства за Web Push), `email_tokens` (хеш, вид verify/reset, валидност, използван), `users.email_verified_at`, `users.push_prefs` |
| Лицензи на компаниите | `company_licences` (компания + лиценз, цена, купил) |
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
Миграция `0012`: `payments.failure_reason`.
Миграция `0013`: `vehicles.return_pending` (наетият камион се връща след курса).
Миграция `0014`: `company_licences`; правото `manage_chat` за длъжността „Заместник“.
Миграция `0015`: `push_subscriptions`, `email_tokens`, `users.email_verified_at / push_prefs`.
Миграция `0016`: `company_tenders`, `contracts.tender_id`, `users.login_streak / daily_claim_key`; правото `manage_tenders` за „Заместник“ и „Диспечер“.

## Пазар, пътни събития, покани, сезони на компании (миграция 0017)
- `vehicle_listings` — обяви за употребявана техника: продавач, вид (`vehicle` | `trailer`), id на превозното средство или ремаркето, модел, цена, град, статус (`open` | `sold` | `cancelled` | `expired`), купувач, срок. Една отворена обява на превозно средство или ремарке (частични уникални индекси).
- `trailers.listed` — ремаркето е обявено. Превозните средства използват `vehicles.status = 'listed'`.
- `deliveries.road_events` (jsonb) и `deliveries.next_event_at` — планираните пътни събития и времето на следващото (индекс за работника).
- `users.referral_code` (уникален), `referred_by_id`, `referral_rewarded_at`, `referral_outcome` (`rewarded` | `declined`), `signup_ip_hash` (SHA-256 със сол от `job_state` `ip-salt`).
- `organization_season_scores` — сезонни точки, доставки, крайно място и награда на всяка компания.

## Социални функции и репутация (миграция 0018)
- `friendships` — заявка и приятелство: един ред на двойка (уникален индекс по least/greatest), статус `pending` | `accepted`.
- `company_invites` — покана от компания към играч без компания: `pending` | `accepted` | `declined` | `cancelled`, една чакаща на двойка.
- `direct_messages` — лични съобщения:
  - `read_at` — кога получателят ги е прочел;
  - `deleted_at` — изпращачът ги е изтрил за двамата;
  - `hidden_for_sender`, `hidden_for_recipient` — разговорът е изтрит само за единия.
- `chat_messages` — общите канали `global` и `trade`.
- `contracts.min_reputation` — премиум поръчка (0 = обикновена).

## Търговия, лиги, пропуск, модерация (миграция 0019)
- `warehouse_stock` (депо, стока) — тонове и обща покупна цена.
- `contracts.trade_company_id`, `contracts.trade` — лична поръчка за собствена стока (статус `trade` до приемането).
- `user_blocks` (блокиращ, блокиран).
- `reports` — доклади със статус `open` | `resolved` | `dismissed` и решение.
- `users.chat_muted_until`, `users.league_tier`.
- `league_groups` (седмица, ниво) и `league_members` (седмица, играч, група, точки, крайно място, `up` | `down` | `stay`).
- `season_passes` (сезон, играч) — точки, премиум, взети безплатни и премиум нива.

## Снимки на профила (миграция 0020)
- `user_avatars` (играч → вид на файла и данни).
- `users.avatar_version` — 0, ако няма снимка; увеличава се при всяко качване.

## Дневник на имейлите (миграция 0021)
- `mail_log` — вид (`verify` | `reset` | `test`), получател, играч, тема, статус (`sent` | `rejected` | `failed`), Message-ID и отговор на SMTP сървъра.

## Шофьори, ремаркета, клиенти (миграция 0022)
- `drivers.co_vehicle_id` — втори шофьор (двоен екипаж), уникален; `drivers.duty_min` и `drivers.rested_at` — часове кормуване след последната почивка, валидни до `rested_at`; `drivers.traits` — точки в умения (`eco`, `safe`, `long`).
- `deliveries.co_driver_id`, `deliveries.end_duty_min` — екипажът на курса и часовете, с които приключва.
- `client_contracts` — договор с клиент на играч: линия (`route_id`), товари (`loads_total`, `loads_done`, `loads_late`), плащане на товар, бонус, нужна репутация, статус `offer` | `active` | `completed` | `failed` | `expired` | `declined`, срокове.
- `contracts.client_contract_id` — товар по договор с клиент (лична поръчка със статус `trade`).
- Нови видове товар `steel` и `vehicles` в `city_markets` (добавят се от импорта на географията при всяко публикуване).
