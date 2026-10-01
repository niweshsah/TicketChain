import { test as base, expect } from '@playwright/test';
export { expect };
export const test = base.extend<{ cleanupEvents: void }>({
  cleanupEvents: [
    async ({ page }, use) => {
      const ids: string[] = [];
      let token = '';
      page.on('response', async (response) => {
        if (
          response.ok() &&
          /\/api\/v1\/auth\/(login|register|refresh)$/.test(response.url())
        ) {
          const body = await response.json().catch(() => ({}));
          if (body.accessToken) token = body.accessToken;
        }
      });
      await page.route('**/api/v1/organizer/events', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON();
        body.testMarker = `browser:${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const response = await route.fetch({ postData: JSON.stringify(body) });
        if (response.ok()) {
          const event = await response.json();
          ids.push(event.id);
        }
        await route.fulfill({ response });
      });
      try {
        await use();
      } finally {
        for (const id of ids) {
          const response = await page.request.post(
            `/api/v1/organizer/events/${id}/cancel`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Origin: process.env.E2E_BASE_URL || 'http://localhost:5173',
              },
              data: {},
            },
          );
          expect([200, 409]).toContain(response.status());
        }
      }
    },
    { auto: true },
  ],
});
export async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password = process.env.E2E_DEMO_PASSWORD || 'TicketChain!2026',
) {
  test.info().setTimeout(Math.max(test.info().timeout, 180000));
  if (!new URL(page.url()).pathname.startsWith('/login'))
    await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/auth/login') &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(60000);
  }
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}
