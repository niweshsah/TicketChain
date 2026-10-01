import { signIn } from './fixtures';
import sharp from 'sharp';
import { test, expect } from './fixtures';

test('restores profile, enables organizer access, and preserves the checkout destination', async ({
  page,
}) => {
  const email = `browser-profile-${Date.now()}-${test.info().project.name}@demo.test`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Profile journey');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser!Password2026');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();

  const photo = await sharp({
    create: { width: 600, height: 600, channels: 3, background: 'purple' },
  })
    .png()
    .toBuffer();
  await page.getByLabel('Choose photo').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: photo,
  });
  await expect(page.getByAltText('Your profile')).toBeVisible();
  await page.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save photo', exact: true }),
  ).toBeDisabled();

  await expect(page.getByAltText('Your profile')).toHaveAttribute(
    'src',
    /api\/v1\/me\/avatar/,
  );
  await page.getByLabel('Display name').fill('My concert profile');
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Mumbai');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue(
    'My concert profile',
  );
  await expect(
    page.locator('main').getByRole('combobox', { name: 'City', exact: true }),
  ).toHaveValue('Mumbai');
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await page
    .locator('main')
    .getByRole('combobox', { name: 'City', exact: true })
    .selectOption('Bengaluru');
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page).toHaveURL(/city=Bengaluru/);
  await page.reload();
  await expect(
    page.locator('main').getByRole('combobox', { name: 'City', exact: true }),
  ).toHaveValue('Bengaluru');
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.getByAltText('Your profile')).toHaveCount(0);
  await page.getByRole('link', { name: 'Organizer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Become an organizer', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Create event +' }),
  ).toBeVisible();
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
  const destination = page.url();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).last().click();
  await signIn(page, email, 'Browser!Password2026');
  await expect(page).toHaveURL(destination);
  await expect(
    page.getByRole('button', { name: 'Reserve and continue' }),
  ).toBeDisabled();
  await page
    .getByRole('button', {
      name: 'Add one General admission ticket',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', { name: 'Reserve and continue' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Reserve and continue' }).click();
  await expect(page).toHaveURL(/\/orders\//);
});
