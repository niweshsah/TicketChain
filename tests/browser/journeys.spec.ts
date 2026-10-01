import { test, expect } from './fixtures';
const attendee = 'attendee@demo.ticketchain.local';
const organizer = 'organizer@demo.ticketchain.local';
import { signIn as login } from './fixtures';
test('attendee purchases two tickets and receives a whole-order refund', async ({
  page,
}) => {
  await login(page, attendee);
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await page.getByLabel('Search', { exact: true }).fill('Indie After Hours');
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Bengaluru');
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await page
    .locator('.event-card')
    .filter({
      has: page.getByRole('heading', {
        name: 'Indie After Hours · Bengaluru 1',
        exact: true,
      }),
    })
    .click();
  await page.getByRole('link', { name: 'Choose your tickets' }).click();
  await page
    .getByRole('spinbutton', { name: 'General admission quantity' })
    .fill('2');
  await page.getByRole('button', { name: 'Reserve and continue' }).click();
  await expect(page).toHaveURL(/orders/);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: 'Pay and confirm' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re on the list.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View tickets and orders' }).click();
  await page
    .getByRole('button', { name: 'Show admission code' })
    .first()
    .click();
  await expect(page.locator('.qr svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Copy manual code' }).first().click();
  await page
    .getByRole('button', { name: 'Request full refund' })
    .first()
    .click();
  await expect(
    page.locator('.tier').filter({ hasText: 'refunded' }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/attendee-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('organizer creates a draft, previews, publishes, and checks in a paid ticket once', async ({
  page,
  browser,
}) => {
  await login(page, organizer);
  await page.getByRole('link', { name: 'Create event +' }).click();
  const title = `Browser concert ${Date.now()} ${test.info().project.name}`;
  await page.getByLabel('Event title').fill(title);
  await page
    .getByLabel('Venue', { exact: true })
    .fill('Demo Arena, Central Road');
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Bengaluru');
  await page
    .getByLabel('HTTPS image URL')
    .fill('https://images.unsplash.com/photo-1459749411175-04bf5292ceea');
  await page
    .getByLabel('About the experience')
    .fill('A disposable browser event for the purchase and check-in journey.');
  await page
    .getByLabel('Venue address', { exact: true })
    .fill('Fictional Central Road');
  await page
    .getByLabel('Performers (one per line)')
    .fill('Fictional Browser Band');
  await page.getByLabel('Languages', { exact: true }).selectOption(['English']);
  await page
    .getByRole('combobox', { name: 'Age policy', exact: true })
    .selectOption('18+');
  await page.getByLabel('Total inventory').fill('5');
  await page.getByLabel('Price per ticket (₹)').fill('123.45');
  await page.getByRole('button', { name: 'Add tier +', exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove tier', exact: true })
    .last()
    .click();
  await expect(page.getByLabel('Tier name')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add tier +', exact: true }).click();
  await page.getByLabel('Tier name').last().fill('Balcony');
  await page.getByRole('button', { name: 'Save and preview' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const eventId = page.url().split('/')[4];
  await page.getByRole('link', { name: 'Organizer dashboard' }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(card.locator('.eyebrow')).toContainText('published');
  const buyerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === 'true',
  });
  const buyer = await buyerContext.newPage();
  await login(buyer, attendee);
  await buyer.goto(`/checkout/${eventId}`);
  await buyer
    .getByRole('spinbutton', { name: 'General admission quantity' })
    .fill('1');
  await buyer.getByRole('button', { name: 'Reserve and continue' }).click();
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  await buyer.getByRole('button', { name: 'Pay and confirm' }).click();
  await expect(
    buyer.getByRole('heading', { name: 'You’re on the list.' }),
  ).toBeVisible();
  await buyer.getByRole('link', { name: 'View tickets and orders' }).click();
  const ticket = buyer
    .locator('.ticket')
    .filter({ has: buyer.getByRole('heading', { name: title, exact: true }) });
  await ticket.getByRole('button', { name: 'Show admission code' }).click();
  const code = await ticket.locator('code').innerText();
  await page.goto(`/organizer/${eventId}/edit`);
  await page
    .locator('fieldset')
    .filter({ has: page.locator('input[value="General admission"]') })
    .getByRole('button', { name: 'Remove tier', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save and preview' }).click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await page.goto(`/organizer/${eventId}/edit`);
  await expect(
    page.getByRole('heading', { name: 'Retired tier history' }),
  ).toBeVisible();
  await page.goto(`/organizer/${eventId}/check-in`);
  await page.getByLabel('Manual ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in ticket' }).click();
  await expect(page.getByText('Ticket accepted. Welcome in!')).toBeVisible();
  await page.getByLabel('Manual ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in ticket' }).click();
  await expect(page.getByRole('alert')).toContainText('already');
  await page.screenshot({
    path: `artifacts/organizer-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto('/organizer');
  const disposableEvent = page.locator('article').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
  await disposableEvent
    .getByRole('button', { name: 'Cancel event', exact: true })
    .click();
  await disposableEvent
    .getByRole('button', { name: 'Confirm cancellation' })
    .click();
  await expect(disposableEvent.locator('.eyebrow')).toContainText('cancelled');
  await buyerContext.close();
});
test('home navigation, carousel pause, themes, and narrow layouts', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Less scrolling/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.hero-image')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause carousel' }).click();
  await expect(
    page.getByRole('button', { name: 'Resume carousel' }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Theme', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/home-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('restores a rotated session and clears private pages on sign-out', async ({
  page,
}) => {
  await login(page, attendee);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your next experience awaits.' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your next experience awaits.' }),
  ).toBeVisible();
  await login(page, organizer);
  await expect(page).toHaveURL(/organizer$/);
});

test('social sign-in buttons preserve registration role and form values on failure', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/providers', (route) =>
    route.fulfill({ json: { google: true, github: true } }),
  );
  let submitted: unknown;
  await page.route('**/api/v1/auth/oauth/*/start', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      json: {
        code: 'OAUTH_PROVIDER_FAILED',
        message: 'Provider is temporarily unavailable',
        requestId: 'browser-fixture',
      },
    });
  });
  await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill('retained@browser.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Retained!Password123');
  await page.getByLabel('I want to').selectOption('organizer');
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  expect(submitted).toEqual({ role: 'organizer', intent: 'login' });
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'retained@browser.test',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
    'Retained!Password123',
  );
  await page.getByRole('button', { name: 'Continue with GitHub' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Continue with GitHub' }),
  ).toBeEnabled();
});
