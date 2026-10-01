import { signIn } from './fixtures';
import { test, expect } from './fixtures';

test('waiting-room UI admits a buyer and another browser observes the held inventory decrease', async ({
  page,
  browser,
}) => {
  await signIn(page, 'organizer@demo.ticketchain.local');
  await page.getByRole('link', { name: 'Create event +' }).click();
  const title = `Waiting room browser ${Date.now()} ${test.info().project.name}`;
  await page.getByLabel('Event title').fill(title);
  await page
    .getByLabel('Venue', { exact: true })
    .fill('Waiting room demo hall');
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Bengaluru');
  await page
    .getByLabel('HTTPS image URL')
    .fill('https://ticketchain.local/images/concerts/concert-2.jpg');
  await page
    .getByLabel('About the experience')
    .fill('Disposable waiting-room browser journey');
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
  await page.getByLabel('Total inventory').fill('3');
  await page.getByLabel('Enable high-demand waiting room').check();
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
  const observerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === 'true',
  });
  try {
    const buyer = await buyerContext.newPage(),
      observer = await observerContext.newPage();
    await signIn(buyer, 'attendee@demo.ticketchain.local');
    await signIn(observer, 'attendee@demo.ticketchain.local');
    await buyer.goto(`/checkout/${eventId}`);
    await observer.goto(`/checkout/${eventId}`);
    await expect(observer.getByText(/3 left/)).toBeVisible();
    await buyer.getByRole('button', { name: 'Join waiting room' }).click();
    await expect(buyer.getByText(/Your turn!/)).toBeVisible();
    await buyer
      .getByRole('button', {
        name: 'Add one General admission ticket',
        exact: true,
      })
      .click();
    await buyer.getByRole('button', { name: 'Reserve and continue' }).click();
    await expect(buyer).toHaveURL(/\/orders\//);
    await expect(observer.getByText(/2 left/)).toBeVisible();
  } finally {
    await buyerContext.close();
    await observerContext.close();
    await page.goto('/organizer');
    const disposable = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await disposable
      .getByRole('button', { name: 'Cancel event', exact: true })
      .click();
    await disposable
      .getByRole('button', { name: 'Confirm cancellation' })
      .click();
  }
});
