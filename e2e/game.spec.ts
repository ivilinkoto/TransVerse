import { expect, test, type Page } from '@playwright/test';
import { releaseByVersion } from '../src/lib/game/releases';

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function register(page: Page) {
  const tag = unique();
  await page.goto('/register');
  await page.fill('#username', `e2e_${tag}`.slice(0, 20));
  await page.fill('#email', `e2e${tag}@example.com`);
  await page.fill('#password', 'abc123'); // 6 characters are enough
  await page.fill('#passwordConfirm', 'abc123');
  await page.check('#acceptTerms');
  // 1.1.2: the browser solves the "Не съм робот" puzzle.
  await page.click('#captcha');
  await expect(page.locator('#captcha')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await page.click('button[type=submit]');
  await page.waitForURL('**/game');
  await expect(page.getByRole('heading', { name: 'Табло' })).toBeVisible();
  return tag;
}

test.describe('public site', () => {
  test('landing page shows real data and auth entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Пътищата са истински');
    await expect(page.getByRole('heading', { name: 'От първия курс до своя компания' })).toBeVisible();
    await page.getByRole('tab', { name: 'Търгове' }).click();
    await expect(page.getByRole('heading', { name: 'Специални товари на търг', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Какво се случва на пътя в момента' })).toBeVisible();
    await page.getByText('Безплатна ли е играта?').click();
    await expect(page.getByText('Цялата игра е безплатна', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('link', { name: 'Регистрация' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Вход' }).first()).toBeVisible();
    await expect(page.locator('#map').getByText('София → Пловдив')).toBeVisible();
  });

  test('release notes are public', async ({ page }) => {
    await page.goto('/updates');
    await expect(page.getByRole('heading', { name: 'Обновления', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Нощта на тиквите' })).toBeVisible();
  });
});

test.describe('access control', () => {
  test('anonymous visitors are redirected and APIs refuse them', async ({ page, request }) => {
    await page.goto('/game/finance');
    await expect(page).toHaveURL(/\/login/);
    for (const path of ['/api/geo/cities?bbox=20,40,30,45&zoom=6', '/api/events']) {
      expect((await request.get(path)).status()).toBe(401);
    }
    const action = await request.post('/api/game/action', { data: { type: 'markNotificationsRead' }, headers: { Origin: 'http://localhost:3000' } });
    expect(action.status()).toBe(401);
  });

  test('cross-site POSTs are rejected', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { login: 'a', password: 'b' }, headers: { Origin: 'https://evil.example' } });
    expect(res.status()).toBe(403);
  });

  test('wrong password is rejected with a clear message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login', 'nobody-here');
    await page.fill('#password', 'not the password');
    await page.click('button[type=submit]');
    await expect(page.locator('form [role=alert]')).toContainText('Грешен');
  });
});

test.describe('core loop', () => {
  test('register as an independent driver, follow the tutorial and send the rented truck', async ({ page }) => {
    await register(page);
    await expect(page.getByText('1500 лв.').or(page.getByText('1 500 лв.')).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('стъпка 1 от 6');
    await page.getByRole('button', { name: 'Да започваме' }).click();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('Приеми първата си поръчка');
    await page.goto('/game/contracts');
    await page.getByLabel('Само изпълними с моя автопарк').check();
    await page.locator('li.panel button[aria-expanded]').first().click();
    await page.getByRole('button', { name: 'Приеми и изпрати' }).click();
    // The player stays on the board; a note links to the fleet.
    await expect(page.getByRole('status').filter({ hasText: 'Камионът тръгна' })).toBeVisible();
    await expect(page).toHaveURL(/\/game\/contracts/);
    await page.goto('/game/fleet');
    await expect(page.getByText('На курс')).toBeVisible();
    await expect(page.getByText('Нает').first()).toBeVisible();
    await expect(page.getByText(/остават/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('Проследи камиона на картата');
  });

  test('the market is open without a company; hiring drivers still needs one', async ({ page }) => {
    await register(page);
    await page.goto('/game/market');
    await expect(page.getByRole('heading', { name: 'Пазар на техника' })).toBeVisible();
    // 1.1.2: new players start with a free depot (3 places) — the rented truck takes one.
    await expect(page.getByText(/Места в депата: 1 \/ 3/)).toBeVisible();
    await page.goto('/game/missions');
    await expect(page.getByRole('heading', { name: 'Мисии', exact: true })).toBeVisible();
    await expect(page.getByText('Дневни мисии')).toBeVisible();
    await expect(page.getByText('Сезонни мисии')).toBeVisible();
    await page.goto('/game/shop');
    await expect(page.getByRole('heading', { name: 'Магазин', exact: true })).toBeVisible();
    await expect(page.getByText('VIP · 30 дни', { exact: true })).toBeVisible();
    await expect(page.getByText('Купи ТрансКоин')).toBeVisible();
    await page.goto('/game/licences');
    await expect(page.getByRole('heading', { name: 'Международен лиценз' })).toBeVisible();
    await page.goto('/game/clients');
    await expect(page.getByRole('heading', { name: 'Клиенти', exact: true })).toBeVisible();
    await expect(page.getByText('Оферти', { exact: true })).toBeVisible();
    await page.goto('/game/staff');
    await expect(page.getByText('изисква транспортна компания')).toBeVisible();
    await page.getByRole('link', { name: 'Към основаването на компания' }).click();
    await expect(page.getByText('Изисквания за основаване')).toBeVisible();
    await expect(page.getByRole('button', { name: /Основи компания/ })).toBeDisabled();
  });

  test('independent drivers can browse player companies and see how to join', async ({ page }) => {
    await register(page);
    await page.goto('/game/company');
    await expect(page.getByRole('heading', { name: 'Присъедини се към компания' })).toBeVisible();
    await page.getByRole('link', { name: 'Разгледай компаниите' }).click();
    await page.waitForURL('**/game/companies');
    await expect(page.getByRole('heading', { name: 'Компании', exact: true })).toBeVisible();
    const first = page.locator('a[href^="/game/companies/"]').first();
    if (await first.count()) {
      await first.click();
      await expect(page.getByRole('heading', { name: 'Присъединяване' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Какво получават членовете' })).toBeVisible();
    }
    await page.goto('/game/leaderboards?tab=companies');
    await expect(page.getByRole('navigation', { name: 'Вид класация' }).getByRole('link', { name: 'Компании', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('players can contact support; the admin panel is staff-only', async ({ page }) => {
    await register(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/game$/);
    await page.goto('/game/support');
    await page.fill('#subject', 'Въпрос за наема');
    await page.fill('#body', 'Колко точно се удържа за наем при всеки курс?');
    await page.getByRole('button', { name: 'Изпрати запитване' }).click();
    await page.waitForURL(/\/game\/support\/[0-9a-f-]{36}/);
    await expect(page.getByText('Колко точно се удържа')).toBeVisible();
  });

  test('the world map renders real cities', async ({ page }) => {
    await register(page);
    await page.goto('/game/map');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
    expect(box!.height).toBeGreaterThan(300);
    // Other players' trucks come from the shared world snapshot .
    await expect(page.getByText(/Други играчи \(\d+, \d+ в играта\)/)).toBeVisible({ timeout: 15_000 });
    const world = await page.request.get('/api/world');
    expect(world.status()).toBe(200);
    const body = (await world.json()) as { trucks: { player: string }[] };
    expect(body.trucks.length).toBeGreaterThan(0);
  });
});

test('opening notifications marks them as read', async ({ page }) => {
  await register(page);
  const badge = page.locator('header').getByRole('link', { name: /Известия/ });
  await expect(badge).toContainText('1');
  await badge.click();
  await expect(page.getByText('Ново').first()).toBeVisible();
  await page.goto('/game');
  await expect(page.locator('header').getByRole('link', { name: /Известия/ })).not.toContainText(/\d/);
});

test('navigation: four sections and „Още“ in the sidebar, account pages in the avatar menu', async ({ page }) => {
  await register(page);
  const aside = page.locator('aside');
  for (const name of ['Табло', 'Карта', 'Поръчки', 'Автопарк']) await expect(aside.getByRole('link', { name })).toBeVisible();
  // 1.1.4.1: Компания and Състезание are in „Още“.
  await expect(aside.getByRole('link', { name: 'Компания' })).toHaveCount(0);
  await aside.getByRole('button', { name: 'Още' }).click();
  const more = page.getByRole('dialog', { name: 'Още раздели' });
  await expect(more.getByRole('heading', { name: 'Компания' })).toBeVisible();
  await expect(more.getByRole('heading', { name: 'Състезание' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toHaveCount(0);
  await expect(aside.getByRole('link', { name: /Магазин и VIP/ })).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Финанси' })).toHaveCount(0);
  const header = page.locator('header');
  await header.getByRole('button', { name: 'Профил и още' }).click();
  await page.getByRole('menuitem', { name: 'Финанси' }).click();
  await expect(page).toHaveURL(/\/game\/finance$/);
  await expect(page.getByRole('menuitem', { name: 'Финанси' })).toHaveCount(0);
  await header.getByRole('button', { name: 'Профил и още' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await header.getByRole('button', { name: 'Профил и още' }).click();
  await page.getByRole('menuitem', { name: 'Изход' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('section tabs: Автопарк and Състезание group their pages', async ({ page }) => {
  await register(page);
  await page.locator('aside').getByRole('link', { name: 'Автопарк' }).click();
  const fleetTabs = page.getByRole('navigation', { name: 'Автопарк' });
  await fleetTabs.getByRole('link', { name: 'Сервиз' }).click();
  await expect(page.getByRole('heading', { name: 'Сервиз', exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: 'Автопарк' })).toHaveAttribute('aria-current', 'page');
  // 1.1.4.1: Състезание is reached through „Още“.
  await page.locator('aside').getByRole('button', { name: 'Още' }).click();
  await page.getByRole('dialog', { name: 'Още раздели' }).getByRole('link', { name: /^Мисии/ }).click();
  await page.getByRole('navigation', { name: 'Състезание' }).getByRole('link', { name: 'Ивенти' }).click();
  await expect(page.getByRole('heading', { name: 'Ивенти', exact: true })).toBeVisible();
  // Either a running/announced event with its goal or the empty state.
  await expect(page.getByText(/Награди, ако целта бъде постигната|В момента няма ивент/).first()).toBeVisible();
});

test('invite link opens sign-up with the inviter; used market and company seasons are reachable', async ({ page, browser }) => {
  const tag = await register(page);
  await page.goto('/game/invite');
  const link = await page.getByRole('textbox', { name: 'Твоят линк за покана' }).inputValue();
  expect(link).toMatch(/\/r\/[A-Z2-9]{8}$/);
  await page.goto('/game/market?show=used');
  await expect(page.getByRole('heading', { name: 'Употребявана техника от играчи' })).toBeVisible();
  await page.goto('/game/seasons?tab=companies');
  await expect(page.getByRole('heading', { name: 'Класация на компаниите' })).toBeVisible();
  const friend = await browser.newContext();
  const p2 = await friend.newPage();
  await p2.goto(new URL(link).pathname);
  await expect(p2).toHaveURL(/\/register\?ref=/);
  await expect(p2.getByText(`e2e_${tag}`.slice(0, 20))).toBeVisible();
  await friend.close();
});

test('chat dock: global message, player card, profile and settings are separate', async ({ page }) => {
  const tag = await register(page);
  await page.getByRole('button', { name: /^Чат/ }).click();
  const dock = page.getByRole('region', { name: 'Чат' });
  await expect(dock.getByRole('button', { name: 'Глобален' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Търговия' })).toBeVisible();
  const text = `Здравейте от e2e ${tag}`;
  await dock.getByRole('textbox', { name: 'Съобщение' }).fill(text);
  await dock.getByRole('button', { name: 'Изпрати' }).click();
  await expect(dock.getByText(text)).toBeVisible();
  // Clicking a name opens that player's card.
  await dock.getByRole('button', { name: `e2e_${tag}`.slice(0, 20) }).first().click();
  const card = page.getByRole('dialog', { name: /Профил на/ });
  await expect(card.getByText('Онлайн сега')).toBeVisible();
  await card.getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await page.goto('/game/profile');
  await expect(page.getByRole('heading', { name: 'Профил', exact: true })).toBeVisible();
  await expect(page.getByText(/Приятели · \d+ онлайн/)).toBeVisible();
});

test('terms and privacy pages are public', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Общи условия за ползване и покупки' })).toBeVisible();
  await expect(page.getByText('Право на отказ')).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Политика за поверителност' })).toBeVisible();
});

test('forgot password is reachable from the login page and never reveals accounts', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Забравена парола?' }).click();
  await expect(page.getByRole('heading', { name: 'Забравена парола' })).toBeVisible();
  await page.fill('#email', `nobody${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Изпрати линк за нова парола' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto('/reset-password?token=not-a-real-token-1234567890');
  await expect(page.getByText('Линкът е невалиден, изтекъл или вече използван.')).toBeVisible();
});

test('@mobile dashboard is usable on a phone without horizontal scrolling', async ({ page }) => {
  await register(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const bottom = page.getByRole('navigation', { name: 'Основна навигация' });
  await bottom.getByRole('link', { name: 'Поръчки' }).click();
  await expect(page.getByRole('heading', { name: 'Поръчки', exact: true })).toBeVisible();
  await bottom.getByRole('button', { name: 'Още', exact: true }).click();
  await page.getByRole('dialog', { name: 'Още раздели' }).getByRole('link', { name: 'Класации' }).click();
  await expect(page.getByRole('heading', { name: 'Класации', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('v1.1 pages: dispatcher, special loads, analytics, newspaper, help, updates', async ({ page }) => {
  await register(page);
  await page.goto('/game/contracts');
  await expect(page.getByText('Диспечер', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Предложи курсове' }).click();
  await expect(page.getByRole('button', { name: /Изпрати \d/ }).or(page.getByText('Няма подходящи поръчки'))).toBeVisible();
  await page.getByRole('button', { name: '★ Любими линии' }).click();
  await expect(page.getByRole('button', { name: '★ Любими линии' })).toHaveAttribute('aria-pressed', 'true');
  for (const [path, heading] of [
    ['/game/auctions', 'Специални товари'],
    ['/game/analytics', 'Анализ'],
    ['/game/news', 'Седмичник TransVerse'],
    ['/game/help', 'Помощ и правила'],
    ['/game/updates', 'Обновления'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole('heading', { name: 'Нощта на тиквите' }).first()).toBeVisible();
});

test('v1.2: search, money transfers, map filter', async ({ page }) => {
  // Before the release date these are staff-only: a player does not see them yet.
  const live = Date.now() >= Date.parse(releaseByVersion('1.2')!.publishedAt);
  await register(page);
  if (!live) {
    await expect(page.getByRole('button', { name: 'Търси играч или компания' })).toHaveCount(0);
    await page.goto('/game/finance');
    await expect(page.getByText('Преводи между играчи')).toHaveCount(0);
    await page.goto('/game/mentor');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Търси играч или компания' }).click();
  await page.getByRole('textbox', { name: 'Име на играч или компания' }).fill('zz-nobody-here');
  await expect(page.getByText('Няма играч или компания')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/game/finance');
  await expect(page.getByText('Преводи между играчи')).toBeVisible();
  await expect(page.getByText(/лв\./).first()).toBeVisible();
  await page.goto('/game/map');
  await expect(page.getByRole('radiogroup', { name: 'Кои играчи да се виждат' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('1.1.4.2: the promise on the board, the new pages and the public tracking page', async ({ page }) => {
  // Before the release the features are for the team only; a new player sees them from 1.11 08:00.
  test.skip(Date.now() < Date.parse(releaseByVersion('1.1.4.2')!.publishedAt), '1.1.4.2 is not out yet');
  await register(page);
  await page.goto('/game/contracts');
  await expect(page.getByRole('radiogroup', { name: 'Обещан срок' })).toBeVisible();
  await page.getByRole('radio', { name: /Бързо/ }).click();
  await expect(page.getByRole('radio', { name: /Бързо/ })).toHaveAttribute('aria-checked', 'true');
  for (const [path, heading] of [['/game/growth', 'Развитие'], ['/game/reviews', 'Отзиви от клиентите'], ['/game/player-challenges', 'Предизвикателства от играчи'], ['/game/case', 'Изгубена пратка']] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  // An unknown tracking link is a 404, not an error.
  const res = await page.goto('/track/nope-nope');
  expect(res?.status()).toBe(404);
});
