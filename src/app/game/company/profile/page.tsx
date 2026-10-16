import { redirect } from 'next/navigation';
import { AssetUpload, ProfileForm } from '@/components/company/forms';
import { Card } from '@/components/ui';
import { COMPANY_LIMITS, hasUnlock } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';

export const metadata = { title: 'Профил на компанията' };

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

export default async function CompanyProfilePage() {
  const { db, user } = await gameContext();
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
    </div>
  );
}
