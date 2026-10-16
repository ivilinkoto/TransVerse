import { expect, test, type Page } from '@playwright/test';

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function register(page: Page) {
  const tag = unique();
  await page.goto('/register');
  await page.fill('#username', `e2e_${tag}`.slice(0, 20));
  await page.fill('#email', `e2e${tag}@example.com`);
  await page.fill('#password', 'abc123'); // 6 characters are enough
  await page.click('button[type=submit]');
  await page.waitForURL('**/game');
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  return tag;
}

test.describe('public site', () => {
  test('landing page shows real data and auth entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Пътищата са истински');
    await expect(page.getByText('Реални градове').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Регистрация' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Вход' }).first()).toBeVisible();
    await expect(page.getByText('София → Пловдив')).toBeVisible();
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
    await expect(page.getByText('1500 €').or(page.getByText('1 500 €')).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('стъпка 1 от 6');
    await page.getByRole('button', { name: 'Да започваме' }).click();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('Приеми първата си поръчка');
    await page.goto('/game/contracts');
    await page.getByLabel('Само изпълними с моя автопарк').check();
    await page.locator('li.panel button[aria-expanded]').first().click();
    await page.getByRole('button', { name: 'Приеми и изпрати' }).click();
    await page.waitForURL('**/game/fleet');
    await expect(page.getByText('На курс')).toBeVisible();
    await expect(page.getByText('Нает').first()).toBeVisible();
    await expect(page.getByText(/остават/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Обучение' })).toContainText('Проследи камиона на картата');
  });

  test('company features are locked until a company is founded', async ({ page }) => {
    await register(page);
    await page.goto('/game/market');
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
    await expect(page.getByRole('link', { name: 'Компании', exact: true })).toHaveClass(/btn-primary/);
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
  });
});

test('opening notifications marks them as read', async ({ page }) => {
  await register(page);
  const badge = page.locator('aside').getByRole('link', { name: /Известия/ });
  await expect(badge).toContainText('1');
  await badge.click();
  await expect(page.getByText('Ново').first()).toBeVisible();
  await page.goto('/game');
  await expect(page.locator('aside').getByRole('link', { name: /Известия/ })).not.toContainText(/\d/);
});

test('@mobile dashboard is usable on a phone without horizontal scrolling', async ({ page }) => {
  await register(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('link', { name: 'Транспортни поръчки' }).click();
  await expect(page.getByRole('heading', { name: 'Транспортни поръчки' })).toBeVisible();
});
