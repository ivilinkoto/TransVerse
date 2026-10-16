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

## Маршрутизация в продукция
По подразбиране се използва публичният Valhalla сървър на FOSSGIS (`valhalla1.openstreetmap.de`). Той е подходящ за начало и тестове, но има правила за умерена употреба. Играта:
- кешира всеки маршрут в базата (една заявка на двойка градове завинаги);
- прави най-много ~1 заявка/сек;
- при недостъпност използва **ясно обозначена** приблизителна оценка и по-късно я надгражда.

При растеж: собствен Valhalla сървър (нужен е по-голям VPS, ~8 GB RAM за Европа) или платен доставчик — сменя се само `VALHALLA_URL` / модулът `src/server/geo/routing.ts`.

## Архивиране
```bash
sudo -u postgres pg_dump transverse | gzip > /root/transverse-$(date +%F).sql.gz
```
Препоръка: ежедневен cron и копие извън сървъра.


## Плащания

Покупките на ТрансКоин и VIP с реални пари минават през **PayPal** (сега) и **Stripe** (по-късно, когато има домейн с HTTPS). Докато настройките липсват, магазинът показва пакетите като „Скоро“ и нищо не може да се плати. Състоянието се вижда в „Админ панел → Плащания“.

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
| `APP_URL` | по избор — публичният адрес (напр. `http://203.161.47.213`, после `https://домейн`) |
| `PAYPAL_WEBHOOK_ID` | по избор, след HTTPS — за възстановявания/оспорвания, направени в PayPal |

След добавяне или промяна: GitHub → Actions → Deploy → Run workflow (или следващото обединяване в main).

### PayPal
1. **Бизнес сметка**: paypal.com → Business акаунт на фирмата (потвърдени имейл, фирма и банкова сметка).
2. **Приложение**: developer.paypal.com (вход със същата сметка) → Apps & Credentials → първо раздел **Sandbox** → Create App (тип Merchant) → копирай Client ID и Secret в GitHub Secrets заедно с `PAYPAL_ENV=sandbox`.
3. **Тест**: в developer.paypal.com → Sandbox accounts има тестов „Personal“ купувач (имейл и парола). В играта: Магазин → „Плати с PayPal“ → вход с тестовия купувач → плащане. ТрансКоин се появяват веднага, а в „Админ панел → Плащания“ — „платено“.
4. **Реални плащания**: в developer.paypal.com превключи на **Live** → Create App → нови Client ID и Secret → замени ги в GitHub Secrets и смени `PAYPAL_ENV` на `live` → Deploy.
5. По желание в настройките на PayPal бизнес сметката: Website payments → включи плащане с карта без PayPal сметка (PayPal account optional), ако е налично за страната.

Как работи: сървърът създава поръчка в PayPal с цената от сървъра → играчът одобрява в PayPal → при връщането сървърът потвърждава плащането (capture) директно с PayPal и доставя само при статус COMPLETED и точно същата сума. Ако играчът затвори браузъра след одобрението, фоновият процес довършва поръчката до 2 минути; неодобрени поръчки изтичат след 3 часа. Webhook не е задължителен.

Връщане на сума: „Админ панел → Плащания → Върни сумата“ — връща парите през PayPal и премахва ТрансКоин / VIP дните (балансът може да стане отрицателен, ако вече са похарчени). Ако сумата се върне директно в PayPal или купувачът оспори плащането, това се отразява автоматично само при настроен webhook (`https://домейн/api/payments/paypal`, събития `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.CAPTURE.DENIED`, `CHECKOUT.ORDER.APPROVED`; Webhook ID → `PAYPAL_WEBHOOK_ID`) — иначе използвай бутона в админ панела.

### Stripe (след домейна)
Изисква домейн с HTTPS (Caddy, после `COOKIE_SECURE=true`). В Stripe: активиран акаунт на фирмата, включени методи на плащане (карти, Apple/Google Pay), разписки по имейл, webhook `https://домейн/api/payments/stripe` със събития `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Secrets: `STRIPE_SECRET_KEY` (sk_test_… / sk_live_…), `STRIPE_WEBHOOK_SECRET` (whsec_…), по избор `STRIPE_AUTOMATIC_TAX=true`. Тестова карта: 4242 4242 4242 4242. Възстановяване — от таблото на Stripe (отразява се автоматично).

Тестовете (`tests/payments.test.ts`, `tests/paypal.test.ts`) проверяват подписите/проверката на уведомленията, еднократната доставка при повторения, отказ при различна сума, сверката от фоновия процес, възстановяванията и зареждането на ключовете.
