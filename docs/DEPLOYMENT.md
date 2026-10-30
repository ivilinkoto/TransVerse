# Публикуване на VPS (стъпка по стъпка)

Схема: **GitHub Actions** изгражда готова версия → качва я по SSH на сървъра → прилага миграциите → превключва версията → рестартира услугите. На сървъра не се компилира нищо (2 GB RAM са достатъчни за работа, но не и за build).

```
GitHub (push в main) ──► Actions: build + bundle ──► scp ──► VPS: release.sh
                                                              ├─ миграции + география
                                                              ├─ current → нова версия
                                                              └─ restart: transverse-web, transverse-worker
Браузър ──► Caddy :80/:443 ──► Next.js :3000 ──► PostgreSQL
                                   ▲
                    transverse-worker (доставки, пазар, заплати, сезони)
```

## Вече направено (Част А)
- потребител `deploy`, SSH порт 22022, защитна стена;
- GitHub тайни: `VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_SSH_KEY`.

## Част Б — еднократна подготовка на сървъра (≈10 минути)

1. Влез като root: `ssh -p 22022 root@IP_НА_СЪРВЪРА`
2. Изтегли скриптовете (репото е публично за четене от GitHub, или копирай папката `deploy/`):
   ```bash
   apt-get install -y git
   git clone --depth 1 -b main https://github.com/ivilinkoto/TransVerse.git /root/transverse-src
   ```
   > Ако репото е частно, използвай `scp -P 22022 -r deploy root@IP:/root/transverse-src/deploy` от компютъра си.
3. Пусни подготовката:
   ```bash
   bash /root/transverse-src/deploy/setup-server.sh
   ```
   Скриптът инсталира Node.js 22, PostgreSQL 16 и Caddy, създава база данни със случайна парола (записана само в `/etc/transverse/transverse.env`), systemd услугите и правото на `deploy` да рестартира **само** тях.
4. Слей работния клон в `main` в GitHub (Pull Request → Merge). Това стартира **Deploy** workflow. Можеш да го пуснеш и ръчно: GitHub → **Actions** → **Deploy** → **Run workflow**.
5. Отвори `http://IP_НА_СЪРВЪРА` в браузъра.

Основатели: при всяко публикуване акаунтите **ANGELov** и **V3s1chaa** (ако са регистрирани) получават длъжност „Основател / Главен администратор“ (списъкът се сменя с `FOUNDER_USERNAMES`, напр. `ANGELov,V3s1chaa`). Админ панелът е на `/admin`.

Полезни команди на сървъра:
```bash
systemctl status transverse-web transverse-worker   # състояние
journalctl -u transverse-worker -f                   # логове на симулацията на живо
journalctl -u transverse-web -n 100                  # последни логове на сайта
```

