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


## Плащания (Stripe)

Покупките на ТрансКоин и VIP с реални пари минават през **Stripe Checkout**: играчът плаща на защитената страница на Stripe (карта, PayPal, Apple Pay, Google Pay, Revolut Pay — каквото е включено в таблото на Stripe), а Stripe уведомява сървъра чрез подписан webhook и покупката се добавя автоматично. Данни за карти не минават през сървъра. Докато настройките по-долу липсват, магазинът показва пакетите като „Скоро“ и нищо не може да се плати.

1. **Домейн и HTTPS** (задължително за реални плащания): насочи домейна към сървъра и включи HTTPS в Caddy (виж по-горе), после `COOKIE_SECURE=true`.
2. **Акаунт в Stripe**: регистрация на stripe.com (физическо лице/ЕТ/фирма), попълване на данните и банковата сметка. В Settings → Payment methods включи PayPal и останалите желани методи. В Settings → Emails включи разписките до клиентите.
3. **Webhook**: Developers → Webhooks → Add endpoint, адрес `https://ДОМЕЙН/api/payments/stripe`, събития `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Копирай „Signing secret“ (`whsec_…`).
4. **Настройки на сървъра** — само във файла `/etc/transverse/transverse.env` (никога в кода, GitHub или чат):
   ```
   STRIPE_SECRET_KEY=sk_test_…   # първо тестов ключ; после sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   APP_URL=https://ДОМЕЙН
   SELLER_NAME=…                 # търговецът, както е регистриран в Stripe
   SELLER_ID=…                   # ЕИК (ако има)
   SELLER_ADDRESS=…
   SUPPORT_EMAIL=…
   STRIPE_AUTOMATIC_TAX=false    # true, ако си регистриран по ДДС и ползваш Stripe Tax
   ```
   След промяна: `sudo systemctl restart transverse-web`.
5. **Тест**: с `sk_test_…` купи пакет с тестова карта `4242 4242 4242 4242` (всяка бъдеща дата, всеки CVC). В „Админ панел → Плащания“ трябва да се появи „платено“, а ТрансКоин — в профила. После смени с `sk_live_…` и webhook-а за live режим.

Възстановяване на сума: от таблото на Stripe (Payments → Refund). Сървърът получава `charge.refunded` и сам премахва ТрансКоин / VIP дните.
Тестовете (`tests/payments.test.ts`) проверяват подписа на webhook-а, еднократната доставка при повторени събития, отказ при различна сума, възстановяване и VIP.
