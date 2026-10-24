import type { Metadata } from 'next';
import { LegalShell, SellerDetails } from '@/components/legal/LegalShell';
import { paymentConfig } from '@/server/payments';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Поверителност') };
}
export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  await initLocale();
  const { seller } = paymentConfig();
  return (
    <LegalShell title={t('Политика за поверителност')} updated="17.10.2026">
      <section>
        <h2>{t('Администратор на данните')}</h2>
        <SellerDetails seller={seller} />
      </section>
      <section>
        <h2>{t('Какви данни събираме и защо')}</h2>
        <ul>
          <li><strong>{t('Профил')}</strong>{t(': потребителско име, имейл, парола (само като защитен хеш) — за да играеш и да влизаш в профила си.')}</li>
          <li><strong>{t('Игрови данни')}</strong>{t(': автопарк, доставки, компании, съобщения в чата на компанията, известия — това е самата игра.')}</li>
          <li><strong>{t('Сигурност')}</strong>{t(': IP адрес и време на заявки — за защита от злоупотреби (ограничения на опитите), пазят се кратко.')}</li>
          <li><strong>{t('Покани')}</strong>{t(': при регистрация пазим само необратим хеш на IP адреса (не самия адрес), за да не се награждават покани от една и съща мрежа.')}</li>
          <li><strong>{t('Покупки')}</strong>{t(': продукт, сума, статус и идентификатор на плащането при платежния доставчик (PayPal, Stripe) — за доставка на покупката и счетоводство. Данните за картата или PayPal сметката се обработват само от доставчика (paypal.com, stripe.com — техните политики за поверителност), не и от нас.')}</li>
        </ul>
      </section>
      <section>
        <h2>{t('Бисквитки')}</h2>
        <p>{t('Използваме само необходима бисквитка за вход в профила. Не използваме рекламни бисквитки и проследяване от трети страни.')}</p>
      </section>
      <section>
        <h2>{t('Колко дълго пазим данните')}</h2>
        <p>{t('Докато профилът съществува. Данните за плащания пазим толкова, колкото изисква счетоводното законодателство.')}</p>
      </section>
      <section>
        <h2>{t('Твоите права')}</h2>
        <p>{t('Имаш право на достъп, поправка, изтриване, ограничаване, преносимост и възражение (GDPR). Пиши ни на имейла по-горе или чрез „Поддръжка“ в играта. Можеш да подадеш жалба и до Комисията за защита на личните данни (cpdp.bg).')}</p>
      </section>
    </LegalShell>
  );
}
