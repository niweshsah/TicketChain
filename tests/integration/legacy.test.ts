import bcrypt from 'bcryptjs';
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { config as dotenv } from 'dotenv';
dotenv();
it('dry-runs explicit legacy mapping without writes, preserves hashes/IDs, and verifies its archive', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('Separate *_test database required');
  const db = new PrismaClient({ datasourceUrl: url });
  const dir = mkdtempSync(join(tmpdir(), 'tc-legacy-test-'));
  const ids = {
    user: randomUUID(),
    organizer: randomUUID(),
    owner: randomUUID(),
    venue: randomUUID(),
    event: randomUUID(),
    tier: randomUUID(),
    ticket: randomUUID(),
    order: randomUUID(),
    item: randomUUID(),
  };
  const timestamp = new Date().toISOString();
  const passwordHash = await bcrypt.hash('LegacyFixturePassword!123', 4);
  const dump = {
    version: 1,
    source: randomUUID(),
    exportedAt: timestamp,
    tables: {
      User: [
        {
          id: ids.user,
          name: 'Legacy attendee',
          email: `${ids.user}@legacy.test`,
          passwordHash,
          role: 'attendee',
          createdAt: timestamp,
          walletAddress: 'unverified-wallet',
        },
        {
          id: ids.owner,
          name: 'Legacy organizer',
          email: `${ids.owner}@legacy.test`,
          passwordHash,
          role: 'organizer',
          createdAt: timestamp,
        },
      ],
      Organizer: [{ id: ids.organizer, userId: ids.owner }],
      Venue: [{ id: ids.venue, name: 'Legacy Hall', city: 'Delhi' }],
      Event: [
        {
          id: ids.event,
          organizerId: ids.organizer,
          venueId: ids.venue,
          title: 'Historical concert',
          description: 'Original record',
          category: 'Concert',
          imageUrl: 'https://example.com/image.jpg',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          endsAt: new Date(Date.now() + 90000000).toISOString(),
          status: 'published',
          createdAt: timestamp,
        },
      ],
      TicketType: [
        {
          id: ids.tier,
          eventId: ids.event,
          name: 'General',
          priceCents: 10000,
          totalQuantity: 1,
        },
      ],
      Ticket: [{ id: ids.ticket, ticketTypeId: ids.tier, status: 'sold' }],
      Order: [
        {
          id: ids.order,
          userId: ids.user,
          totalCents: 10000,
          status: 'completed',
          createdAt: timestamp,
        },
      ],
      OrderItem: [
        {
          id: ids.item,
          orderId: ids.order,
          ticketId: ids.ticket,
          priceCents: 10000,
        },
      ],
    },
  };
  const mapping = {
    currencyByTier: { [ids.tier]: 'INR' },
    minorUnitByTier: { [ids.tier]: 'paise' },
    timezoneByEvent: { [ids.event]: 'Asia/Kolkata' },
    paymentEvidenceByOrder: {
      [ids.order]: {
        provider: 'legacy-verified',
        paymentId: `verified_${randomUUID()}`,
        currency: 'INR',
        amount: '10000',
        verifiedAt: timestamp,
        reference: 'fixture external reconciliation',
      },
    },
  };
  writeFileSync(join(dir, 'dump.json'), JSON.stringify(dump));
  writeFileSync(join(dir, 'mapping.json'), JSON.stringify(mapping));
  const run = (command: string) => {
    const result = spawnSync(
      process.execPath,
      [
        'apps/api/dist/scripts/legacy.js',
        command,
        join(dir, 'dump.json'),
        join(dir, 'mapping.json'),
        join(dir, 'report.json'),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url,
          JWT_SECRET: 'legacy-fixture-secret-with-at-least-32-bytes',
          PAYMENT_PROVIDER: 'demo',
          NODE_ENV: 'test',
          ALLOW_LEGACY_IMPORT: 'yes',
        },
        encoding: 'utf8',
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    return result;
  };
  try {
    run('dry-run');
    expect(
      await db.$queryRawUnsafe<unknown[]>(
        'SELECT id FROM tc_account WHERE id=$1::uuid',
        ids.user,
      ),
    ).toHaveLength(0);
    expect(
      JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).resolvedOrders,
    ).toBe(1);
    run('import');
    run('verify');
    const users = await db.$queryRawUnsafe<
      { password_hash: string; wallet: string | null }[]
    >(
      'SELECT password_hash,wallet FROM tc_account WHERE id=$1::uuid',
      ids.user,
    );
    expect(users[0]).toEqual({ password_hash: passwordHash, wallet: null });
    expect(
      (
        await db.$queryRawUnsafe<{ status: string }[]>(
          'SELECT status FROM tc_purchase WHERE id=$1::uuid',
          ids.order,
        )
      )[0].status,
    ).toBe('paid');
    expect(
      (
        await db.$queryRawUnsafe<{ status: string }[]>(
          'SELECT status FROM tc_listing WHERE id=$1::uuid',
          ids.event,
        )
      )[0].status,
    ).toBe('draft');
    expect(() => run('import')).toThrow();
  } finally {
    await db.$disconnect();
  }
});
