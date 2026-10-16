import { expect, test, type Page } from '@playwright/test';

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function register(page: Page) {
  const tag = unique();
  await page.goto('/register');
  await page.fill('#username', `e2e_${tag}`.slice(0, 20));
  await page.fill('#email', `e2e${tag}@example.com`);
  await page.fill('#password', 'e2e password long');
  await page.fill('#companyName', `E2E ${tag}`);
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
  test('register, accept a contract and see the truck on its way', async ({ page }) => {
    await register(page);
    await expect(page.getByText('60 000 €').first()).toBeVisible();
    await page.goto('/game/contracts');
    await page.getByLabel('Само изпълними с моя автопарк').check();
    await page.locator('li.panel button[aria-expanded]').first().click();
    await page.getByRole('button', { name: 'Приеми и изпрати' }).click();
    await page.waitForURL('**/game/fleet');
    await expect(page.getByText('На курс')).toBeVisible();
    await expect(page.getByText(/остават/)).toBeVisible();
  });

  test('buying a vehicle updates the balance', async ({ page }) => {
    await register(page);
    await page.goto('/game/market');
    const van = page.locator('section').filter({ hasText: 'Sokol Courier 3.5' }).first();
    await van.getByRole('button', { name: 'Купи' }).first().click();
    await expect(page.getByRole('status').first()).toContainText('Купено');
    await expect(page.getByText('28 000 €').first()).toBeVisible(); // 60 000 − 34 000 + 2 000 achievement
    await page.goto('/game/finance');
    await expect(page.getByText('Покупка на техника').first()).toBeVisible();
  });

  test('the world map renders real cities', async ({ page }) => {
    await register(page);
    await page.goto('/game/map');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
    expect(box!.height).toBeGreaterThan(300);
  });
});

test('@mobile dashboard is usable on a phone without horizontal scrolling', async ({ page }) => {
  await register(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('link', { name: 'Транспортни поръчки' }).click();
  await expect(page.getByRole('heading', { name: 'Транспортни поръчки' })).toBeVisible();
});
