import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pool } from '../database.js';

test.afterAll(async () => {
  await pool.end();
});
test('main UI discovery, profile, publication, tickets and refund', async ({
  page,
}, info) => {
  const suffix = randomUUID();
  const email = `browser-${suffix}@example.com`;
  const title = `Browser verification ${suffix}`;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await expect(page.locator('.event-card').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Less scrolling. More living.' }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('home.png'),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Discover', exact: true }).click();
    await page.getByLabel('City', { exact: true }).selectOption('Mumbai');
    await page
      .getByRole('button', { name: 'Find events', exact: true })
      .click();
    await expect(page.locator('.event-card')).toHaveCount(1);
    await expect(page.getByLabel('Search', { exact: true })).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath('discovery.png'),
      fullPage: true,
    });
    await page.getByLabel('Search', { exact: true }).fill('no-such-event');
    await page
      .getByRole('button', { name: 'Find events', exact: true })
      .click();
    await expect(
      page.getByText('No events match these filters.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Your name').fill('Browser visitor');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('Browser-password-2026!');
    await page.locator('select[name=role]').selectOption('organizer');
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Organizer dashboard' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Profile', exact: true }).click();
    await page.getByLabel('Display name').fill('Updated visitor');
    await page.getByLabel('City', { exact: true }).selectOption('Pune');
    await page
      .getByRole('button', { name: 'Save profile', exact: true })
      .click();
    await expect(
      page.getByText('Profile saved.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Organizer', exact: true }).click();
    await page.getByRole('link', { name: 'Create event +' }).click();
    await page.getByLabel('Event title', { exact: true }).fill(title);
    await page
      .getByLabel('HTTPS image URL')
      .fill('https://ticketchain.local/images/concerts/concert-1.jpg');
    await page
      .getByLabel('About the experience', { exact: true })
      .fill(
        'A local browser verification concert with a complete event description.',
      );
    await page
      .getByLabel('Performers (one per line)')
      .fill('Verification Band');
    await page.getByLabel('Venue', { exact: true }).fill('Example Hall');
    await page
      .getByLabel('Venue address', { exact: true })
      .fill('Example Road, Pune');
    await page.getByLabel('Languages', { exact: true }).selectOption('English');
    await page
      .getByLabel('Age policy', { exact: false })
      .selectOption('All ages');
    await page.getByLabel('Price per ticket (₹)').fill('123.45');
    await page.getByLabel('Total inventory').fill('5');
    await page.getByRole('button', { name: 'Save and preview ↗' }).click();
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: '← Organizer dashboard' }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Check in & attendees' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Preview', exact: true }).click();
    const eventId = (
      await pool.query('SELECT id FROM public.lite_events WHERE title=$1', [
        title,
      ])
    ).rows[0].id;
    await page.goto(`/events/${eventId}`);
    await page.getByRole('link', { name: 'Choose your tickets ↗' }).click();
    await page.getByLabel('General admission quantity').fill('2');
    await page.screenshot({
      path: info.outputPath('checkout.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Confirm booking ↗' }).click();
    await expect(
      page.getByRole('heading', { name: 'You’re on the list.' }),
    ).toBeVisible();
    await expect(page.getByText('₹246.90', { exact: true })).toHaveCount(2);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'You’re on the list.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'My tickets', exact: true }).click();
    await expect(page.locator('.ticket')).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Show admission code' })
      .first()
      .click();
    await expect(page.locator('.qr svg')).toBeVisible();
    await page.getByRole('button', { name: 'Request full refund' }).click();
    await expect(
      page.locator('.ticket').first().getByText('refunded · order refunded'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator('body').innerText()).not.toMatch(/\bdemo\b/i);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto('/account');
    await expect(page.getByText('Sign in to continue.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const events = await pool.query(
      'SELECT id FROM public.lite_events WHERE title=$1',
      [title],
    );
    for (const event of events.rows) {
      await pool.query('DELETE FROM public.lite_tickets WHERE event_id=$1', [
        event.id,
      ]);
      await pool.query('DELETE FROM public.lite_orders WHERE event_id=$1', [
        event.id,
      ]);
      await pool.query('DELETE FROM public.lite_tiers WHERE event_id=$1', [
        event.id,
      ]);
      await pool.query('DELETE FROM public.lite_events WHERE id=$1', [
        event.id,
      ]);
    }
    await pool.query('DELETE FROM auth.users WHERE email=$1', [email]);
  }
});
