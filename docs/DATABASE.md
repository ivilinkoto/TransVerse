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

## Версии и празнична тема (миграция 0023)
- `users.seen_version` — последната версия, чийто прозорец „Какво ново“ играчът е затворил.
- `users.seasonal_theme` — празничната украса (Хелуин и др.) е включена за играча.

## Хелуин 2026 (миграция 0024)
- `contracts.holiday` — празнична поръчка (`halloween`).
- `vehicles.livery` — специална боя върху цвета (`pumpkin`).
- `seasonal_quests` (играч, `<сезон>:<мисия>`) — напредък и кога е взета наградата.
- `user_badges` (играч, значка) — значки завинаги.

## Глоби и застраховка (миграция 0025)
- `vehicles.insured_until` — застраховката е платена до този момент.
- `deliveries.violations` — рисковете, избрани за курса (`hours`, `overload`).
- `fines` — глоба: нарушение, сума, статус (`unpaid` | `paid` | `dropped` | `auto_paid`), обжалвана ли е, срок.

## Седмичник (миграция 0026)
- `newspapers` — брой на вестника: седмица (ключ), пореден номер, съдържание (JSON), кога е публикуван.

## Част 3 и 4 на v1.1 (миграции 0027–0029)
- `vehicles.auto_dispatch`, `deliveries.auto_dispatched` — VIP диспечер.
- `favorite_lanes` (играч, от, до, последно известие) — любими линии.
- `users.seen_hints` — затворени подсказки; `users.quiet_hours` — тихи часове за телефона.
- Миграция 0028 — преизчисляване на опита по новата крива на нивата (нивото и напредъкът се запазват).
- `special_auctions`, `auction_bids` — търгове за специални товари; `contracts.auction_id` — спечеленият товар.


- `money_transfers` — преводи на игрови пари между играчи (от, до, сума, такса, бележка). Миграция 0031.
- `push_subscriptions.last_error`, `last_error_at` — последният отговор на push услугата при неуспешно изпращане. Миграция 0030.
- `deliveries.convoy_with` — другият курс на конвоя (приятел или колега по същата линия). Миграция 0032.
- `job_offers` — курсове, възложени от компания на свободен играч (комисиона, срок, курс); `users.for_hire`. Миграция 0033.
- `company_projects` — фирмени проекти (шаблон, товар, град, цел и напредък в тонове, приноси по членове, награда, срок, статус). Миграция 0034.
- `mentorships` — наставник и ученик, статус (active / done / ended / expired), срок; само едно активно наставничество на ученик (частичен уникален индекс); `users.mentor_open`. Миграция 0035.
- `roadside_helps` — помощ на пътя: курс, начало на престоя (уникално заедно), помагач, спестено време, хонорар. Миграция 0036.
- `xp_entries` — всяко получаване на опит (играч, колко, източник). Миграция 0037.
- `company_battles` — седмични битки на компании (седмица, двете компании, тонове, победител, срок). Миграция 0038.
- `feed_entries`, `feed_cheers` — лентата „При приятелите“ и „Браво“. Миграция 0039.
- `weekly_goals` — седмичната цел на играча (трудност, показател, цел, напредък, награда). Миграция 0040.
- `contracts.stops` — спирките на сборен товар (град, км по маршрута, тонове, срок); `vehicle_leases` — лизинг на камион (цена, вноски, платени, пропуснати, следваща дата, статус); правото `recruit` за длъжностите с `manage_members`. Миграция 0041.
- `company_buildings` — сградите на участъка (вид, позиция, ниво); `company_builds` — строежите (ниво, нужни и доставени материали, време, статус; един активен на компания); `contracts.construction_id`, `contracts.material` — товарите с материали; правото `build`. Миграция 0042.
- `plot_likes` — „Браво“ за базите; `organizations.livery_color`, `users.company_livery` — ливрея; `vehicles.service_km` — профилактика (съществуващите камиони: = километража). Миграция 0043.
- `company_decor` — украсата на участъка; `organizations.plot_expansions` — купена земя; `org_vehicles` — фирмените камиони (модел, номер, град, състояние, километри, при кого са); `vehicles.org_vehicle_id` — взет фирмен камион (`ownership = 'company'`); `company_polls`, `company_poll_votes` — анкетите в чата на компанията. Миграция 0044.
- `chat_reads` — докъде играчът е прочел всеки канал на чата (нови съобщения); `reply_to_id` в `chat_messages`, `company_messages`, `direct_messages` — отговор на съобщение. Миграция 0045.
- `chat_reactions` — реакции на съобщения; `organizations.pinned_message_id` — закачено съобщение; `org_vehicles.note`, `note_by` — бележка по фирмен камион; `contracts.last_load` — последен товар за строеж; `company_builder_weeks` — строител на седмицата. Миграция 0046.
- `users.discord_id`, `discord_name`, `discord_linked_at`, `discord_prefs` — свързан Discord и известията там; `organizations.discord_channel`, `discord_channel_id`, `discord_role_id`, `discord_webhook` — канал на компанията; `company_messages.discord_message_id` — съобщение, дошло от Discord; `discord_outbox` — опашка към Discord. Миграция 0047.
- `discord_tickets` — тикети от Discord (канал, автор, тикетът в играта, затворен/изтрит); `support_messages.discord_message_id` — отговор, писан в канала на тикета; `discord_sanctions` — предупреждения, заглушавания и банове в сървъра; `discord_giveaways`, `discord_giveaway_entries` — раздавания на ТрансКоин; `company_polls.discord_channel_id`, `discord_message_id`, `discord_votes` — анкетата в канала на компанията. Подредбата на сървъра (id на категориите, каналите и съобщенията на бота) е в `job_state` (`discord-layout`). Миграция 0048.
- `discord_members` — нива в Discord сървъра; `discord_voice` — кой е в гласов канал сега; `discord_temp_rooms` — стаите от „Създай стая“; `discord_company_activity` — съобщения в каналите на компаниите по седмици; `discord_quizzes`, `discord_quiz_answers` — викторината; `discord_sanctions.appeal_text`, `appealed_at`, `appeal_status` — обжалване; `organizations.discord_voice_id` — гласовият канал на компанията. Настройките автомодерация и проверка на новите са в `job_state` (`discord-layout`). Миграция 0049.

