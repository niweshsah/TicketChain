import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function inspect(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await test.info().attach(`${name}-accessibility`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(results.violations, `${name}: accessibility violations`).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.content,
    `${name}: horizontal overflow`,
  ).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({
    path: `artifacts/ui-review/${test.info().project.name}-${name}.png`,
    fullPage: true,
  });
}

async function seedEvent(page: Page) {
  const response = await page.request.get(
    '/api/v1/events?q=Indie%20After%20Hours&city=Bengaluru',
  );
  return (await response.json()).events.find(
    (event: { title: string }) =>
      event.title === 'Indie After Hours · Bengaluru 1',
  ) as { id: string };
}

async function registerReviewer(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('UI review organizer');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`ui-review-${Date.now()}-${test.info().project.name}@demo.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser!Review2026');
  await page.getByLabel('I want to').selectOption('organizer');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}

test('public pages remain accessible, images recover, and booking stays reachable', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const event = await seedEvent(page);
  for (const [name, path, ready] of [
    ['home', '/', '.event-card'],
    ['discovery', '/events?city=Bengaluru', '.event-card'],
    ['empty-discovery', '/events?q=NoSuchEventReview2026', '.filters'],
    ['login', '/login', '.auth'],
    ['register', '/register', '.auth'],
    ['not-found', '/missing-ui-review-page', 'h1'],
    ['details', `/events/${event.id}`, '.booking-panel'],
  ]) {
    await page.goto(path);
    await page.locator(ready).first().waitFor();
    await inspect(page, name);
  }
  await page.evaluate(() => {
    const panel = document
      .querySelector('.booking-panel')!
      .getBoundingClientRect();
    const header = document.querySelector('header')!.getBoundingClientRect();
    window.scrollTo(0, panel.top + scrollY - header.bottom + 20);
  });
  const position = await page.evaluate(() => ({
    header: document.querySelector('header')!.getBoundingClientRect().bottom,
    panel: document.querySelector('.booking-panel')!.getBoundingClientRect()
      .top,
    action: document.querySelector('.booking-action')!.getBoundingClientRect()
      .bottom,
    height: innerHeight,
    mobile: innerWidth <= 700,
  }));
  if (position.mobile)
    expect(position.action).toBeGreaterThan(position.height - 80);
  else expect(position.panel).toBeGreaterThanOrEqual(position.header);
  await page.screenshot({
    path: `artifacts/ui-review/${test.info().project.name}-sticky-booking.png`,
  });
  await page.locator('.detail-hero img').evaluate((image: HTMLImageElement) => {
    image.src = '/missing-review-poster.png';
  });
  await expect(page.locator('.detail-hero img')).toHaveAttribute(
    'src',
    '/images/concert.jpg',
  );
  await page.goto('/events');
  await page.locator('.event-card').first().waitFor();
  await page.locator('header .brand').click();
  await page.locator('.event-card').first().waitFor();
  await page
    .locator('footer')
    .getByRole('link', { name: 'Explore events' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Discover events' }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.microphone').scrollIntoViewIfNeeded();
  await expect(page.locator('.microphone canvas')).toBeVisible();
  await page.locator('.microphone').screenshot({
    path: `artifacts/ui-review/${test.info().project.name}-microphone-reduced.png`,
  });
  expect(errors).toEqual([]);
});

test('discovery submits search and city from a single filter bar', async ({
  page,
}) => {
  await page.goto('/events?city=Bengaluru');
  await page.getByRole('button', { name: 'Concert', exact: true }).click();
  await expect(page.locator('select[name=category]')).toHaveValue('Concert');
  await expect(page).toHaveURL(/category=Concert/);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('header').getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('header').getByRole('combobox')).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Search cities' }),
  ).toHaveCount(0);
  await page
    .getByLabel('Search', { exact: true })
    .pressSequentially('Indie After Hours');
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue(
    'Indie After Hours',
  );
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page).toHaveURL(/q=Indie/);
  await expect(page.locator('select[name=category]')).toHaveValue('Concert');
  await page.goto('/events?city=Bengaluru&q=Indie%20After%20Hours');
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue(
    'Indie After Hours',
  );
  await expect(page.locator('select[name=category]')).toHaveValue('');
  await page.getByLabel('Search', { exact: true }).fill('Jazz');
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Delhi');
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('Jazz');
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page).toHaveURL(/city=Delhi/);
  await expect(page.locator('main select[name=city]')).toHaveValue('Delhi');
  await expect(page.locator('main select[name=city] option')).toHaveCount(31);
  await page.locator('main select[name=city]').selectOption('Mumbai');
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page).toHaveURL(/city=Mumbai/);
  await page.goBack();
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('Jazz');
  await page
    .getByLabel('Search', { exact: true })
    .fill('Fictional Demo Ensemble');
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page.locator('.event-card').first()).toBeVisible();
});

test('a new search can replace a pending search without losing fields', async ({
  page,
}) => {
  await page.goto('/events?city=Delhi');
  await expect(page.locator('.event-card').first()).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/events?*', async (route) => {
    if (
      new URL(route.request().url()).searchParams.get('q') === 'Delayed review'
    ) {
      await pending;
    }
    await route.continue();
  });
  try {
    await page.getByLabel('Search', { exact: true }).fill('Delayed review');
    await page.getByLabel('Search', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/q=Delayed/);
    await expect(page.getByRole('status')).toBeVisible();
    await page.getByLabel('Search', { exact: true }).fill('Indie After Hours');
    await page.locator('main select[name=city]').selectOption('Bengaluru');
    await expect(
      page.getByRole('button', { name: 'Find events', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Find events', exact: true })
      .click();
    await expect(page).toHaveURL(/city=Bengaluru&q=Indie/);
    await expect(page.locator('.event-card').first()).toContainText(
      'Indie After Hours',
    );
    await expect(page.getByLabel('Search', { exact: true })).toHaveValue(
      'Indie After Hours',
    );
    release();
    await page.reload();
    await expect(page.locator('main select[name=city]')).toHaveValue(
      'Bengaluru',
    );
    await expect(page.getByLabel('Search', { exact: true })).toHaveValue(
      'Indie After Hours',
    );
  } finally {
    release();
  }
});

test('private forms retain edits after failures and work on narrow screens', async ({
  page,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await registerReviewer(page);
  await page
    .locator('header')
    .getByRole('link', { name: 'Profile', exact: true })
    .click();
  await expect(page.getByLabel('Display name')).toBeVisible();
  await inspect(page, 'profile');
  await page.getByLabel('Display name').fill('Keep this edited name');
  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary profile outage' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Temporary profile outage',
  );
  await expect(page.getByLabel('Display name')).toHaveValue(
    'Keep this edited name',
  );
  const photo = await sharp({
    create: { width: 800, height: 500, channels: 3, background: 'purple' },
  })
    .png()
    .toBuffer();
  await page.getByLabel('Choose photo').setInputFiles({
    name: 'review.png',
    mimeType: 'image/png',
    buffer: photo,
  });
  await page.route('**/api/v1/me/avatar', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary photo outage' }),
    }),
  );
  await page.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Temporary photo outage' }),
  ).toBeVisible();
  await expect(page.getByAltText('Your profile')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await page
    .locator('header')
    .getByRole('link', { name: 'Organizer', exact: true })
    .click();
  await page.getByRole('link', { name: 'Create event +' }).click();
  await expect(page.getByLabel('Event title')).toBeVisible();
  await inspect(page, 'editor');
  await page.getByRole('button', { name: /^Save and preview/ }).click();
  await expect(page.getByLabel('Event title')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Event title')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('title:');
  await page.getByLabel('Event title').fill('UI review draft');
  await page.getByLabel('Venue', { exact: true }).fill('Review arena');
  await page
    .getByLabel('HTTPS image URL')
    .fill('https://example.com/review.jpg');
  await page.route('**/api/v1/organizer/events', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary editor outage' }),
    }),
  );
  await page.getByRole('button', { name: /^Save and preview/ }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Temporary editor outage',
  );
  await expect(page.getByLabel('Event title')).toHaveValue('UI review draft');
  await expect(page.getByLabel('Venue', { exact: true })).toHaveValue(
    'Review arena',
  );
  await page.getByLabel('Search timezones').fill('New York');
  await page
    .getByRole('combobox', { name: 'Event timezone', exact: true })
    .selectOption('America/New_York');
  await page.getByLabel('Start · event timezone').fill('2026-11-01T01:30');
  await page.getByLabel('End · event timezone').fill('2026-11-01T04:30');
  await page.getByRole('button', { name: /^Save and preview/ }).click();
  await expect(page.getByRole('alert')).toContainText('ambiguous local time');
  await expect(page.getByLabel('Event title')).toHaveValue('UI review draft');
  await page.setViewportSize({ width: 320, height: 740 });
  await inspect(page, 'editor-320');
  await page
    .locator('header')
    .getByRole('link', { name: 'My tickets', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Tickets & memories' }),
  ).toBeVisible();
  await inspect(page, 'account');
});