## Домейн (когато купиш transverse.bg)
1. DNS: запис **A** `@` → IP на сървъра, и **A** `www` → същия IP.
2. На сървъра: в `/etc/caddy/Caddyfile` замени `:80 {` с `transverse.bg, www.transverse.bg {` и изпълни `systemctl reload caddy`. Caddy сам взима HTTPS сертификат (Let's Encrypt).
3. В `/etc/transverse/transverse.env` смени `COOKIE_SECURE=false` на `true` и изпълни `systemctl restart transverse-web`.

## Шрифтове

Шрифтовете на сайта (Exo 2, Onest, JetBrains Mono — SIL Open Font License, лицензите са до файловете) са в проекта: `src/app/fonts/*.woff2` (сайтът, през `next/font/local`) и `public/fonts/*.ttf` (картинките за Discord). Компилацията и сайтът не теглят нищо от Google Fonts, така че прекъсване там не спира CI и деплоя. Файловете са изрязани до латиница и кирилица и до използваните тегла (fontTools: `pyftsubset` + `varLib.instancer`).

## Маршрутизация в продукция
По подразбиране се използва публичният Valhalla сървър на FOSSGIS (`valhalla1.openstreetmap.de`). Той е подходящ за начало и тестове, но има правила за умерена употреба. Играта:
- кешира всеки маршрут в базата (една заявка на двойка градове завинаги);
- прави най-много ~1 заявка/сек;
- при недостъпност използва **ясно обозначена** приблизителна оценка и по-късно я надгражда.

При растеж: собствен Valhalla сървър (нужен е по-голям VPS, ~8 GB RAM за Европа) или платен доставчик — сменя се само `VALHALLA_URL` / модулът `src/server/geo/routing.ts`.

## Архивиране
От 1.1.4 фоновият процес (worker) прави копие на базата всяка нощ около 03:00 (Sofia) с `pg_dump` в `/var/www/transverse/shared/backups/transverse-ГГГГ-ММ-ДД.sql.gz` (или в `BACKUP_DIR`, ако е зададена). Пазят се последните 14. Състоянието (последно копие, размер, грешка) се вижда в „Админ панел → Система“. Ако там пише грешка за `pg_dump`, провери, че пакетът `postgresql-client` е инсталиран и е същата главна версия като сървъра.

Ръчно копие:
```bash
sudo -u postgres pg_dump transverse | gzip > /root/transverse-$(date +%F).sql.gz
```

Копие извън сървъра (от твоя компютър):
```bash
scp deploy@СЪРВЪРА:/var/www/transverse/shared/backups/transverse-$(date +%F).sql.gz .
```

Връщане от копие (спира играта за минута — направи го в тих час):
```bash
sudo systemctl stop transverse-web transverse-worker
sudo -u postgres dropdb transverse && sudo -u postgres createdb -O transverse transverse
gunzip -c transverse-ГГГГ-ММ-ДД.sql.gz | sudo -u postgres psql transverse
sudo systemctl start transverse-web transverse-worker
```


## Плащания

Покупките на ТрансКоин и VIP с реални пари минават през **PayPal** и **Stripe** (карта, Apple Pay / Google Pay; изисква HTTPS на домейна). Докато настройките липсват, магазинът показва пакетите като „Скоро“ и нищо не може да се плати. Състоянието се вижда в „Админ панел → Плащания“.

### Къде се пазят ключовете
В **GitHub → репозиторито → Settings → Secrets and variables → Actions → New repository secret**. При всеки Deploy те се записват на сървъра във файл `/var/www/transverse/shared/secrets.env` (достъпен само за потребителя deploy) и уеб приложението и фоновият процес ги зареждат при старт. Не влизат в кода, в build-а или в лога. Никога не ги пращай в чат.

| Secret | Стойност |
|---|---|
| `PAYPAL_CLIENT_ID` | Client ID на PayPal приложението |
| `PAYPAL_CLIENT_SECRET` | Secret на PayPal приложението |
| `PAYPAL_ENV` | `sandbox` за тест, `live` за реални пари (без него — sandbox) |
| `SELLER_NAME` | наименованието на фирмата |
| `SELLER_ID` | ЕИК |
| `SELLER_ADDRESS` | адрес на управление |
| `SUPPORT_EMAIL` | имейл за връзка с купувачите |
| `APP_URL` | по избор — публичният адрес, напр. `https://transverse-bg.com` (пълен, с `https://`) |
| `COOKIE_SECURE` | `true`, когато сайтът е на HTTPS (бисквитката за вход минава само по защитена връзка) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | имейли (потвърждаване, забравена парола) — от доставчика, напр. Brevo: `smtp-relay.brevo.com`, порт `587`; `MAIL_FROM` напр. `TransVerse <no-reply@transverse-bg.com>` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | по избор — ключове за push известия (без тях се генерират автоматично) |
| `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` | по избор — ботът в Discord (виж `docs/DISCORD.md`); без тях ботът е изключен |
| `PAYPAL_WEBHOOK_ID` | по избор, след HTTPS — за възстановявания/оспорвания, направени в PayPal |

След добавяне или промяна: GitHub → Actions → Deploy → Run workflow (или следващото обединяване в main).

### PayPal
1. **Бизнес сметка**: paypal.com → Business акаунт на фирмата (потвърдени имейл, фирма и банкова сметка).
2. **Приложение**: developer.paypal.com (вход със същата сметка) → Apps & Credentials → първо раздел **Sandbox** → Create App (тип Merchant) → копирай Client ID и Secret в GitHub Secrets заедно с `PAYPAL_ENV=sandbox`.
3. **Тест**: в developer.paypal.com → Sandbox accounts има тестов „Personal“ купувач (имейл и парола). В играта: Магазин → „Плати с PayPal“ → вход с тестовия купувач → плащане. ТрансКоин се появяват веднага, а в „Админ панел → Плащания“ — „платено“.
4. **Реални плащания**: в developer.paypal.com превключи на **Live** → Create App → нови Client ID и Secret → замени ги в GitHub Secrets и смени `PAYPAL_ENV` на `live` → Deploy.
5. По желание в настройките на PayPal бизнес сметката: Website payments → включи плащане с карта без PayPal сметка (PayPal account optional), ако е налично за страната.

Как работи: сървърът създава поръчка в PayPal с цената от сървъра → играчът одобрява в PayPal → при връщането сървърът потвърждава плащането (capture) директно с PayPal и доставя само при статус COMPLETED и точно същата сума. Ако играчът затвори браузъра след одобрението, фоновият процес довършва поръчката до 2 минути; неодобрени поръчки изтичат след 3 часа. Webhook не е задължителен.

Ако плащане не започва: „Админ панел → Плащания“ показва под всяко неуспешно плащане кода на грешката от PayPal (напр. `AUTHENTICATION_FAILED`, `PAYEE_ACCOUNT_RESTRICTED`) и debug_id за поддръжката на PayPal, а бутонът „Провери връзката с PayPal“ казва дали ключовете са верни и дали не са за другия режим (sandbox ↔ live).

Връщане на сума: „Админ панел → Плащания → Върни сумата“ — връща парите през PayPal и премахва ТрансКоин / VIP дните (балансът може да стане отрицателен, ако вече са похарчени). Ако сумата се върне директно в PayPal или купувачът оспори плащането, това се отразява автоматично само при настроен webhook (`https://домейн/api/payments/paypal`, събития `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.CAPTURE.DENIED`, `CHECKOUT.ORDER.APPROVED`; Webhook ID → `PAYPAL_WEBHOOK_ID`) — иначе използвай бутона в админ панела.

### Stripe
Изисква домейн с HTTPS (Caddy, после `COOKIE_SECURE=true`). В Stripe: активиран акаунт на фирмата, включени методи на плащане (карти, Apple/Google Pay), разписки по имейл, webhook `https://домейн/api/payments/stripe` със събития `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Secrets: `STRIPE_SECRET_KEY` (sk_test_… / sk_live_…), `STRIPE_WEBHOOK_SECRET` (whsec_…), по избор `STRIPE_AUTOMATIC_TAX=true`. Тестова карта: 4242 4242 4242 4242. Възстановяване — от таблото на Stripe (отразява се автоматично).

Тестовете (`tests/payments.test.ts`, `tests/paypal.test.ts`) проверяват подписите/проверката на уведомленията, еднократната доставка при повторения, отказ при различна сума, сверката от фоновия процес, възстановяванията и зареждането на ключовете.

## Имейли през Spacemail (Spaceship)

GitHub Secrets:
- `SMTP_HOST` = `mail.spacemail.com`
- `SMTP_PORT` = `465` (SSL/TLS се включва автоматично при 465)
- `SMTP_USER` = пълният адрес на пощенската кутия, напр. `no-reply@transverse-bg.com`
- `SMTP_PASS` = паролата на тази кутия
- `MAIL_FROM` = `TransVerse <no-reply@transverse-bg.com>`. Трябва да е същият адрес като `SMTP_USER` — Spacemail праща само от кутията, с която се влиза.

DNS записи (в Spaceship → домейнът → Advanced DNS; при DNS на Spaceship повечето се добавят сами):
- **MX:** `mx1.spacemail.com` и `mx2.spacemail.com`, приоритет 0.
- **SPF:** TXT на `@`: `v=spf1 include:spf.spacemail.com ~all`. Записът трябва да е само един. Ако има друг SPF запис, слей ги в един.
- **DKIM:** TXT `spacemail._domainkey`. Стойността е лична за акаунта: в Advanced DNS → Inactive records (започва с `v=DKIM1; k=rsa;`), там трябва да се активира. Започва да работи след няколко часа.
- **DMARC:** TXT на `_dmarc`: `v=DMARC1; p=none; rua=mailto:<твой имейл>`.

## Имейлите стигат до Gmail, но не и до abv.bg / mail.bg

Пощите abv.bg, mail.bg и dir.bg са строги: приемат писма само от домейн, който е удостоверен. Gmail понякога пропуска и неудостоверени писма. Затова писмата стигат до Gmail, но не и до abv.bg / mail.bg.

1. **MAIL_FROM** трябва да е адрес на твоя домейн, например `TransVerse <no-reply@transverse-bg.com>`.
   - Не @gmail.com, @abv.bg и т.н. Писма „от“ тези домейни, пратени през чужд сървър, не минават проверката.
   - При Spacemail адресът трябва да е същият като `SMTP_USER`. При Brevo трябва да е добавен като подател (Senders).
   - Записите при Spacemail са в раздела по-горе. Следващите две стъпки са само ако ползваш Brevo.
2. **В Brevo:** Senders, Domains & Dedicated IPs → Domains → Add a domain → `transverse-bg.com`. Brevo показва 3–4 DNS записа.
3. **При регистратора** (DNS на домейна) добави точно показаните записи:
   - DKIM: `brevo1._domainkey` и `brevo2._domainkey` (CNAME) или TXT `mail._domainkey`;
   - кода за собственост `brevo-code:…` (TXT на `@`);
   - SPF: TXT на `@`: `v=spf1 include:spf.brevo.com ~all`. Ако вече има SPF запис, добави само `include:spf.brevo.com` в него — трябва да има един SPF запис;
   - DMARC: TXT на `_dmarc`: `v=DMARC1; p=none; rua=mailto:<твоя имейл>`.
4. **Потвърждаване:** след 15–60 минути натисни Authenticate в Brevo. Всички записи трябва да светнат в зелено.
5. **Проверка от играта:** в админ панела → **Имейли** се вижда дали SPF, DKIM и DMARC са намерени. Там изпрати пробно писмо до адрес в abv.bg и mail.bg. Дневникът показва отговора на сървъра за всяко писмо. В Brevo → Transactional → Logs се вижда и крайният отговор на получаващата поща.

Докато това се оправи, играч без писмо може да бъде отключен от админ панела:
- **Потребители** → играчът → **Потвърди имейла ръчно**;
- или **Линк за нова парола**.