## v1.3 — заедно (миграция 0050)
- `contracts.shared_load_id`, `contracts.featured` (уникален) — общ товар на компания и товар на деня.
- `shared_loads` — споделените товари (компания, кой, тонове, `open | done | failed`).
- `open_convoys` — конвои, обявени с /конвой (линия, до кога).
- `duels` — дуели 1 срещу 1 (`pending | active | declined | expired | done`, тонове, победител).
- `livery_entries`, `livery_votes` — конкурсът за ливрея (вид на камиона, 👍, победител, съобщение в Discord).

## v1.4 — Отвъд пътя (миграции 0051–0055)
- 0051: `routes.crossing` (ферибот или влак по маршрута; профили `truck:ferry:<линия>:f|r`, `truck:rail:<линия>:f|r`), `contracts.port`, `contracts.port_call_id`, `ship_calls` („Кораб пристига“), `job_state` пази реалното време (`weather`).
- 0052: `company_factories` (рецепта, суровини, партида, готова стока), `contracts.factory_org_id`, `factory_sale_cents`, `contracts.exchange` (борса между играчи), `hauler_ratings` (звезди за превозвача), `company_branches`, `contracts.branch_org_id`, `loans` (кредити с вноски).
- 0053: `drivers.loyalty`, `request`, `request_at`, `vacation_until`, `last_vacation_at` (шофьори с характер); `deliveries.driver_id` може да е празно (`on delete set null`) — историята остава, когато шофьор напусне; `vehicles.cosmetics` (решетка, светлини, сенник, стикер).
- 0054: `rallies` (седмично рали: маршрут, начало, край), `rally_entries` (време на товарния участък, гориво на 100 км), `contracts.rally_id` (личният рали товар; вижда го само `created_by`).
- 0055: `vehicles.moving_until` (път до депото — 1 минута), `trailers.upgrades`, `trailers.logo`, `trailers.org_trailer_id`, `org_trailers` (фирмени ремаркета).

