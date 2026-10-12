import { expect, test } from '@playwright/test';

test('the hosted app opens uncached lazy journal and Scripture routes offline', async ({ page, context }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service workers are unavailable');
    await navigator.serviceWorker.ready;
  });
  // A first visit has to work without a magic reload: once the complete cache
  // is installed, activate claims the already-open page.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);

  await page.goto('/#/data');
  await expect(page.getByRole('heading', { level: 1, name: 'Your journal' })).toBeVisible();

  // This route pulls the deferred Scripture divisions and book UI, neither of
  // which was visited online in this test.
  await page.goto('/#/book/matthew');
  await expect(page.getByRole('heading', { level: 1, name: 'Matthew' })).toBeVisible();
  await expect(page.locator('main a[href^="#/passage/matthew/"]').first()).toBeVisible();
});
