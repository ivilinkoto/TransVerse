import { redirect } from 'next/navigation';
import { AssetUpload, ProfileForm } from '@/components/company/forms';
import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { LIVERY_COLORS } from '@/lib/game/livery';
import { COMPANY_LIMITS, hasUnlock } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';

export const metadata = { title: 'Профил на компанията' };

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

export default async function CompanyProfilePage() {
  const { db, user, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  if (!can(hub.rank, 'edit_profile')) return <Card><p className="text-sm text-mist-400">Длъжността ви няма право да редактира профила на компанията.</p></Card>;
  const c = hub.company;
  const bannerUnlocked = hasUnlock(c.companyLevel, 'banner');
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Описание и правила">
        <ProfileForm initial={{ description: c.description ?? '', rules: c.rules ?? '', tag: c.tag ?? '', color: c.color ?? '' }} tagUnlocked={hasUnlock(c.companyLevel, 'tag')} colorUnlocked={bannerUnlocked} />
      </Card>
      <Card title="Изображения">
        <div className="space-y-6">
          <AssetUpload kind="logo" label="Лого" hasAsset={hub.assets.has('logo')} hint={`Квадратно изображение PNG, JPEG или WebP, до ${kb(COMPANY_LIMITS.logoMaxBytes)}.`} />
          <AssetUpload kind="banner" label="Банер" hasAsset={hub.assets.has('banner')} locked={bannerUnlocked ? null : 'Банерът се отключва на ниво 3 на компанията.'} hint={`Широко изображение (около 1500×400) PNG, JPEG или WebP, до ${kb(COMPANY_LIMITS.bannerMaxBytes)}.`} />
          <p className="text-xs text-mist-400">Качвайте само собствени изображения или такива, които имате право да използвате. Неподходящо съдържание се премахва от модераторите.</p>
        </div>
      </Card>
      {features.livery && (
        <Card title="Ливрея на камионите" className="lg:col-span-2">
          <p className="mb-3 text-sm text-mist-300">Цветът, с който се боядисват камионите на членовете — на страниците на автопарка, в гаража и на участъка. Специалните бои от магазина остават. Всеки член може да я изключи за себе си от Настройки.</p>
          <div className="flex flex-wrap items-center gap-3">
            {LIVERY_COLORS.map((l) => (
              <ActionButton key={l.id} action={{ type: 'setLivery', color: l.id }} className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${c.liveryColor === l.id ? 'border-cyan-glow text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`}>
                <span className="h-5 w-5 rounded-md border border-white/20" style={{ background: l.id }} />
                {l.label}
              </ActionButton>
            ))}
            {c.liveryColor && <ActionButton action={{ type: 'setLivery', color: null }} className="btn-ghost px-3 py-1.5 text-xs">Без ливрея</ActionButton>}
          </div>
          {c.liveryColor && <VehicleIllustration modelId="danubia-t440" trailerModelId="curtain-13" color={c.liveryColor} className="mt-4 h-20 w-auto" />}
        </Card>
      )}
    </div>
  );
}