## v1.5 — Пролетен рейс (миграции 0056–0066)
- 0056: `contracts.oversize`, `deliveries.night_shift`, `road_works` (ремонти по реални магистрали), `martenitsas` (мартенички между приятели).
- 0057: `alliances`, `alliance_members`, `alliance_invites`, `alliance_weeks` (седмична цел и битка), `company_contracts` (договори за превоз между компании), `academy_students`; сградата `fuel` в `company_buildings`.
- 0058: `organizations.division`, `division_results`, `users.perfect_streak`, `users.best_perfect_streak`, `city_visits` (албум „Градове“).
- 0059: `predictions` (безплатни прогнози за битките).
- 0060: `trailers.cosmetics` (части за ремаркето: боя, лента, калници, светлини).
- 0061: `contracts.urgent_raises` (поскъпване на неподета спешна доставка), `egg_fights` (махната в 0063 — Великден идва в 1.6).
- 0062: `users.showcase` (витрина на профила), `company_members.bus_used_at` и `first_trip_bonus` (фирмен автобус, бонус за първия курс), `lane_records` (рекорд на линия за месеца), `alliance_listings` (склад на съюза).
- 0063: изтрива `egg_fights` (Великден е отложен за 1.6).
- 0064: `alliances.hall_level`, `hall_tons` (съюзна база), `discord_channel`, `discord_channel_id`, `discord_role_id` (канал на съюза).
- 0065: `company_chronicle` (хроника), `organizations.driver_of_month_prize_cents`, `driver_of_month`.
- 0066: `vehicles.test_drive_from` (тест-драйв).
- `job_state`: `economy-balance` (множител на заплащането, само от администратор), `event-start:<id>`, `rally-live:<id>`, `divisions:<месец>`. Касата на компанията: категория `anniversary` (ключ `anniversary:<компания>:<години>`). Сметката на играча: `convoy_perfect`, `staff_bus_bonus`, `alliance_market`, `insurance_payout`.

## v1.6 — Първа пролет (миграции 0067–0071)
- 0067: `pass_openings` (отваряне на проходите: година, държава, място, играч; уникално по година+държава+играч).
- 0068: `deliveries.convoy_lead` (първият курс на голям конвой; индекс).
- 0069: `organizations.specialization`, `specialization_at`; `tournament_entries`, `tournament_matches` (Пролетна купа); `recruitment_posts` (борса за набиране; една обява на компания и на шофьор).
- 0070: `museum_exhibits` (музей на компанията), `users.spare_parts` (резервни части от скрап).
- 0071: `trailers.hired_out`, `trailers.hire_id`, `trailer_hires` (ремаркета под наем), `plate_auctions` (седмичен търг за редки номера).
- `job_state`: `eurotour:<играч>:M<месец>`, `weekly-challenge:W<седмица>`. ТрансКоин: причини `challenge`, `tournament`, `legend`, `plate_auction`. Сметката на играча: категория `trailer_hire` (наем на ремарке; ключове `trailer-hire:<наем>:pay/earn`), `holiday_reward` (равноденствие, проходи), `road_events` (охраняем паркинг, кражба на гориво), `company_bonus` (специализация), `convoy_bonus` (голям конвой), `vehicle_sale` (скрап).

## v1.7 — Цяла Европа (миграции 0072–0075)
- 0072: частичен индекс `deliveries_completed_idx` (`completed_at` при `status = 'completed'`) за седмичните и месечните класации; `reports.post_id` (доклад за обява от борсата за набиране).
- 0073: `egg_fights` отново (Великден 2027; една битка на двойка и година).
- 0074: `contracts.trans_europe` (трансевропейски товар).
- 0075: `country_kings` (месец `M<година>-<месец>`, държава, играч, тонове; ключ месец+държава, индекс по играч).
- `job_state`: `grand-eurotour:<играч>:<сезон>`, `hire-reminder:<наем>`. ТрансКоин: причина `challenge` и за Голям евротур и Краля на държавата (`country-king:<месец>:<държава>`). Сметката на играча: таксата за нискоемисионни зони е категория `tolls` (ключ `…:lez`).

## v1.8 — Жив път (миграции 0076–0081)
- 0076: `cb_messages` (CB радио: текст, позиция, най-близкият град), `road_reports` (вид, позиция, потвърждения, отхвърляния, `settled`, `expires_at`), `road_report_votes` (един глас на играч).
- 0077: `user_postcards` (картички: играч + забележителност), `hitchhikers` (автостопаджия на курс: персона, такса, waiting / aboard / done / missed).
- 0078: `contracts.sealed`, `deliveries.haggle_percent`, `contract_haggles` (пазарлък: процент, прието).
- 0079: `organizations.listed_at`, `organizations.share_price_cents`, `share_holdings` (акции, цена на покупката, заключени до), `share_prices` (цена по ден).
- 0080: `contracts.humanitarian`.
- 0081: `truck_contest_entries` (месец, играч, вид на камиона, гласове), `truck_contest_votes`.
- Сметката на играча: категории `hitchhiker`, `sealed_bonus`, `haggle_bonus`, `share_trade`, `share_dividend`. Касата: `share_issue`, `share_dividend`. ТрансКоин: причини `postcards`, `truck_contest`, `humanitarian`. `job_state`: `humanitarian`, `truck-contest:<месец>`.

