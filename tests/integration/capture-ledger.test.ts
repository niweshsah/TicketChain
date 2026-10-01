import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';

const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error('Use a separate *_test database');
process.env.DATABASE_URL = database;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'isolated-capture-ledger-tests-secret-32';
let db: typeof import('../../apps/api/src/shared/db');
beforeAll(async () => {
  db = await import('../../apps/api/src/shared/db');
});
afterAll(async () => {
  await db.db.$disconnect();
});

it('preserves the original payer, persists extra captures once, and rejects replay onto a different order', async () => {
  const auth = await import('../../apps/api/src/services/identity/auth'),
    events = await import('../../apps/api/src/services/booking/events'),
    orders = await import('../../apps/api/src/services/booking/orders'),
    providers = await import('../../apps/api/src/services/payments');
  const { config } = await import('../../apps/api/src/shared/config');
  const initial = config.SERVICE_NAME;
  const account = await auth.register({
    name: 'Capture ledger test',
    email: `${randomUUID()}@capture.test`,
    password: 'Capture!Password2026',
    role: 'organizer',
  });
  const user = (await db.one<import('../../apps/api/src/shared/types').Account>(
    db.db,
    'SELECT * FROM tc_account WHERE id=$1::uuid',
    account.user.id,
  ))!;
  const event = await events.saveEvent(user, {
    title: 'Capture ledger event',
    description: 'Disposable capture evidence',
    category: 'Concert',
    performers: ['Fictional Test Band'],
    venueAddress: 'Fictional Test Road',
    languages: ['English'],
    agePolicy: '18+',
    venue: 'Test hall',
    city: 'Bengaluru',
    timezone: 'UTC',
    imageUrl: 'https://example.com/concert.jpg',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    tiers: [{ name: 'General', pricePaise: 10000, quantity: 2 }],
  });
  await events.transitionEvent(user, event.id, 'publish');
  const first = await orders.createOrder(
      user,
      {
        eventId: event.id,
        items: [{ tierId: event.tiers[0].id, quantity: 1 }],
      },
      randomUUID(),
    ),
    second = await orders.createOrder(
      user,
      {
        eventId: event.id,
        items: [{ tierId: event.tiers[0].id, quantity: 1 }],
      },
      randomUUID(),
    );
  await providers.initializePayment(user, first.id);
  await providers.initializePayment(user, second.id);
  const primary = `capture_${randomUUID()}`,
    extra = `capture_${randomUUID()}`;
  try {
    config.SERVICE_NAME = 'payments';
    await providers.recordCapture(
      first.id,
      primary,
      10000n,
      'INR',
      'original-sender',
    );
    await providers.recordCapture(
      first.id,
      extra,
      10000n,
      'INR',
      'extra-sender',
    );
    await providers.recordCapture(
      first.id,
      extra,
      10000n,
      'INR',
      'extra-sender',
    );
    await providers.recordCapture(
      first.id,
      primary,
      10000n,
      'INR',
      'changed-sender',
    );
    const payment = await db.one<{ data: { sender: string } }>(
      db.db,
      "SELECT data FROM tc_provideroperation WHERE order_id=$1::uuid AND kind='payment'",
      first.id,
    );
    expect(payment?.data.sender).toBe('original-sender');
    const extraEvidence = await db.rows<{
      data: { sender: string; amount: string };
    }>(
      db.db,
      'SELECT data FROM tc_provideroperation WHERE order_id=$1::uuid AND payment_id=$2',
      first.id,
      extra,
    );
    expect(extraEvidence).toHaveLength(1);
    expect(extraEvidence[0].data).toMatchObject({
      sender: 'extra-sender',
      amount: '10000',
    });
    await expect(
      providers.recordCapture(second.id, extra, 10000n, 'INR', 'extra-sender'),
    ).rejects.toMatchObject({ code: 'PAYMENT_REPLAY' });
    expect(
      await db.rows(
        db.db,
        'SELECT id FROM tc_outbox WHERE dedupe IN ($1,$2)',
        `capture:${primary}`,
        `capture:${extra}`,
      ),
    ).toHaveLength(2);
  } finally {
    config.SERVICE_NAME = initial;
  }
});