## v1.9 — Светлини и сенки (миграции 0082–0084)
- 0082: `users.ui_prefs` (jsonb: `showAll`, `boardView`, `seenUnlocks`, `seenPages`).
- 0083: `organizations.logo_design`, `tradition_day`, `tradition_name`; `company_members.department_id`; `contracts.key_client`; `company_departments`, `company_assemblies`, `assembly_votes` (един глас на член), `key_clients` (месец + град, уникални), `company_owners` (собственици от–до), `intern_stays`, `merger_offers`.
- 0084: `contracts.shady`, `vehicles.hidden_compartment`; `smuggling_profiles` (избор, внимание, подземна репутация, броячи), `smuggling_contacts` (играч + град), `smuggling_checks` (един на курс: граници, хванат, глоба).
- Сметката на играча: категории `smuggling_fine`, `black_market`. Хроника: `assembly`, `merger`, `tradition`, `key_client`, `owner`. `job_state`: `company-assemblies`, `key-clients`, `owner-reports`, `interns`, `smuggling-heat`, `customs-weekly`.

## v1.10 — Колони и истории (миграции 0085–0089)
- 0085: `convoys` (вид, достъп, водач, линия, тръгване, места, общ товар, статус, камиони, всички навреме), `convoy_members` (камион, товар, роля, статус, причина, курс), `convoy_messages`, `convoy_stats` (конвои, навреме, серия, водени, бонуси днес); `contracts.convoy_id`, `deliveries.organized_convoy_id`.
- 0086: `relays` (три града, двете части, статус, първият шофьор), `contracts.relay_id`, `contracts.relay_leg`, `deliveries.shared_at` (споделен курс).
- 0087: `city_growth` (тонове общо и за седмицата), `harvest_progress` (играч + година).
- 0088: `story_progress` (глава, броячи, посетени градове), `deliveries.choice` (решение по пътя).
- 0089: `deliveries.reefer` (норма, измервания, резултат, сума).
- Статус на товар `held` (втората част на щафета). ТрансКоин: причини `harvest`, `story`. `job_state`: `convoy-depart`, `weekly-convoy`, `relays`, `relays-expire`, `road-choices`, `city-week`.


## v2.0 — Светът се отваря (миграции 0091–0093)
- `holdings`, `holding_members` (една компания в един холдинг), `holding_invites` — холдинги.
- `territories` — коя компания държи коя област през седмицата (`week`, държава, област на английски и на български).
- `legacy_runs` и `users.legacy_stars` — наследство (Ново начало).
- Нови категории в регистрите: `territory_bonus`, `holding_bonus`, `legacy_bonus`, `legacy_reset` (лична сметка), `holding` (каса).
- 0092: `intermodal_shipments` (линия, посока, градове, стока, двата курса, статус, първи шофьор, кога пристига линията) и `city_markets.supply`; категория `intermodal_bonus`. `job_state`: `territories`, `holding-fees`, `intermodal`, `intermodal-release`.
- 0093: `community_tournaments` (организатор, мярка, филтри, дати, награден фонд, такса, лимит, съобщение, статус) и `community_cup_entries` (точки). Категории `era_bonus`, `tournament`; опит `lane`. `job_state`: `community-cups`, `lane:<курс>`.
- 0099: `organization_achievements` (компания, ключ, кога) — постиженията на компаниите (1.1.3.1).
- 0100: `ideas.discord_votes` и `idea_votes.source` (`game` | `discord`) — колко от гласовете за идея са от бутона в Discord (1.1.3.4).
- 1.1.3.5 (без миграция): в `job_state` — `staff-note:<играч>` (бележка на екипа: текст, кой, кога) и `discord-remind:<доставка>` (/напомни); записите в `errors:recent` имат и `digest` (кодът от страницата за грешка).
- 0101: `trip_queue` (компания, камион, поръчка, кой я сложи) — опашката от курсове (1.1.4.1). В `job_state`: `big-run:<седмица>`, `rival:<седмица>:<играч>`, `rival-state:<седмица>:<играч>`, `features:off` (спрени функции), `discord-live-ranking`.
